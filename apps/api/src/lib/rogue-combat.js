// 冒险模式 · 即时制战斗内核（V2.0 + V2.1 被动效果）
//
// 设计要点
// 1) 战斗节拍归一化：每道题给固定 BEATS_PER_QUESTION 个「战斗秒」的窗口，
//    1 战斗秒 = 该题真实限时 / BEATS_PER_QUESTION。
//    这样 TMUA 的 5 分钟长题与 ESAT 的 30 秒短题，战斗压力一致；
//    而「每 8 秒刷新护盾」「灼烧 3 秒」这类技能描述仍然成立（单位是战斗秒）。
// 2) 超时判定用「真实时间」（切后台不能偷时间思考）；
//    战斗结算用「节拍 + dt 钳制」（切后台不会被敌人打死）。
// 3) 服务端权威：前端只发心跳带时间戳，所有伤害/回复由服务端按 dt 推进。
// 4) V2.1：被动技能效果在结算时由 computeStats(passives) 折算后传入
//    （stats 对象），内核只负责把 stats 应用到位，不关心具体技能。

import { damageTypeForSubject } from "./rogue-skills.js";

export const BEATS_PER_QUESTION = 60; // 每题窗口的战斗秒数
export const MAX_TICK_MS = 3000;      // 单次心跳最多推进的真实毫秒（防挂机后暴毙 / 防加速作弊）
export const ANSWER_GRACE_MS = 1500;  // 提交答案的网络宽限

// 无被动时的零值状态（避免每次都重建 computeStats）
export const EMPTY_STATS = {
  physAtkMult: 0, armorPen: 0, splash: 0, critChance: 0, critMult: 1.0, bloodBladePer10: 0,
  spellMult: 0, maxManaBonus: 0, cdMult: 1.0, manaCostMult: 1.0, scatterCount: 0, scatterDmg: 0.40,
  killMana: 0, spellSplash: 0, burn: null, voidBolt: null, overload: null,
  dmgReduce: 0, playerArmor: 0, dodge: 0, ironWill: 0, manaBarrier: null, reflect: 0, deathGuard: null,
  maxHpBonus: 0, meditation: 0, lifesteal: 0, bloodFeast: 0, lifeConvert: null, lifeFlow: null, manaBlood: null,
  owned: [],
};

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function rand(min, max) {
  return Math.random() * (max - min) + min;
}
function genEid() {
  return Math.random().toString(36).slice(2, 8);
}

// ===================== 题目限时 =====================
// TMUA：2 - 5 分钟；ESAT：0.5 - 2 分钟；其他学科：45 秒 - 2.75 分钟。均随难度线性递增。
export function questionLimitMs(question, opts = {}) {
  if (opts.test) return 20000; // 测试模式固定题：20 秒，便于快速验证即时制
  const d = Math.min(5, Math.max(1, Number(question?.difficulty) || 3));
  const tag = `${question?.subject || ""} ${question?.paper || ""}`;
  let sec;
  if (/TMUA/i.test(tag)) sec = 120 + (d - 1) * 45;
  else if (/ESAT/i.test(tag)) sec = 30 + (d - 1) * 22.5;
  else sec = 45 + (d - 1) * 30;
  if (opts.boss) sec *= 1.2; // Boss 题多给两成时间
  return Math.round(sec * 1000);
}

// ===================== 敌人 =====================
// 普通节点敌人数量：1-5 只加权随机（多数是 1-2 只，偶尔成群）
const ENEMY_COUNT_WEIGHTS = [1, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5];
const ENEMY_NAMES = ["岩甲兽", "腐叶精", "碎骨怪", "灰羽蝠", "沼泽伥"];
const BOSS_NAMES = { 5: "巨眼魔像", 10: "血翼蝠王", 15: "暗影蝠王", 20: "灭世魔像" };

// 攻击间隔（战斗秒）。窗口共 60 拍，所以：
//   普通怪 16 拍 → 完美出手(30%)只挨 1 刀、迅捷(60%)挨 2 刀、拖满挨 3 刀
//   Boss   20 拍 → 完美出手一刀不挨、迅捷挨 1 刀、拖满挨 3 刀
const NORMAL_INTERVAL = 16;
const BOSS_INTERVAL = 20;

