// Roguelike 冒险模式（V1.6：爬塔战斗系统 + 装备/物品/技能/蓝条/掉落/升级三选一）
// 进度规则不变：每层一节点 normal/reward/boss；答对推进、答错扣血；血尽 DEAD，20 层 WON。
// 战斗系统（全部存于 items JSON，不改 schema）：
//  - 装备 gear：weapon(每答对+分)/armor(+生命上限)/trinket(+蓝上限/回蓝)，可点击穿戴到身上（equipped[slot]），有被动加成
//  - 物品 item：heal(恢复)/attack(下次作答必中)/defense(护盾)/utility(提示)，点击使用
//  - 技能 skill：分级、耗蓝，攻击/恢复/防御/辅助，升级时三选一获得
//  - 消灭怪物随机掉落装备或物品；蓝条随答对回复
import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth } from "../middleware/auth.js";
import { isAnswerCorrect } from "../lib/grading.js";
import {
  ANSWER_GRACE_MS,
  aliveEnemies,
  beginQuestionWindow,
  combatView,
  damageEnemy,
  damagePlayer,
  isTimedOut,
  playerAtk,
  simulate,
  speedTier,
  syncCombat,
  timeoutStrike,
  computePlayerDamage,
  applyBurn,
  EMPTY_STATS,
} from "../lib/rogue-combat.js";
import {
  computeStats,
  pickThreePassives,
  addPassive,
  passiveGainStats,
  PASSIVE_BY_ID,
  PASSIVES,
} from "../lib/rogue-skills.js";

const router = Router();

const MAX_LAYER = 20; // 通关层数
// 测试模式固定题：用户开启测试模式后,所有题目替换为这一题,便于快速验证 UI / 战斗流程
const TEST_QUESTION = {
  id: "TEST_Q",
  subject: "数学",
  topic: "测试",
  topicIds: [],
  difficulty: 1,
  type: "CHOICE",
  stem: "1+1=?",
  options: ["2", "3"],
  answer: "2",
  solution: "1+1=2",
};
const QUIZ_FIELDS = {
  id: true, subject: true, paper: true, topic: true, topicIds: true, difficulty: true,
  type: true, stem: true, options: true, answer: true, solution: true,
};

// ===================== 装备 / 物品 / 技能 池 =====================
const GEAR_POOL = [
  { id: "w_wood", slot: "weapon", name: "木剑", icon: "🗡", bonus: { score: 1 }, desc: "每答对 +1 分" },
  { id: "w_iron", slot: "weapon", name: "铁剑", icon: "⚔", bonus: { score: 2 }, desc: "每答对 +2 分" },
  { id: "w_flame", slot: "weapon", name: "烈焰剑", icon: "🔥", bonus: { score: 3 }, desc: "每答对 +3 分" },
  { id: "a_leather", slot: "armor", name: "皮甲", icon: "🛡", bonus: { hp: 10 }, desc: "生命上限 +10" },
  { id: "a_iron", slot: "armor", name: "铁甲", icon: "🛡", bonus: { hp: 18 }, desc: "生命上限 +18" },
  { id: "a_holy", slot: "armor", name: "圣铠", icon: "✨", bonus: { hp: 28 }, desc: "生命上限 +28" },
  { id: "t_amber", slot: "trinket", name: "琥珀", icon: "🔮", bonus: { mana: 2 }, desc: "蓝上限 +2" },
  { id: "t_star", slot: "trinket", name: "星之坠", icon: "🌟", bonus: { mana: 3, regen: 1 }, desc: "蓝上限 +3，每答对回蓝 +1" },
];
const ITEM_POOL = [
  { id: "i_heal", type: "heal", name: "治疗药水", icon: "🧪", heal: 18, desc: "回复 12-21 生命" },
  { id: "i_heal_big", type: "heal", name: "大治疗药水", icon: "💗", heal: 34, desc: "回复 26-39 生命" },
  { id: "i_atk", type: "attack", name: "力量药剂", icon: "💥", desc: "下次作答必中（自动答对）" },
  { id: "i_shield", type: "defense", name: "护盾", icon: "🛡", desc: "抵挡一次答错扣血" },
  { id: "i_hint", type: "utility", name: "提示卷轴", icon: "💡", desc: "排除 2 个错误选项" },
];
const SKILL_POOL = [
  { id: "s_fireball", tier: 1, type: "attack", name: "火球术", icon: "🔥", cost: 3, bonus: 0, desc: "下次作答必中（自动答对）" },
  { id: "s_heal", tier: 1, type: "heal", name: "治疗术", icon: "💚", cost: 4, heal: 18, desc: "回复 14-21 生命" },
  { id: "s_shield", tier: 1, type: "defense", name: "守护", icon: "🛡", cost: 3, blocks: 1, desc: "抵挡一次答错扣血" },
  { id: "s_focus", tier: 1, type: "utility", name: "专注", icon: "💡", cost: 2, desc: "排除 2 个错误选项" },
  { id: "s_strike", tier: 2, type: "attack", name: "雷霆斩", icon: "⚡", cost: 5, bonus: 10, desc: "下次作答必中，并 +10 分" },
  { id: "s_regen", tier: 2, type: "heal", name: "生命涌动", icon: "🌿", cost: 5, heal: 34, desc: "回复 26-39 生命" },
  { id: "s_berserk", tier: 2, type: "utility", name: "狂暴", icon: "😤", cost: 4, desc: "本次答对得分翻倍" },
  { id: "s_meteor", tier: 3, type: "attack", name: "陨石术", icon: "☄️", cost: 7, bonus: 20, desc: "下次作答必中，并 +20 分" },
  { id: "s_aegis", tier: 3, type: "defense", name: "圣盾", icon: "🪬", cost: 6, blocks: 2, desc: "抵挡两次答错扣血" },
  { id: "s_phoenix", tier: 3, type: "heal", name: "凤凰祝福", icon: "🦅", cost: 8, heal: 999, desc: "回复全部生命" },
];
const GEAR_BY_ID = Object.fromEntries(GEAR_POOL.map((g) => [g.id, g]));
const ITEM_BY_ID = Object.fromEntries(ITEM_POOL.map((i) => [i.id, i]));
const SKILL_BY_ID = Object.fromEntries(SKILL_POOL.map((s) => [s.id, s]));

