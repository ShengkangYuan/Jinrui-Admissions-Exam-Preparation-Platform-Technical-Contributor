// V2.3 冒险模式 · 数值平衡与回归验证
//
// 这是一个「离线平衡模拟器 + 回归门禁」。它复用真实的战斗内核
// (rogue-combat.js / rogue-skills.js，纯函数、无 DB/Express 依赖)，
// 并**原样复刻** roguelike.js 路由里 /answer 与 /tick 的结算编排，
// 从而在不触碰线上路由的前提下，批量模拟完整对局、量化 28 个被动的强度曲线。
//
// ⚠️ 同步维护约定：下方 `simulateRun` 里的伤害/减伤/回血/升级数学
// 必须与 src/routes/roguelike.js 的 /answer 分支保持一致。若路由数值逻辑改动，
// 这里也要同步改，否则平衡结论会失真。本脚本只动「复刻逻辑」，绝不 import 路由文件，
// 以保证冒险模式改动隔离原则（不影响题库等其它功能）。
//
// 用法：
//   node scripts/balance_sim.mjs            # 默认 n=300 / 四画像 / 输出报告
//   node scripts/balance_sim.mjs --n 120    # 快速模式
//   node scripts/balance_sim.mjs --quiet    # 仅输出回归判定（供 CI）
//   node scripts/balance_sim.mjs --profile strong  # 只跑指定画像

import {
  ANSWER_GRACE_MS, aliveEnemies, beginQuestionWindow, damageEnemy, damagePlayer,
  playerAtk, simulate, speedTier, syncCombat, computePlayerDamage, applyBurn,
} from "../src/lib/rogue-combat.js";
import {
  PASSIVES, computeStats, addPassive, passiveGainStats, pickThreePassives,
} from "../src/lib/rogue-skills.js";

const BASE_HP = 100;
const GRACE = ANSWER_GRACE_MS;
const MAX_LAYER = 20;

// ----------------------------- 可复现随机 -----------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function gauss(rng, mean, std) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return mean + std * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
function randInt(rng, min, max) { return Math.floor(rng() * (max - min + 1)) + min; }

// ----------------------------- 玩家画像 -----------------------------
// accuracy: 答对概率; ratio*: 出手耗时占本题限时比例(越小越快→伤害倍率越高、挨打越少)
const PROFILES = {
  weak: { accuracy: 0.55, ratioMean: 0.72, ratioStd: 0.13 },
  average: { accuracy: 0.78, ratioMean: 0.50, ratioStd: 0.10 },
  strong: { accuracy: 0.93, ratioMean: 0.27, ratioStd: 0.06 },
  brutal: { accuracy: 0.48, ratioMean: 0.82, ratioStd: 0.10 },
};
// 用于「相对强度排序」的画像：必须存在胜率天花板余量(基线<0.8)，否则胜率饱和无法区分被动。
const RANK_PROFILES = ["weak", "brutal"];

// 每个被动的「主场学科」：攻击树→数学(物理伤害)，法术树→化学(法术伤害)，
// 防御/续航→数学(它们对所有学科等效用)。用于测量被动「设计内」强度。
function homeSubject(p) {
  if (p.tree === "spell") return "化学";
  return "数学";
}

// ----------------------------- 地图 / 题目 -----------------------------
function genMap(len) {
  const map = [];
  for (let i = 1; i <= len; i++) {
    if (i % 5 === 0) map.push("boss");
    else if (i % 3 === 0) map.push("reward");
    else map.push("normal");
  }
  return map;
}
function defaultItems() {
  return {
    mana: 10, maxMana: 10, level: 1, xp: 0,
    passives: [],
    tempShield: 0, ironWillUsed: 0, deathGuardUsed: false,
    lifeFlowNextBeat: null, lifeFlowPauseUntil: 0, barrierNextBeat: 0, voidCdUntil: 0,
    combat: null, equipped: {}, berserk: false, pendingScoreBonus: 0,
    pendingSkills: null, pendingCount: 0, inventory: [],
    autoCorrect: false, shield: false, shieldCount: 0,
  };
}