export function spawnEnemies(layer, nodeType) {
  if (nodeType === "boss") {
    const bossLayer = [5, 10, 15, 20].find((l) => l === layer) || 5;
    // 目标：迅捷出手 3-4 次打死，配合 TMUA 长题也不会拖成半小时
    const maxHp = Math.round(40 + layer * 4);
    return [{
      eid: genEid(),
      kind: "boss",
      name: BOSS_NAMES[bossLayer] || BOSS_NAMES[5],
      sprite: [5, 10, 15, 20].indexOf(bossLayer),
      hp: maxHp, maxHp,
      atk: Math.round(7 + layer * 0.6),
      armor: 5,
      interval: BOSS_INTERVAL,
      nextAtkBeat: BOSS_INTERVAL,
    }];
  }
  const n = ENEMY_COUNT_WEIGHTS[randInt(0, ENEMY_COUNT_WEIGHTS.length - 1)];
  // 群怪：单体血量按数量衰减（多数一击必杀），攻击间隔同步拉长，
  // 保证「一题窗口内全队总出手次数」不随数量线性爆炸——快答几乎不挨打，慢答被围殴。
  const hpScale = 1 / (0.55 * n + 0.45);
  const interval = NORMAL_INTERVAL * (1 + 0.4 * (n - 1));
  const baseHp = 18 + layer * 1.5;
  const list = [];
  for (let i = 0; i < n; i++) {
    const maxHp = Math.max(6, Math.round(baseHp * hpScale));
    list.push({
      eid: genEid(),
      kind: "normal",
      name: ENEMY_NAMES[randInt(0, ENEMY_NAMES.length - 1)],
      sprite: randInt(0, 4),
      hp: maxHp, maxHp,
      atk: Math.round(6 + layer * 0.5),
      armor: layer >= 10 ? 2 : 0,
      interval,
      // 错开首次出手，避免开局同时挨打
      nextAtkBeat: interval * (0.6 + 0.2 * i),
    });
  }
  return list;
}

export function aliveEnemies(combat) {
  return (combat?.enemies || []).filter((e) => e.hp > 0);
}

// ===================== 战斗状态初始化 / 换题 =====================
export function newCombat(layer, nodeType, question, opts = {}) {
  const limit = questionLimitMs(question, { boss: nodeType === "boss", test: opts.test });
  const now = Date.now();
  return {
    layer,
    nodeType,
    enemies: spawnEnemies(layer, nodeType),
    totalBeat: 0,
    qStartBeat: 0,
    beatMs: limit / BEATS_PER_QUESTION,
    qLimitMs: limit,
    qStartMs: now,
    lastTickMs: now,
  };
}

// 换到下一题：保留敌人与累计节拍，重置本题窗口（敌人重新蓄力，给玩家一个喘息）
export function beginQuestionWindow(combat, question, opts = {}) {
  const limit = questionLimitMs(question, { boss: combat.nodeType === "boss", test: opts.test });
  const now = Date.now();
  combat.beatMs = limit / BEATS_PER_QUESTION;
  combat.qLimitMs = limit;
  combat.qStartMs = now;
  combat.lastTickMs = now;
  combat.qStartBeat = combat.totalBeat;
  combat.enemies.forEach((e) => {
    if (e.hp > 0) e.nextAtkBeat = combat.totalBeat + e.interval;
  });
}

// 确保 items.combat 与当前节点/题目一致；换层或全灭则重新生成敌人
export function syncCombat(items, layer, nodeType, question, opts = {}) {
  if (nodeType === "reward" || !question) {
    items.combat = null;
    return;
  }
  const c = items.combat;
  if (!c || c.layer !== layer || c.nodeType !== nodeType || !aliveEnemies(c).length) {
    items.combat = newCombat(layer, nodeType, question, opts);
  } else {
    beginQuestionWindow(c, question, opts);
  }
}