function genId() { return Math.random().toString(36).slice(2, 9); }
function mkGearEntry(poolId) {
  const m = GEAR_BY_ID[poolId];
  return { uid: genId(), ref: poolId, kind: "gear", slot: m.slot, name: m.name, icon: m.icon, desc: m.desc, bonus: m.bonus };
}
function mkItemEntry(poolId) {
  const m = ITEM_BY_ID[poolId];
  return { uid: genId(), ref: poolId, kind: "item", type: m.type, name: m.name, icon: m.icon, desc: m.desc };
}
function randomFrom(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

function defaultItems() {
  return {
    answered: [], inventory: [], map: genMap(MAX_LAYER),
    mana: 10, maxMana: 10, level: 1, xp: 0,
    equipped: {}, skills: [], pendingSkills: null, pendingCount: 0,
    autoCorrect: false, pendingScoreBonus: 0, shield: false, shieldCount: 0, berserk: false,
    test: false,
    passives: [], // V2.1：已拥有被动 [{ ref, stacks }]
    // V2.1 被动相关的战斗状态
    tempShield: 0, ironWillUsed: 0, deathGuardUsed: false,
    lifeFlowNextBeat: null, lifeFlowPauseUntil: 0, barrierNextBeat: 0, voidCdUntil: 0,
    combat: null, // V2.0 即时制战斗状态（敌人 / 节拍时钟 / 本题窗口）
  };
}
function parseItems(raw) {
  try {
    const v = JSON.parse(raw || "{}");
    if (Array.isArray(v)) return { ...defaultItems(), answered: v, inventory: [], map: genMap(MAX_LAYER) };
    const d = defaultItems();
    return {
      answered: Array.isArray(v.answered) ? v.answered : [],
      inventory: Array.isArray(v.inventory) ? v.inventory : [],
      map: Array.isArray(v.map) && v.map.length === MAX_LAYER ? v.map : d.map,
      mana: typeof v.mana === "number" ? v.mana : d.mana,
      maxMana: typeof v.maxMana === "number" ? v.maxMana : d.maxMana,
      level: typeof v.level === "number" ? v.level : d.level,
      xp: typeof v.xp === "number" ? v.xp : d.xp,
      equipped: v.equipped && typeof v.equipped === "object" ? v.equipped : d.equipped,
      skills: Array.isArray(v.skills) ? v.skills : d.skills,
      pendingSkills: Array.isArray(v.pendingSkills) ? v.pendingSkills : null,
      pendingCount: typeof v.pendingCount === "number" ? v.pendingCount : 0,
      autoCorrect: !!v.autoCorrect,
      pendingScoreBonus: typeof v.pendingScoreBonus === "number" ? v.pendingScoreBonus : 0,
      shield: !!v.shield,
      shieldCount: typeof v.shieldCount === "number" ? v.shieldCount : 0,
      berserk: !!v.berserk,
      test: !!v.test,
      passives: Array.isArray(v.passives) ? v.passives : d.passives,
      tempShield: typeof v.tempShield === "number" ? v.tempShield : 0,
      ironWillUsed: typeof v.ironWillUsed === "number" ? v.ironWillUsed : 0,
      deathGuardUsed: !!v.deathGuardUsed,
      lifeFlowNextBeat: v.lifeFlowNextBeat == null ? null : v.lifeFlowNextBeat,
      lifeFlowPauseUntil: typeof v.lifeFlowPauseUntil === "number" ? v.lifeFlowPauseUntil : 0,
      barrierNextBeat: typeof v.barrierNextBeat === "number" ? v.barrierNextBeat : 0,
      voidCdUntil: typeof v.voidCdUntil === "number" ? v.voidCdUntil : 0,
      combat: v.combat && typeof v.combat === "object" ? v.combat : null,
    };
  } catch {
    return defaultItems();
  }
}
// 计算当前被动折算（供战斗内核与前端使用）
function computePassiveStats(items) {
  const stats = computeStats(items.passives);
  // 魔力过载仅在蓝量 > 0 时生效（内核据此决定倍率）
  stats._manaActive = items.mana > 0;
  return stats;
}
// 把战斗状态额外字段附到响应里，前端统一读取
function extraState(items) {
  const stats = computePassiveStats(items);
  return {
    mana: items.mana, maxMana: items.maxMana, level: items.level,
    equipped: items.equipped, skills: items.skills, pendingSkills: items.pendingSkills,
    inventory: items.inventory, autoCorrect: items.autoCorrect,
    passives: items.passives,
    passiveStats: stats,
    // V2.2 前端状态可视化：临时护盾 / 主动被动冷却 / 一次性守护消耗情况
    tempShield: items.tempShield || 0,
    voidCdUntil: items.voidCdUntil || 0,
    ironWillUsed: items.ironWillUsed || 0,
    deathGuardUsed: !!items.deathGuardUsed,
    combat: combatView(items),
  };
}

function genMap(len) {
  const map = [];
  for (let i = 1; i <= len; i++) {
    if (i % 5 === 0) map.push("boss");
    else if (i % 3 === 0) map.push("reward");
    else map.push("normal");
  }
  return map;
}
function publicQuestion(q) {
  let ids = q.topicIds;
  try {
    const v = JSON.parse(ids || "[]");
    ids = Array.isArray(v) ? v : [];
  } catch {
    ids = [];
  }
  return { ...q, options: safeParseOptions(q.options), topicIds: ids };
}
function safeParseOptions(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}
// 随机整数 [min, max]
function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
// 回复数值带随机性:以 base 为中心上下波动(满血 999 除外)
function rollHeal(base) {
  if (base >= 999) return base;
  const lo = Math.max(1, Math.round(base * 0.75));
  const hi = Math.round(base * 1.15);
  return randInt(lo, hi);
}
// HP 基准(数值化,带随机伤害/回复)
const BASE_HP = 100;

// 提示用：测试模式直接返回固定题,否则查库
async function resolveQuestionForHint(run, questionId) {
  const items = parseItems(run.items);
  if (items.test && questionId === TEST_QUESTION.id) return TEST_QUESTION;
  return prisma.question.findUnique({ where: { id: questionId }, select: QUIZ_FIELDS });
}

// 抽一题
async function pickQuestion(run, opts = {}) {
  const items = parseItems(run.items);
  if (items.test) return publicQuestion(TEST_QUESTION);
  const exclude = new Set(items.answered);
  const subs = run.subject === "数学" ? ["数学", "TMUA"] : run.subject === "ESAT" ? ["ESAT", "数学", "物理"] : [run.subject];
  const subjectWhere = subs.length === 1 ? subs[0] : { in: subs };

  async function findPool(diffWhere) {
    const all = await prisma.question.findMany({ where: { status: "PUBLISHED", subject: subjectWhere, difficulty: diffWhere }, select: { id: true } });
    if (!all.length) return [];
    const fresh = all.filter((q) => !exclude.has(q.id));
    return fresh.length ? fresh : all;
  }

  let pool = [];
  if (opts.boss) {
    const wb = await prisma.wrongBook.findMany({ where: { studentId: run.studentId, mastered: false }, select: { questionId: true } });
    const cand = wb.map((w) => w.questionId).filter((id) => !exclude.has(id));
    if (cand.length) {
      const qs = await prisma.question.findMany({
        where: { id: { in: cand.slice(0, 40) }, status: "PUBLISHED", subject: subjectWhere },
        select: { id: true },
      });
      pool = qs.length ? qs : [];
    }
    if (!pool.length) {
      for (let d = Math.min(run.difficulty + 1, 5); d >= 1; d--) {
        pool = await findPool(d);
        if (pool.length) break;
      }
      if (!pool.length) pool = await findPool(undefined);
    }
  } else {
    pool = await findPool(run.difficulty);
    if (!pool.length) {
      for (let delta = 1; delta <= 4; delta++) {
        if (run.difficulty + delta <= 5) { pool = await findPool(run.difficulty + delta); if (pool.length) break; }
        if (run.difficulty - delta >= 1) { pool = await findPool(run.difficulty - delta); if (pool.length) break; }
      }
    }
    if (!pool.length) pool = await findPool(undefined);
  }
  if (!pool.length) return null;
  const picked = pool[Math.floor(Math.random() * pool.length)];
  const q = await prisma.question.findUnique({ where: { id: picked.id }, select: QUIZ_FIELDS });
  return q ? publicQuestion(q) : null;
}

// 连击奖励（额外物品）
function comboReward(combo) {
  if (combo === 3) return { message: "3 连对!生命恢复", coins: 2, heal: randInt(6, 12), items: ["i_heal"] };
  if (combo === 5) return { message: "5 连对!获得护盾 ×1", coins: 5, heal: 0, items: ["i_shield"] };
  if (combo === 10) return { message: "10 连对!获得治疗药水 ×1", coins: 10, heal: 0, items: ["i_heal"] };
  if (combo > 0 && combo % 5 === 0) return { message: `${combo} 连对!金币奖励`, coins: 5, heal: 0, items: [] };
  return { coins: 0, heal: 0, items: [] };
}

// 升级判定：xp 达到 level*3 升级，触发被动三选一
function checkLevelUp(items) {
  let leveled = false;
  while (items.xp >= items.level * 3) {
    items.xp -= items.level * 3;
    items.level += 1;
    leveled = true;
    if (!items.pendingSkills || items.pendingSkills.length === 0) {
      items.pendingSkills = pickThreePassives(items.passives);
    } else {
      items.pendingCount += 1;
    }
  }
  return leveled;
}

// 掉落：消灭怪物随机掉落装备或物品
function rollDrop(items, isBoss) {
  const dropped = [];
  if (isBoss) {
    dropped.push(mkGearEntry(randomFrom(GEAR_POOL).id));
    if (Math.random() < 0.3) dropped.push(mkItemEntry(randomFrom(ITEM_POOL).id));
  } else if (Math.random() < 0.35) {
    if (Math.random() < 0.5) dropped.push(mkGearEntry(randomFrom(GEAR_POOL).id));
    else dropped.push(mkItemEntry(randomFrom(ITEM_POOL).id));
  }
  dropped.forEach((d) => items.inventory.push(d));
  return dropped;
}

// 推进到下一节点
async function nextNode(run) {
  const items = parseItems(run.items);
  const nodeType = items.map[run.layer - 1] || "normal";
  if (nodeType === "reward") return { nodeType: "reward", question: null };
  const question = await pickQuestion(run, { boss: nodeType === "boss" });
  return { nodeType, question };
}

// 计算当前武器加分与饰品回蓝
function weaponBonus(items) { return items.equipped?.weapon?.bonus?.score || 0; }
function trinketRegen(items) { return items.equipped?.trinket?.bonus?.regen || 0; }

// GET /api/roguelike/active
router.get(
  "/active",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findFirst({
      where: { studentId: req.user.id, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    });
    if (!run) return ok(res, { run: null });
    const node = await nextNode(run);
    ok(res, { run, ...extraState(parseItems(run.items)), ...node });
  })
);