// ----------------------------- 单次对局 -----------------------------
// opts: { passiveId, stacks, profile, subjectMode('home'|'mix'), autoPick, seed }
function simulateRun(opts) {
  const profile = PROFILES[opts.profile];
  const rng = mulberry32(opts.seed >>> 0);
  const items = defaultItems();
  let maxHp = BASE_HP, hp = BASE_HP, level = 1, combo = 0, layer = 1, score = 0, coins = 0, status = "ACTIVE";
  let vt = 1_000_000_000_000; // 虚拟时钟(ms)
  const map = genMap(MAX_LAYER);

  if (opts.passiveId) {
    items.passives = [{ ref: opts.passiveId, stacks: opts.stacks }];
    const g = passiveGainStats(opts.passiveId);
    maxHp += g.maxHp; hp += g.maxHp;
    items.maxMana += g.maxMana; items.mana += g.maxMana;
  }

  let totalDmgDealt = 0, totalDmgTaken = 0, questions = 0, kills = 0;
  let steps = 0;

  const qSubject = (qIdx) => {
    if (opts.subjectMode === "mix") return qIdx % 2 === 0 ? "数学" : "化学";
    return opts._subject || "数学";
  };

  while (status === "ACTIVE" && steps < 4000) {
    steps++;
    const nodeType = map[layer - 1] || "normal";

    if (nodeType === "reward") {
      coins += 2;
      if (rng() < 0.3) { /* 治疗药水 */ }
      if (hp < maxHp && rng() < 0.3) hp = Math.min(maxHp, hp + randInt(rng, 6, 12));
      layer += 1;
      if (layer > MAX_LAYER) { status = "WON"; break; }
      const q = { subject: qSubject(questions), difficulty: layer, type: "CHOICE", id: "SYN" };
      syncCombat(items, layer, map[layer - 1], q, {});
      if (items.combat) { items.combat.qStartMs = vt; items.combat.lastTickMs = vt; }
      continue;
    }

    const q = { subject: qSubject(questions), difficulty: layer, type: "CHOICE", id: "SYN" };
    syncCombat(items, layer, nodeType, q, {});
    const c = items.combat;
    if (!c) break;
    c.qStartMs = vt; c.lastTickMs = vt;

    const stats = computeStats(items.passives);
    stats._manaActive = items.mana > 0;

    let ratio = clamp(gauss(rng, profile.ratioMean, profile.ratioStd), 0.02, 1.5);
    const answerMs = Math.min(c.qLimitMs + GRACE, Math.max(50, ratio * c.qLimitMs));

    const sim = simulate(items, hp, vt + answerMs, { stats, maxHp });
    hp = sim.hp; vt += answerMs;
    for (const e of sim.events) if (e.type === "enemy_hit") totalDmgTaken += e.dmg || 0;

    const c2 = items.combat;
    const elapsed = answerMs;
    let correct = rng() < profile.accuracy;
    const overtime = answerMs > c2.qLimitMs + GRACE;
    if (overtime) correct = false;

    if (stats.voidBolt && items.mana >= stats.voidBolt.cost && (!items.voidCdUntil || c2.totalBeat >= items.voidCdUntil)) {
      items.mana -= stats.voidBolt.cost;
      items.voidCdUntil = c2.totalBeat + stats.voidBolt.cd;
      for (const e of aliveEnemies(c2)) {
        const d = damageEnemy(e, 40 + level * 4, stats.armorPen);
        totalDmgDealt += d.dealt; if (d.killed) kills++;
      }
    }

    questions++;
    let cleared = false;
    if (hp <= 0) { status = "DEAD"; break; }

    if (correct) {
      combo += 1;
      const tier = speedTier(Math.min(1, elapsed / c2.qLimitMs));
      const base = playerAtk(items, level);
      let raw = base * tier.mult * (0.9 + rng() * 0.2);
      const hpRatio = maxHp > 0 ? 1 - hp / maxHp : 0;
      const dmg = computePlayerDamage(stats, raw, q.subject, hpRatio);
      const target = aliveEnemies(c2)[0];
      if (target) {
        const others = aliveEnemies(c2).filter((e) => e.eid !== target.eid);
        const d = damageEnemy(target, dmg.amount, stats.armorPen);
        totalDmgDealt += d.dealt;
        if (dmg.type === "phys" && stats.splash > 0) {
          for (const e of others) { const sd = damageEnemy(e, dmg.amount * stats.splash, stats.armorPen); totalDmgDealt += sd.dealt; }
        }
        if (dmg.type === "spell" && stats.spellSplash > 0) {
          for (const e of others) { const sd = damageEnemy(e, dmg.amount * stats.spellSplash, 0); totalDmgDealt += sd.dealt; }
        }
        if (dmg.type === "spell" && stats.scatterCount > 0) {
          for (let i = 0; i < Math.min(stats.scatterCount, others.length); i++) { const e = others[i]; const sd = damageEnemy(e, dmg.amount * stats.scatterDmg, stats.armorPen); totalDmgDealt += sd.dealt; }
        }
        if (dmg.type === "spell" && stats.burn) applyBurn(target, dmg.amount, stats, c2.totalBeat);
        if (dmg.type === "phys" && stats.lifesteal > 0) {
          const ls = stats.lifesteal * (stats.manaBlood ? 1 + stats.manaBlood.lifestealBonus : 1);
          const healAmt = Math.round(d.dealt * ls);
          if (healAmt > 0) hp = Math.min(maxHp, hp + healAmt);
        }
        for (const e of [target, ...others]) {
          if (e.hp <= 0 && !e._counted) {
            e._counted = true;
            items.xp += e.kind === "boss" ? 5 : 2;
            coins += e.kind === "boss" ? 5 : 1;
            if (stats.killMana) items.mana = Math.min(items.maxMana, items.mana + stats.killMana);
            if (stats.bloodFeast && !stats.lifeConvert) hp = Math.min(maxHp, hp + stats.bloodFeast);
            if (stats.lifeConvert) items.mana = Math.min(items.maxMana, items.mana + stats.lifeConvert.mana);
            kills++;
          }
        }
      }
      if (!stats.manaBlood) items.mana = Math.min(items.maxMana, items.mana + 1);
      items.xp += 1;
      if (combo === 3) hp = Math.min(maxHp, hp + randInt(rng, 6, 12));
      else if (combo === 10) hp = Math.min(maxHp, hp + randInt(rng, 6, 12));
      hp = Math.min(maxHp, hp + randInt(rng, 3, 7));

      cleared = aliveEnemies(c2).length === 0;

      while (items.xp >= level * 3) {
        items.xp -= level * 3; level += 1;
        if (opts.autoPick) {
          const three = pickThreePassives(items.passives);
          const pick = three[Math.floor(rng() * three.length)];
          items.passives = addPassive(items.passives, pick.id);
          const g = passiveGainStats(pick.id);
          maxHp += g.maxHp; hp += g.maxHp;
          items.maxMana += g.maxMana; items.mana += g.maxMana;
        }
      }
    } else {
      combo = 0;
      const target = aliveEnemies(c2)[0];
      if (target) {
        const raw = target.atk * (1 + rng() * 0.2) * (overtime ? 1.5 : 1);
        const r = damagePlayer(items, hp, raw, { stats, maxHp, totalBeat: c2.totalBeat });
        hp = r.hp; totalDmgTaken += r.dealt;
      }
    }

    if (hp <= 0) { hp = 0; status = "DEAD"; break; }

    if (cleared) {
      layer += 1;
      if (layer > MAX_LAYER) { status = "WON"; break; }
      const q2 = { subject: qSubject(questions), difficulty: layer, type: "CHOICE", id: "SYN" };
      syncCombat(items, layer, map[layer - 1], q2, {});
      if (items.combat) { items.combat.qStartMs = vt; items.combat.lastTickMs = vt; }
    } else {
      const q2 = { subject: qSubject(questions), difficulty: layer, type: "CHOICE", id: "SYN" };
      beginQuestionWindow(items.combat, q2, {});
      items.combat.qStartMs = vt; items.combat.lastTickMs = vt;
    }
  }

  return {
    status, layer, hp, maxHp, level, questions, kills,
    totalDmgDealt: Math.round(totalDmgDealt),
    totalDmgTaken: Math.round(totalDmgTaken),
    score,
    passives: items.passives.map((x) => x.ref),
  };
}