// ===================== 伤害结算 =====================
// 玩家攻击力：等级 + 武器加成（不含被动，被动倍率在 computePlayerDamage 里叠）
export function playerAtk(items, level) {
  const weapon = items.equipped?.weapon?.bonus?.score || 0;
  return 14 + (Math.max(1, level) - 1) * 2 + weapon * 3;
}

// 答题速度 → 伤害倍率。越快越狠，逼学生又快又准。
export function speedTier(ratio) {
  if (ratio <= 0.3) return { mult: 1.5, label: "perfect", text: "完美出手" };
  if (ratio <= 0.6) return { mult: 1.25, label: "good", text: "迅捷出手" };
  return { mult: 1.0, label: "slow", text: "普通出手" };
}

// 玩家对敌人造成伤害（护甲减免，支持破甲穿透）
export function damageEnemy(enemy, amount, armorPen = 0) {
  const eff = Math.max(0, (enemy.armor || 0) * (1 - armorPen));
  const dealt = Math.max(1, Math.round(amount - eff));
  enemy.hp = Math.max(0, enemy.hp - dealt);
  return { dealt, killed: enemy.hp <= 0 };
}

// 玩家这一击的最终伤害（在护甲减免之前）：按学科选物理/法术倍率，
// 应用血刃狂攻（按已损失生命）与暴击。返回未扣护甲的 amount 及暴击信息。
export function computePlayerDamage(stats, base, subject, hpRatio = 0) {
  const s = stats || EMPTY_STATS;
  const type = damageTypeForSubject(subject);
  let amount = base;
  let crit = false;
  let critMult = 1;
  if (type === "spell") {
    amount *= 1 + s.spellMult;
    // 魔力过载：蓝量足时额外 +40%
    if (s.overload && (s._manaActive !== false)) amount *= 1 + s.overload.mult;
  } else {
    amount *= 1 + s.physAtkMult;
    // 血刃狂攻：每损失 10% 生命 +8%
    if (s.bloodBladePer10 > 0 && hpRatio > 0) {
      const lost = Math.floor(hpRatio / 0.1);
      amount *= 1 + s.bloodBladePer10 * lost;
    }
    // 致命一击
    if (s.critChance > 0 && Math.random() < s.critChance) {
      crit = true;
      critMult = s.critMult;
      amount *= critMult;
    }
  }
  return { amount: Math.max(1, amount), type, crit, critMult };
}

// 附灼烧 DoT 到敌人（法术命中时调用）。perBeat 按法术伤害比例均摊到持续拍数。
export function applyBurn(enemy, spellDmg, stats, totalBeat) {
  if (!stats || !stats.burn || !enemy) return;
  const dur = stats.burn.dur;
  const perBeat = Math.max(1, (spellDmg * stats.burn.pct) / dur);
  enemy.burn = { untilBeat: totalBeat + dur, dmgPerBeat: perBeat };
}