// POST /api/roguelike/start
router.post(
  "/start",
  requireAuth,
  asyncHandler(async (req, res) => {
    const subject = String(req.body?.subject || "").trim() || "数学";
    const difficulty = req.body?.difficulty ? Number(req.body.difficulty) : 3;
    const test = !!req.body?.test;

    // 续局需与请求模式(test 标志)一致:测试模式续测试局,普通模式续普通局,互不干扰、各自保留进度
    const activeRuns = await prisma.roguelikeRun.findMany({
      where: { studentId: req.user.id, status: "ACTIVE" },
      orderBy: { updatedAt: "desc" },
    });
    const existing = activeRuns.find((r) => !!parseItems(r.items).test === test) || null;
    if (existing) {
      const node = await nextNode(existing);
      if (node.nodeType !== "reward" && !node.question) {
        return fail(res, 400, "当前进行中的冒险暂无可用题目,请结算或更换学科");
      }
      // 续局:重开本题窗口(不让玩家一回来就因为离线时长被判超时/暴毙)
      const exItems = parseItems(existing.items);
      syncCombat(exItems, existing.layer, node.nodeType, node.question, { test: exItems.test });
      await prisma.roguelikeRun.update({ where: { id: existing.id }, data: { items: JSON.stringify(exItems) } });
      return ok(res, { run: existing, ...extraState(exItems), ...node }, "继续上次冒险");
    }

    const runItems = defaultItems();
    runItems.test = test;
    const run = await prisma.roguelikeRun.create({
      data: {
        studentId: req.user.id,
        subject,
        difficulty,
        hp: BASE_HP,
        maxHp: BASE_HP,
        items: JSON.stringify(runItems),
      },
    });
    const node = await nextNode(run);
    if (node.nodeType !== "reward" && !node.question) {
      await prisma.roguelikeRun.delete({ where: { id: run.id } });
      const mapped = subject === "数学" ? "数学/TMUA" : subject === "ESAT" ? "ESAT/数学/物理" : subject;
      return fail(res, 400, `该学科/难度暂无可用题目,请选择其他学科(当前匹配题库:${mapped})`);
    }
    // 生成第一波敌人并开启第一题的计时窗口
    syncCombat(runItems, run.layer, node.nodeType, node.question, { test });
    await prisma.roguelikeRun.update({ where: { id: run.id }, data: { items: JSON.stringify(runItems) } });
    ok(res, { run, ...extraState(runItems), ...node }, "冒险开始");
  })
);