function aggregate(runs) {
  const n = runs.length;
  const won = runs.filter((r) => r.status === "WON").length;
  const layers = runs.map((r) => r.layer).sort((a, b) => a - b);
  const median = (arr) => (arr.length % 2 ? arr[(arr.length - 1) / 2] : (arr[arr.length / 2 - 1] + arr[arr.length / 2]) / 2);
  return {
    n,
    winRate: won / n,
    avgLayer: runs.reduce((s, r) => s + r.layer, 0) / n,
    medianLayer: median(layers),
    avgDmgDealt: runs.reduce((s, r) => s + r.totalDmgDealt, 0) / n,
    avgDmgTaken: runs.reduce((s, r) => s + r.totalDmgTaken, 0) / n,
  };
}

// ----------------------------- 主流程 -----------------------------
function parseArgs(argv) {
  const a = { n: 300, quiet: false, profiles: Object.keys(PROFILES) };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--n") a.n = parseInt(argv[++i], 10) || a.n;
    else if (argv[i] === "--quiet") a.quiet = true;
    else if (argv[i] === "--profile") { const p = argv[++i]; if (PROFILES[p]) a.profiles = [p]; }
  }
  return a;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const N = args.n;
  const fail = [];
  const t0 = Date.now();

  if (PASSIVES.length !== 28) fail.push(`被动表数量=${PASSIVES.length} ≠ 28`);

  // 1) 基线(无被动)，按学科分别计算(攻击树用数学、法术树用化学)
  const baseline = { 数学: {}, 化学: {} };
  for (const subj of ["数学", "化学"]) {
    for (const prof of args.profiles) {
      const runs = [];
      for (let i = 0; i < N; i++) runs.push(simulateRun({ passiveId: null, profile: prof, subjectMode: "home", _subject: subj, seed: (subj === "化学" ? 70000 : 1000) + i }));
      baseline[subj][prof] = aggregate(runs);
      const b = baseline[subj][prof];
      if (!isFinite(b.winRate) || b.winRate < 0 || b.winRate > 1) fail.push(`基线 ${subj}/${prof} 胜率非法`);
    }
  }
  if (baseline["数学"].strong && baseline["数学"].strong.winRate < 0.5) fail.push(`强玩家基线胜率过低，疑似战斗内核回归`);

  // 2) 每个被动的隔离强度曲线
  const curves = {};
  for (const p of PASSIVES) {
    curves[p.id] = {};
    const stackLevels = p.stackable ? [1, 2, 3] : [1];
    for (const prof of args.profiles) {
      curves[p.id][prof] = [];
      for (const st of stackLevels) {
        const runs = [];
        for (let i = 0; i < N; i++) {
          runs.push(simulateRun({ passiveId: p.id, stacks: st, profile: prof, subjectMode: "home", _subject: homeSubject(p), seed: (p.id.length * 131 + st * 17 + i * 7 + 999) >>> 0 }));
        }
        const agg = aggregate(runs);
        if (!isFinite(agg.winRate) || agg.winRate < 0 || agg.winRate > 1) fail.push(`被动 ${p.id}@${st} ${prof} 胜率非法: ${agg.winRate}`);
        curves[p.id][prof].push({ stacks: st, ...agg });
      }
    }
  }

  // 3) 生态跑：每级三选一随机选，检测系统可通关性与被动选取分布
  const eco = {};
  const ownedInWin = {}; const ownedTotal = {};
  for (const prof of args.profiles) {
    const runs = [];
    for (let i = 0; i < N; i++) {
      const r = simulateRun({ passiveId: null, profile: prof, subjectMode: "mix", autoPick: true, seed: (50000 + i * 13) >>> 0 });
      runs.push(r);
      const set = new Set(r.passives);
      for (const id of set) {
        ownedTotal[id] = (ownedTotal[id] || 0) + 1;
        if (r.status === "WON") ownedInWin[id] = (ownedInWin[id] || 0) + 1;
      }
    }
    eco[prof] = aggregate(runs);
  }

  // 回归门禁：任何「单 Passive 即把近乎绝望的弱玩家抬到必胜」都视为必赢被动回归。
  for (const p of PASSIVES) {
    const w = curves[p.id].weak.find((x) => x.stacks === 1);
    if (w && w.winRate >= 0.95 && baseline[homeSubject(p)].weak.winRate < 0.10) {
      fail.push(`被动 ${p.id} 单 Passive 即把弱玩家胜率抬到 ${(w.winRate * 100).toFixed(0)}%，疑似「必赢」被动回归`);
    }
  }

  // 相对强度用「有胜率余量的画像」(weak/brutal) 的匹配学科基线，避免天花板饱和误判。
  const liftAt = (id, prof, st) => {
    const a = curves[id][prof].find((x) => x.stacks === st);
    return a.winRate - baseline[homeSubject(id)][prof].winRate;
  };

  if (!args.quiet) {
    const line = (s) => process.stdout.write(s + "\n");
    line("");
    line("══════════════════════════════════════════════════════════════════════════");
    line("  V2.3 冒险模式 · 数值平衡与回归验证报告");
    line(`  样本量 n=${N}/配置 · 画像=[${args.profiles.join(",")}] · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    line("══════════════════════════════════════════════════════════════════════════");
    line("");
    line("【基线 · 无被动】 (胜率% / 平均层 / 中位层 / 平均承伤)");
    for (const subj of ["数学", "化学"]) {
      for (const prof of args.profiles) {
        const b = baseline[subj][prof];
        line(`  [${subj}] ${prof.padEnd(8)} 胜率=${(b.winRate * 100).toFixed(1)}%  平均层=${b.avgLayer.toFixed(1)}  中位层=${b.medianLayer}  承伤=${b.avgDmgTaken.toFixed(0)}`);
      }
    }
    line("");
    line("  说明：强/平均玩家胜率已触顶(100%/~92%)，胜率无法区分被动强弱；");
    line("        以下「弱 / 残酷」画像存在胜率余量，是被动强度的判别段。");
    line("");

    line("【28 被动强度曲线】(胜率% / 到达层，按叠层；强=天花板参考，弱/残酷=判别段)");
    line("  被动           树 稀有    强(1)   弱(1/2/3)            残酷(1/2/3)          弱承伤↓");
    const order = [...PASSIVES].sort((a, b) => a.tree.localeCompare(b.tree) || a.id.localeCompare(b.id));
    for (const p of order) {
      const f = (prof, st) => { const a = curves[p.id][prof].find((x) => x.stacks === st); return `${(a.winRate * 100).toFixed(0)}/${a.avgLayer.toFixed(0)}`; };
      const g = (prof) => p.stackable ? `${f(prof, 1)} ${f(prof, 2)} ${f(prof, 3)}` : `${f(prof, 1)}`;
      const dmgTaken = curves[p.id].weak.find((x) => x.stacks === 1).avgDmgTaken.toFixed(0);
      const strong = p.stackable ? `${f("strong", 1)} ${f("strong", 2)} ${f("strong", 3)}` : `${f("strong", 1)}`;
      line(`  ${p.name.padEnd(6)} ${p.id.padEnd(15)} ${p.tree.slice(0, 2)} ${p.rarity.padEnd(6)} ${strong.padEnd(20)} ${g("weak").padEnd(22)} ${g("brutal").padEnd(22)} ${dmgTaken}`);
    }
    line("");

    line("【相对基线提升 lift(胜率差, 叠1) — 仅用有胜率余量的画像排序，检测 OP / 死被动】");
    const ranks = PASSIVES.map((p) => {
      const liftWeak = liftAt(p.id, "weak", 1);
      const liftBrutal = liftAt(p.id, "brutal", 1);
      return {
        id: p.id, name: p.name, tree: p.tree, rarity: p.rarity,
        liftWeak, liftBrutal, liftAvg: (liftWeak + liftBrutal) / 2,
      };
    }).sort((a, b) => b.liftAvg - a.liftAvg);
    for (const r of ranks) {
      const dead = r.liftWeak <= 0.01 && r.liftBrutal <= 0.01;
      const op = r.liftAvg >= 0.40;
      const tag = dead ? " ◀死板/偏弱" : op ? " ◀过强(OP)" : "";
      line(`  ${r.name.padEnd(6)} ${r.id.padEnd(15)} ${r.rarity.padEnd(6)} lift均=${(r.liftAvg * 100).toFixed(1)}%  lift弱=${(r.liftWeak * 100).toFixed(1)}%  lift残酷=${(r.liftBrutal * 100).toFixed(1)}%${tag}`);
    }
    line("");

    line("【生态跑 · 随机三选一(系统可通关性 + 被动选取分布)】");
    for (const prof of args.profiles) {
      const e = eco[prof];
      line(`  ${prof.padEnd(8)} 胜率=${(e.winRate * 100).toFixed(1)}%  平均层=${e.avgLayer.toFixed(1)}  中位层=${e.medianLayer}`);
    }
    line("  被动「胜局拥有率」(随机三选一后，终局拥有该被动的对局中胜出比例；越高=越被需要)：");
    const ecoRows = PASSIVES.map((p) => {
      const tot = ownedTotal[p.id] || 0;
      const win = ownedInWin[p.id] || 0;
      return { id: p.id, name: p.name, rarity: p.rarity, tot, winRateWhenOwned: tot ? win / tot : 0 };
    }).sort((a, b) => b.winRateWhenOwned - a.winRateWhenOwned);
    for (const r of ecoRows) {
      line(`    ${r.name.padEnd(6)} ${r.id.padEnd(15)} ${r.rarity.padEnd(6)} 胜局拥有率=${(r.winRateWhenOwned * 100).toFixed(1)}% (n=${r.tot})`);
    }
    line("");
  }

  if (fail.length) {
    process.stdout.write("\n[REGRESSION FAIL]\n" + fail.map((f) => "  ✗ " + f).join("\n") + "\n");
    process.exit(1);
  }
  process.stdout.write(`\n[REGRESSION PASS] 28 被动强度曲线已验证，基线强玩家胜率 ${(baseline["数学"].strong?.winRate * 100).toFixed(1)}%\n`);
  process.exit(0);
}

main();