// 敌人对玩家造成伤害（被动减伤/护甲/闪避/临时护盾/钢铁意志/濒死守护）
// ctx: { stats, maxHp, totalBeat }
export function damagePlayer(items, hp, rawAmount, ctx = {}) {
  const s = ctx.stats || EMPTY_STATS;
  const maxHp = ctx.maxHp || 100;
  const totalBeat = ctx.totalBeat || 0;
  // 闪避：完全免伤
  if (s.dodge > 0 && Math.random() < s.dodge) {
    return { hp, dealt: 0, blocked: false, dodged: true };
  }
  let dmg = Math.max(1, Math.round(rawAmount));
  // 减伤（所有伤害）
  if (s.dmgReduce > 0) dmg = Math.max(1, Math.round(dmg * (1 - s.dmgReduce)));
  // 玩家护甲（固定减免）
  if (s.playerArmor > 0) dmg = Math.max(1, dmg - s.playerArmor);

  // 濒死守护：血量将低于 20% 时瞬间获得大额临时护盾（一局一次）——先计算，再被护盾吸收
  if (s.deathGuard && !items.deathGuardUsed && hp - dmg <= maxHp * 0.2) {
    items.deathGuardUsed = true;
    items.tempShield = (items.tempShield || 0) + Math.round(maxHp * s.deathGuard.pct);
  }
  // 临时护盾（濒死守护 / 魔力屏障）先吸收
  if (items.tempShield > 0) {
    const absorbed = Math.min(items.tempShield, dmg);
    items.tempShield -= absorbed;
    dmg -= absorbed;
    if (items.tempShield <= 0) items.tempShield = 0;
  }
  // 钢铁意志：致命伤保留 1 血（一局最多 N 次）
  if (dmg >= hp && s.ironWill > 0 && (items.ironWillUsed || 0) < s.ironWill) {
    items.ironWillUsed = (items.ironWillUsed || 0) + 1;
    return { hp: 1, dealt: hp - 1, blocked: true, ironWill: true };
  }
  const newHp = Math.max(0, hp - dmg);
  // 生命奔流：受伤暂停回血窗口
  if (s.lifeFlow) items.lifeFlowPauseUntil = totalBeat + s.lifeFlow.pause;
  return { hp: newHp, dealt: hp - newHp, blocked: false };
}

// ===================== 时间轴推进 =====================
// 按 dt 推进战斗节拍，结算敌人自动攻击、反弹、灼烧 DoT 与周期维持。
// ctx: { stats, maxHp }
export function simulate(items, hp, nowMs, ctx = {}) {
  const c = items.combat;
  const events = [];
  if (!c) return { hp, events };
  const dt = Math.max(0, Math.min(MAX_TICK_MS, nowMs - (c.lastTickMs || nowMs)));
  c.lastTickMs = nowMs;
  if (hp <= 0) return { hp, events };
  const dBeat = c.beatMs > 0 ? dt / c.beatMs : 0;
  c.totalBeat += dBeat;

  const s = ctx.stats || EMPTY_STATS;
  const maxHp = ctx.maxHp || 100;
  const prevBeat = c.totalBeat - dBeat; // 推进前的节拍，供周期效果首次初始化

  // —— 周期维持（在敌人出手前，先回蓝/耗蓝/回血/刷新屏障）——
  upkeep(items, s, maxHp, dBeat, c.totalBeat, prevBeat, events);
  if (items._lifeFlowHeal) {
    const before = hp;
    hp = Math.min(maxHp, hp + items._lifeFlowHeal);
    items._lifeFlowHeal = 0;
    if (hp > before) events.push({ type: "lifeflow", heal: hp - before });
  }

  for (const e of c.enemies) {
    if (e.hp <= 0) continue;
    let guard = 0;
    while (c.totalBeat >= e.nextAtkBeat && guard++ < 12) {
      e.nextAtkBeat += e.interval;
      if (hp <= 0) break;
      const raw = e.atk * rand(0.85, 1.15);
      const r = damagePlayer(items, hp, raw, { stats: s, maxHp, totalBeat: c.totalBeat });
      hp = r.hp;
      events.push({ type: "enemy_hit", eid: e.eid, name: e.name, dmg: r.dealt, blocked: r.blocked, dodged: r.dodged, ironWill: !!r.ironWill });
      // 反弹外壳：近战受击反弹部分伤害
      if (r.dealt > 0 && s.reflect > 0) {
        const rd = damageEnemy(e, r.dealt * s.reflect, s.armorPen);
        events.push({ type: "reflect", eid: e.eid, name: e.name, dmg: rd.dealt });
      }
    }
    // 灼烧 DoT：按本拍流逝时长结算（粗心跳也不会漏拍）
    if (e.burn) {
      const wasActive = c.totalBeat - dBeat < e.burn.untilBeat; // 本拍开始时仍处于灼烧窗口
      if (wasActive) {
        const bd = Math.max(1, Math.round(e.burn.dmgPerBeat * dBeat));
        e.hp = Math.max(0, e.hp - bd);
        events.push({ type: "burn", eid: e.eid, name: e.name, dmg: bd });
      }
      if (c.totalBeat >= e.burn.untilBeat) e.burn = null;
    }
  }
  return { hp, events };
}