// POST /api/roguelike/:runId/answer
router.post(
  "/:runId/answer",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const { questionId, selected } = req.body || {};
    if (!questionId) return fail(res, 400, "questionId 必填");
    const items = parseItems(run.items);
    const nodeType = items.map[run.layer - 1] || "normal";
    const stats = computePassiveStats(items); // V2.1 被动折算

    let question;
    if (items.test && questionId === TEST_QUESTION.id) {
      question = TEST_QUESTION;
    } else {
      question = await prisma.question.findUnique({ where: { id: questionId } });
      if (!question || question.status !== "PUBLISHED") return fail(res, 404, "题目不存在");
    }

    const now = Date.now();
    let { layer, hp, combo, maxCombo, score, coins, status } = run;
    const events = [];

    // 先把心跳空档期补算掉:防止玩家靠「不发心跳」白嫖时间
    {
      const sim = simulate(items, hp, now, { stats, maxHp: run.maxHp });
      hp = sim.hp;
      events.push(...sim.events);
    }

    const c = items.combat;
    const elapsed = c ? now - c.qStartMs : 0;
    const overtime = !!(c && elapsed > c.qLimitMs + ANSWER_GRACE_MS);

    let correct = isAnswerCorrect(question, selected);
    // 攻击道具/技能：下次作答必中
    let forcedByItem = false;
    if (items.autoCorrect) {
      correct = true;
      forcedByItem = true;
      items.autoCorrect = false;
    }
    // 超时提交一律判落空(即时制的核心约束:慢就是错)
    if (overtime) {
      correct = false;
      forcedByItem = false;
    }

    if (!items.answered.includes(questionId)) items.answered.push(questionId);

    const drops = [];
    let reward = { message: "", coins: 0, heal: 0, items: [] };
    let shieldUsed = false;
    let leveled = false;
    let resHeal = 0;      // 本次回复的生命
    let attack = null;    // 玩家这一击的结算
    let counter = null;   // 敌人的反击
    const kills = [];
    let cleared = false;

    if (hp <= 0) {
      // 心跳补算阶段就被打死了
      status = "DEAD";
    } else if (correct) {
      combo += 1;
      maxCombo = Math.max(maxCombo, combo);
      const ratio = c && c.qLimitMs ? Math.min(1, elapsed / c.qLimitMs) : 1;
      const tier = speedTier(ratio);
      const base = playerAtk(items, items.level);
      let raw = base * tier.mult * (0.9 + Math.random() * 0.2);
      if (items.berserk) raw *= 2;

      // V2.1：按学科决定物理/法术倍率，应用血刃狂攻、暴击、过载
      const hpRatio = run.maxHp > 0 ? 1 - hp / run.maxHp : 0;
      const dmg = computePlayerDamage(stats, raw, question.subject, hpRatio);
      const target = c ? aliveEnemies(c)[0] : null;
      if (target) {
        const others = c ? aliveEnemies(c).filter((e) => e.eid !== target.eid) : [];
        // 主目标
        const d = damageEnemy(target, dmg.amount, stats.armorPen);
        attack = {
          dmg: d.dealt, killed: d.killed, eid: target.eid, name: target.name,
          speed: tier.label, speedText: tier.text, mult: tier.mult,
          type: dmg.type, crit: dmg.crit,
        };
        const hitEnemies = [{ enemy: target, res: d }];
        // 分裂斩（物理溅射打前方多敌）
        if (dmg.type === "phys" && stats.splash > 0) {
          for (const e of others) {
            const sd = damageEnemy(e, dmg.amount * stats.splash, stats.armorPen);
            hitEnemies.push({ enemy: e, res: sd });
            events.push({ type: "splash", eid: e.eid, name: e.name, dmg: sd.dealt });
          }
        }
        // 元素爆裂（法术范围爆炸）
        if (dmg.type === "spell" && stats.spellSplash > 0) {
          for (const e of others) {
            const sd = damageEnemy(e, dmg.amount * stats.spellSplash, 0);
            hitEnemies.push({ enemy: e, res: sd });
            events.push({ type: "spell_splash", eid: e.eid, name: e.name, dmg: sd.dealt });
          }
        }
        // 法力弹散射（额外副弹）
        if (dmg.type === "spell" && stats.scatterCount > 0) {
          for (let i = 0; i < Math.min(stats.scatterCount, others.length); i++) {
            const e = others[i];
            const sd = damageEnemy(e, dmg.amount * stats.scatterDmg, stats.armorPen);
            events.push({ type: "scatter", eid: e.eid, name: e.name, dmg: sd.dealt });
          }
        }
        // 蓝焰灼烧：法术命中附灼烧 DoT
        if (dmg.type === "spell" && stats.burn) {
          applyBurn(target, dmg.amount, stats, c.totalBeat);
          events.push({ type: "burn_apply", eid: target.eid, name: target.name });
        }
        // 吸血打击（物理命中）：吸血转生命，魔力血祭额外回蓝
        if (dmg.type === "phys" && stats.lifesteal > 0) {
          const ls = stats.lifesteal * (stats.manaBlood ? 1 + stats.manaBlood.lifestealBonus : 1);
          const healAmt = Math.round(d.dealt * ls);
          if (healAmt > 0) {
            hp = Math.min(run.maxHp, hp + healAmt);
            resHeal = Math.max(resHeal, healAmt);
            events.push({ type: "lifesteal", dmg: healAmt });
            if (stats.manaBlood) items.mana = Math.min(items.maxMana, items.mana + Math.round(healAmt * stats.manaBlood.lifestealToMana));
          }
        }
        // 击杀结算（主目标 + 溅射目标）
        for (const { enemy, res } of hitEnemies) {
          if (res.killed) {
            kills.push({ eid: enemy.eid, name: enemy.name, kind: enemy.kind });
            items.xp += enemy.kind === "boss" ? 5 : 2;
            coins += enemy.kind === "boss" ? 5 : 1;
            if (stats.killMana) items.mana = Math.min(items.maxMana, items.mana + stats.killMana);
            if (stats.bloodFeast && !stats.lifeConvert) hp = Math.min(run.maxHp, hp + stats.bloodFeast);
            if (stats.lifeConvert) items.mana = Math.min(items.maxMana, items.mana + stats.lifeConvert.mana);
            const dd = rollDrop(items, enemy.kind === "boss");
            if (dd.length) drops.push(...dd);
          }
        }
      }

      // 得分同样吃速度倍率:又快又准才是高分
      let gain = Math.round((10 + combo * 2 + weaponBonus(items)) * tier.mult);
      if (items.berserk) gain *= 2;
      if (items.pendingScoreBonus) gain += items.pendingScoreBonus;
      score += gain;
      items.pendingScoreBonus = 0;
      items.berserk = false;
      // 自然回蓝（魔力血祭会停止）
      if (!stats.manaBlood) items.mana = Math.min(items.maxMana, items.mana + 1 + trinketRegen(items));
      items.xp += 1;
      leveled = checkLevelUp(items);

      reward = comboReward(combo);
      coins += reward.coins;
      if (reward.heal > 0) hp = Math.min(run.maxHp, hp + reward.heal);
      const heal = randInt(3, 7);
      resHeal = heal;
      hp = Math.min(run.maxHp, hp + heal);
      reward.items.forEach((ref) => items.inventory.push(mkItemEntry(ref)));

      cleared = c ? aliveEnemies(c).length === 0 : true;
      if (cleared && nodeType === "boss") {
        coins += 5;
        items.inventory.push(mkItemEntry("i_heal"));
        reward.message = reward.message ? `${reward.message} · 击败 Boss!金币+5、药水×1` : "击败 Boss!金币+5、药水×1";
      }
    } else {
      // 落空:敌人立刻反击一次(超时则是 1.5 倍重击)
      combo = 0;
      items.berserk = false;
      items.pendingScoreBonus = 0;
      const target = c ? aliveEnemies(c)[0] : null;
      if (target) {
        const raw = target.atk * (1 + Math.random() * 0.2) * (overtime ? 1.5 : 1);
        const r = damagePlayer(items, hp, raw, { stats, maxHp: run.maxHp, totalBeat: c.totalBeat });
        hp = r.hp;
        shieldUsed = r.blocked;
        counter = { dmg: r.dealt, blocked: r.blocked, name: target.name, timeout: overtime };
      }
      // 测试模式(固定题 TEST_Q 不存在于 question 表)跳过错题本写入,避免外键报错
      if (!items.test) {
        await prisma.wrongBook.upsert({
          where: { studentId_questionId: { studentId: req.user.id, questionId } },
          create: { studentId: req.user.id, questionId, wrongCount: 1 },
          update: { wrongCount: { increment: 1 }, mastered: false },
        });
      }
    }

    if (hp <= 0) {
      hp = 0;
      status = "DEAD";
    }
    let runOver = status !== "ACTIVE";
    let nextNodeInfo = { nodeType: null, question: null };

    if (!runOver) {
      if (cleared) {
        // 清空本层敌人才推进层数
        layer += 1;
        if (layer > MAX_LAYER) {
          status = "WON";
          runOver = true;
        } else {
          const updatedRun = { ...run, layer, hp, combo, maxCombo, score, coins, status, items: JSON.stringify(items) };
          nextNodeInfo = await nextNode(updatedRun);
          syncCombat(items, layer, nextNodeInfo.nodeType, nextNodeInfo.question, { test: items.test });
        }
      } else {
        // 本层还有敌人:同一批敌人继续,换下一题
        const q = await pickQuestion({ ...run, layer, items: JSON.stringify(items) }, { boss: nodeType === "boss" });
        nextNodeInfo = { nodeType, question: q };
        if (q && items.combat) beginQuestionWindow(items.combat, q, { test: items.test });
        // 取不到题:必须停战。否则计时窗口停留在上一题,心跳会判定恒超时,
        // 玩家会被"看不见的敌人"持续重击致死(前端只显示缺题面板)。
        if (!q) items.combat = null;
      }
    }

    await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: {
        layer, hp, combo, maxCombo, score, coins, status,
        items: JSON.stringify(items),
      },
    });

    ok(res, {
      correct,
      correctAnswer: question.answer, // 作答后回传正确答案文本,供前端在选项上做对错着色
      forcedByItem,
      overtime,
      combo, maxCombo, hp, maxHp: run.maxHp, layer, score, coins,
      reward: reward.message || null,
      drops: drops.length ? drops : null,
      shieldUsed,
      attack, counter, kills, cleared, events,
      damage: counter ? counter.dmg : 0,
      heal: resHeal,
      leveled,
      runOver, status: status,
      nodeType: nextNodeInfo.nodeType,
      nextQuestion: nextNodeInfo.question,
      ...extraState(items),
    }, correct
      ? `回答正确 · ${attack?.speedText || "出手"}`
      : overtime ? "超时!敌人重击" : shieldUsed ? "回答错误(护盾抵挡)" : "回答错误");
  })
);

// POST /api/roguelike/:runId/tick — 即时制心跳
// 前端每秒调用一次；服务端按真实流逝时间（钳制 3 秒）推进战斗节拍，
// 结算敌人自动攻击与超时判定。所有伤害都在这里产生，客户端只负责播放。
router.post(
  "/:runId/tick",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const items = parseItems(run.items);
    const now = Date.now();
    let { layer, hp, combo, score, coins, status } = run;
    const nodeType = items.map[layer - 1] || "normal";
    const stats = computePassiveStats(items); // V2.1 被动折算
    const events = [];
    let timedOut = false;
    let nextNodeInfo = { nodeType: null, question: null };

    if (items.combat) {
      const sim = simulate(items, hp, now, { stats, maxHp: run.maxHp });
      hp = sim.hp;
      events.push(...sim.events);

      if (hp > 0 && isTimedOut(items.combat, now)) {
        timedOut = true;
        combo = 0;
        const t = timeoutStrike(items, hp, { stats, maxHp: run.maxHp, totalBeat: items.combat.totalBeat });
        hp = t.hp;
        events.push({ type: "timeout", dmg: t.dmg, blocked: t.blocked, name: t.name });
        if (hp > 0) {
          const q = await pickQuestion({ ...run, layer, items: JSON.stringify(items) }, { boss: nodeType === "boss" });
          nextNodeInfo = { nodeType, question: q };
          if (q) beginQuestionWindow(items.combat, q, { test: items.test });
          // 同上:取不到题就停战,避免恒超时把玩家打死
          else items.combat = null;
        }
      }
    }

    let runOver = false;
    if (hp <= 0) {
      hp = 0;
      status = "DEAD";
      runOver = true;
    }

    await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { hp, combo, status, items: JSON.stringify(items) },
    });

    ok(res, {
      hp, maxHp: run.maxHp, layer, combo, score, coins,
      events, timedOut, runOver, status,
      nodeType: nextNodeInfo.nodeType,
      nextQuestion: nextNodeInfo.question,
      ...extraState(items),
    });
  })
);