// 周期维持：冥想回蓝 / 魔力过载耗蓝 / 生命奔流 / 魔力屏障
function upkeep(items, s, maxHp, dBeat, totalBeat, prevBeat, events) {
  // 冥想回蓝（魔力血祭会停止自然回蓝）
  if (s.meditation > 0 && !s.manaBlood && items.mana < items.maxMana) {
    items.mana = Math.min(items.maxMana, items.mana + s.meditation * dBeat);
  }
  // 魔力过载：按节拍持续耗蓝
  if (s.overload && items.mana > 0) {
    items.mana = Math.max(0, items.mana - s.overload.drain * dBeat);
  }
  // 生命奔流：每 interval 拍回血，受伤暂停
  if (s.lifeFlow) {
    if (items.lifeFlowNextBeat == null) items.lifeFlowNextBeat = prevBeat + s.lifeFlow.interval;
    if (totalBeat >= items.lifeFlowNextBeat && totalBeat >= (items.lifeFlowPauseUntil || 0)) {
      const heal = Math.round(maxHp * s.lifeFlow.pct);
      items._lifeFlowHeal = (items._lifeFlowHeal || 0) + heal;
      items.lifeFlowNextBeat += s.lifeFlow.interval;
    }
  }
  // 魔力屏障：每 cd 拍刷新护盾（消耗蓝）
  if (s.manaBarrier && totalBeat >= (items.barrierNextBeat || 0) && items.mana >= s.manaBarrier.cost) {
    items.mana -= s.manaBarrier.cost;
    items.tempShield = Math.max(items.tempShield || 0, Math.round(items.maxMana * s.manaBarrier.pct));
    items.barrierNextBeat = totalBeat + s.manaBarrier.cd;
    events.push({ type: "barrier", shield: items.tempShield });
  }
}

// 超时：视为一次落空，并挨一记重击
export function isTimedOut(combat, nowMs = Date.now()) {
  if (!combat) return false;
  return nowMs - combat.qStartMs > combat.qLimitMs;
}
export function timeoutStrike(items, hp, ctx = {}) {
  const c = items.combat;
  const target = aliveEnemies(c)[0];
  const raw = (target ? target.atk : 8) * 1.5;
  const r = damagePlayer(items, hp, raw, ctx);
  return { hp: r.hp, dmg: r.dealt, blocked: r.blocked, name: target?.name || "敌人" };
}

// ===================== 给前端的视图 =====================
export function combatView(items, nowMs = Date.now()) {
  const c = items.combat;
  if (!c) return null;
  return {
    layer: c.layer,
    nodeType: c.nodeType,
    // 累计节拍 & 本题起始节拍：前端按本地倒计时反推当前节拍，画平滑的蓄力环（心跳之间不抖动）
    totalBeat: c.totalBeat,
    qStartBeat: c.qStartBeat,
    enemies: c.enemies.map((e) => ({
      eid: e.eid, name: e.name, kind: e.kind, sprite: e.sprite,
      hp: e.hp, maxHp: e.maxHp,
      interval: e.interval,
      nextAtkBeat: e.nextAtkBeat,
      // 蓄力进度 0-1（服务端快照，前端以本地计算为准）
      windup: e.hp > 0 ? Math.max(0, Math.min(1, 1 - (e.nextAtkBeat - c.totalBeat) / e.interval)) : 0,
      // 灼烧状态（V2.2 前端展示用）：是否燃烧 + 剩余节拍
      burning: !!(e.burn && e.hp > 0 && c.totalBeat < e.burn.untilBeat),
      burnLeft: e.burn ? Math.max(0, Math.round((e.burn.untilBeat - c.totalBeat) * 10) / 10) : 0,
    })),
    qLimitMs: c.qLimitMs,
    qRemainMs: Math.max(0, c.qLimitMs - (nowMs - c.qStartMs)),
    beatMs: c.beatMs,
  };
}