// POST /api/roguelike/:runId/claim
router.post(
  "/:runId/claim",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const items = parseItems(run.items);
    const nodeType = items.map[run.layer - 1] || "normal";
    if (nodeType !== "reward") return fail(res, 400, "当前节点不是奖励节点");

    let { layer, hp, score, coins, status } = run;
    coins += 2;
    const msg = [];
    if (Math.random() < 0.3) { items.inventory.push(mkItemEntry("i_heal")); msg.push("治疗药水×1"); }
    if (hp < run.maxHp && Math.random() < 0.3) { const ch = randInt(6, 12); hp = Math.min(run.maxHp, hp + ch); msg.push(`回复 ${ch} 点生命`); }
    layer += 1;
    let runOver = false;
    let nextNodeInfo = { nodeType: null, question: null };
    if (layer > MAX_LAYER) { status = "WON"; runOver = true; }
    else {
      const updatedRun = { ...run, layer, hp, score, coins, status, items: JSON.stringify(items) };
      nextNodeInfo = await nextNode(updatedRun);
      // 离开奖励节点 → 生成下一层敌人并开启计时窗口
      syncCombat(items, layer, nextNodeInfo.nodeType, nextNodeInfo.question, { test: items.test });
    }

    await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { layer, hp, score, coins, status, items: JSON.stringify(items) },
    });

    ok(res, {
      hp, layer, score, coins,
      reward: `奖励节点:金币+2${msg.length ? "、" + msg.join("、") : ""}`,
      runOver, status: status,
      nodeType: nextNodeInfo.nodeType,
      nextQuestion: nextNodeInfo.question,
      ...extraState(items),
    }, "奖励领取成功");
  })
);

// POST /api/roguelike/:runId/use-item — 使用消耗品（物品）
router.post(
  "/:runId/use-item",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const uid = String(req.body?.uid || "");
    const items = parseItems(run.items);
    const idx = items.inventory.findIndex((e) => e.uid === uid && e.kind === "item");
    if (idx < 0) return fail(res, 400, "没有该物品");
    const entry = items.inventory[idx];
    const meta = ITEM_BY_ID[entry.ref];
    if (!meta) return fail(res, 400, "物品不存在");

    items.inventory.splice(idx, 1);
    let { layer, hp, combo, score, coins, status } = run;
    let payload = {};
    let runOver = false;
    let nextNodeInfo = { nodeType: null, question: null };
    // 即时制:用道具也要走时间,先补算这段时间里敌人的攻击
    const stats = computePassiveStats(items);
    const tickEvents = [];
    {
      const sim = simulate(items, hp, Date.now(), { stats, maxHp: run.maxHp });
      hp = sim.hp;
      tickEvents.push(...sim.events);
    }

    if (meta.type === "heal") {
      const healAmt = meta.heal >= 999 ? run.maxHp : rollHeal(meta.heal || 1);
      hp = Math.min(run.maxHp, hp + healAmt);
      payload = { message: `使用${meta.name},回复 ${healAmt} 点生命` };
    } else if (meta.type === "attack") {
      items.autoCorrect = true;
      payload = { message: "力量药剂生效:下次作答必中" };
    } else if (meta.type === "defense") {
      items.shield = true;
      items.shieldCount = Math.max(items.shieldCount, 1);
      payload = { message: "已开启护盾,抵挡一次答错" };
    } else if (meta.type === "utility") {
      const hintQid = String(req.body?.questionId || "");
      if (!hintQid) return fail(res, 400, "提示需要 questionId");
      const q = await resolveQuestionForHint(run, hintQid);
      if (!q) return fail(res, 404, "题目不存在");
      const answer = String(q.answer).trim();
      const opts = safeParseOptions(q.options);
      const wrongIdx = opts.map((o, i) => i).filter((i) => {
        const ov = String(opts[i]).trim();
        if (q.type === "NUMERIC" && !Number.isNaN(Number(answer)) && !Number.isNaN(Number(ov))) {
          return Math.abs(Number(ov) - Number(answer)) > 0.01;
        }
        return ov !== answer;
      });
      payload = { message: "提示已使用:排除 2 个错误选项", hintExclude: wrongIdx.sort(() => Math.random() - 0.5).slice(0, 2) };
    }

    if (hp <= 0) { hp = 0; status = "DEAD"; runOver = true; }

    await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { layer, hp, combo, score, coins, status, items: JSON.stringify(items) },
    });

    ok(res, { ...payload, hp, layer, combo, score, coins, events: tickEvents, runOver, status: status, nodeType: nextNodeInfo.nodeType, nextQuestion: nextNodeInfo.question, ...extraState(items) }, "物品已使用");
  })
);

// POST /api/roguelike/:runId/equip — 穿戴/替换装备
router.post(
  "/:runId/equip",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const uid = String(req.body?.uid || "");
    const items = parseItems(run.items);
    const entry = items.inventory.find((e) => e.uid === uid && e.kind === "gear");
    if (!entry) return fail(res, 400, "没有该装备");
    const slot = entry.slot;
    const prev = items.equipped[slot];

    // 卸下旧装备（反向加成）
    if (prev && prev.bonus) {
      if (prev.bonus.hp) { run.maxHp = Math.max(1, run.maxHp - prev.bonus.hp); run.hp = Math.min(run.hp, run.maxHp); }
      if (prev.bonus.mana) { items.maxMana = Math.max(1, items.maxMana - prev.bonus.mana); items.mana = Math.min(items.mana, items.maxMana); }
    }
    // 穿戴新装备（正向加成）
    items.equipped[slot] = entry;
    if (entry.bonus) {
      if (entry.bonus.hp) { run.maxHp += entry.bonus.hp; run.hp = Math.min(run.maxHp, run.hp + entry.bonus.hp); }
      if (entry.bonus.mana) { items.maxMana += entry.bonus.mana; items.mana = Math.min(items.maxMana, items.mana + entry.bonus.mana); }
    }
    items.inventory = items.inventory.filter((e) => e.uid !== uid);

    await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { maxHp: run.maxHp, hp: run.hp, items: JSON.stringify(items) },
    });

    ok(res, { hp: run.hp, maxHp: run.maxHp, message: `已穿戴${entry.name}`, ...extraState(items) }, "装备已穿戴");
  })
);

// POST /api/roguelike/:runId/use-skill — 使用技能（耗蓝）
router.post(
  "/:runId/use-skill",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const skillId = String(req.body?.skillId || "");
    const items = parseItems(run.items);
    if (!items.skills.includes(skillId)) return fail(res, 400, "尚未习得该技能");
    const meta = SKILL_BY_ID[skillId];
    if (!meta) return fail(res, 400, "技能不存在");
    if (items.mana < meta.cost) return fail(res, 400, `蓝量不足(需要 ${meta.cost},现有 ${items.mana})`);

    items.mana -= meta.cost;
    let { layer, hp, combo, score, coins, status } = run;
    let payload = {};
    let hintExclude = null;
    // 即时制:放技能同样消耗真实时间
    const stats = computePassiveStats(items);
    const tickEvents = [];
    {
      const sim = simulate(items, hp, Date.now(), { stats, maxHp: run.maxHp });
      hp = sim.hp;
      tickEvents.push(...sim.events);
    }

    if (meta.type === "attack") {
      items.autoCorrect = true;
      items.pendingScoreBonus = meta.bonus || 0;
      payload = { message: `${meta.name}发动:下次作答必中${meta.bonus ? `,+${meta.bonus} 分` : ""}` };
    } else if (meta.type === "heal") {
      const amt = meta.heal >= 999 ? run.maxHp : rollHeal(meta.heal || 1);
      hp = Math.min(run.maxHp, hp + amt);
      payload = { message: `${meta.name}:回复 ${amt} 点生命` };
    } else if (meta.type === "defense") {
      items.shield = true;
      items.shieldCount = Math.max(items.shieldCount, meta.blocks || 1);
      payload = { message: `${meta.name}:抵挡 ${meta.blocks || 1} 次答错` };
    } else if (meta.type === "utility") {
      if (meta.id === "s_berserk") {
        items.berserk = true;
        payload = { message: "狂暴:本次答对得分翻倍" };
      } else {
        // 专注:提示
        const hintQid = String(req.body?.questionId || "");
        if (!hintQid) return fail(res, 400, "专注需要 questionId");
        const q = await resolveQuestionForHint(run, hintQid);
        if (!q) return fail(res, 404, "题目不存在");
        const answer = String(q.answer).trim();
        const opts = safeParseOptions(q.options);
        const wrongIdx = opts.map((o, i) => i).filter((i) => {
          const ov = String(opts[i]).trim();
          if (q.type === "NUMERIC" && !Number.isNaN(Number(answer)) && !Number.isNaN(Number(ov))) return Math.abs(Number(ov) - Number(answer)) > 0.01;
          return ov !== answer;
        });
        hintExclude = wrongIdx.sort(() => Math.random() - 0.5).slice(0, 2);
        payload = { message: "专注:排除 2 个错误选项", hintExclude };
      }
    }

    let runOver = false;
    if (hp <= 0) { hp = 0; status = "DEAD"; runOver = true; }

    await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { layer, hp, combo, score, coins, status, items: JSON.stringify(items) },
    });

    ok(res, { ...payload, hp, layer, combo, score, coins, hintExclude, events: tickEvents, runOver, status, ...extraState(items) }, "技能已发动");
  })
);

// POST /api/roguelike/:runId/choose-skill — 升级三选一（V2.1：选择被动技能）
// 兼容别名 choose-passive 见下方。
async function handleChoosePassive(req, res) {
  const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
  if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
  if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

  const skillId = String(req.body?.skillId || "");
  const items = parseItems(run.items);
  if (!Array.isArray(items.pendingSkills) || !items.pendingSkills.length) return fail(res, 400, "当前没有待选择的被动");
  if (!items.pendingSkills.some((s) => s.id === skillId)) return fail(res, 400, "该被动不在可选列表中");

  // 获得被动：叠加 / 新增，并即时结算最大生命 / 最大蓝
  const gain = passiveGainStats(skillId);
  items.passives = addPassive(items.passives, skillId);
  if (gain.maxHp) { run.maxHp += gain.maxHp; run.hp = Math.min(run.maxHp, run.hp + gain.maxHp); }
  if (gain.maxMana) { items.maxMana += gain.maxMana; items.mana = Math.min(items.maxMana, items.mana + gain.maxMana); }

  // 还有排队的选择则继续给三个
  if (items.pendingCount > 0) {
    items.pendingCount -= 1;
    items.pendingSkills = pickThreePassives(items.passives);
  } else {
    items.pendingSkills = null;
  }

  await prisma.roguelikeRun.update({
    where: { id: run.id },
    data: { maxHp: run.maxHp, items: JSON.stringify(items) },
  });

  const m = PASSIVE_BY_ID[skillId];
  ok(res, { message: `习得被动:${m?.name || skillId}`, ...extraState(items) }, "被动已选择");
}
router.post("/:runId/choose-skill", requireAuth, asyncHandler(handleChoosePassive));
router.post("/:runId/choose-passive", requireAuth, asyncHandler(handleChoosePassive));

// POST /api/roguelike/:runId/use-passive — 手动释放需主动触发的被动（虚空魔弹）
router.post(
  "/:runId/use-passive",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");

    const passiveId = String(req.body?.passiveId || "");
    const items = parseItems(run.items);
    const stats = computePassiveStats(items);
    if (!stats.voidBolt) return fail(res, 400, "尚未拥有可主动释放的被动");
    if (items.mana < stats.voidBolt.cost) return fail(res, 400, `蓝量不足(需要 ${stats.voidBolt.cost},现有 ${items.mana})`);

    // 冷却（按战斗秒）：用 barrierNextBeat 复用一套冷却计时（每 run 仅一个主动被动，无冲突）
    const c = items.combat;
    const nowBeat = c ? c.totalBeat : 0;
    if (items.voidCdUntil && nowBeat < items.voidCdUntil) {
      return fail(res, 400, `冷却中(${Math.ceil(items.voidCdUntil - nowBeat)} 拍)`);
    }
    items.mana -= stats.voidBolt.cost;
    items.voidCdUntil = nowBeat + stats.voidBolt.cd;

    // 即时制：先补算心跳空档
    const tickEvents = [];
    {
      const sim = simulate(items, run.hp, Date.now(), { stats, maxHp: run.maxHp });
      run.hp = sim.hp;
      tickEvents.push(...sim.events);
    }
    // 穿透全部敌人
    const hits = [];
    if (c) {
      for (const e of aliveEnemies(c)) {
        const d = damageEnemy(e, 40 + items.level * 4, stats.armorPen);
        hits.push({ eid: e.eid, name: e.name, dmg: d.dealt, killed: d.killed });
        if (d.killed) {
          items.xp += e.kind === "boss" ? 5 : 2;
          const dd = rollDrop(items, e.kind === "boss");
          if (dd.length) items.inventory.push(...dd);
        }
      }
    }

    let runOver = false;
    if (run.hp <= 0) { run.hp = 0; run.status = "DEAD"; runOver = true; }

    await prisma.roguelikeRun.update({
      where: { id: run.id },
      data: { hp: run.hp, status: run.status, items: JSON.stringify(items) },
    });

    ok(res, { message: "虚空魔弹！贯穿全场", hits, hp: run.hp, events: tickEvents, runOver, status: run.status, ...extraState(items) }, "虚空魔弹已释放");
  })
);

// POST /api/roguelike/:runId/quit
router.post(
  "/:runId/quit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    if (run.status !== "ACTIVE") return fail(res, 400, "冒险已结束");
    const updated = await prisma.roguelikeRun.update({ where: { id: run.id }, data: { status: "QUIT" } });
    ok(res, { run: updated }, "冒险已结算");
  })
);

// GET /api/roguelike/meta/passives — 被动技能图鉴（前端展示名称/图标/描述，避免前后端两份清单漂移）
// 注意：必须定义在 GET /:runId 之前（两段路径不会与单段的 :runId 冲突，但保持顺序更稳妥）
router.get(
  "/meta/passives",
  requireAuth,
  asyncHandler(async (_req, res) => {
    ok(res, {
      passives: PASSIVES.map((p) => ({
        id: p.id,
        name: p.name,
        icon: p.icon,
        desc: p.desc,
        tree: p.tree,
        rarity: p.rarity,
        stackable: !!p.stackable,
        active: !!p.voidBolt, // 需手动释放的被动
      })),
    });
  })
);

// GET /api/roguelike/:runId
router.get(
  "/:runId",
  requireAuth,
  asyncHandler(async (req, res) => {
    const run = await prisma.roguelikeRun.findUnique({ where: { id: req.params.runId } });
    if (!run || run.studentId !== req.user.id) return fail(res, 404, "冒险不存在");
    const node = run.status === "ACTIVE" ? await nextNode(run) : { nodeType: null, question: null };
    ok(res, { run, ...extraState(parseItems(run.items)), ...node });
  })
);

export default router;
