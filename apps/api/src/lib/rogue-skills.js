// 冒险模式 · 被动技能系统（V2.1）
//
// 30 个被动技能，分四棵树：
//   attack   攻击类（数学/物理题 → 物理伤害）
//   spell    法术类（化学/生物题 → 法术伤害）
//   defense  防御生存类（减伤/护甲/闪避/反弹/屏障）
//   sustain  续航恢复类（最大生命/回蓝/吸血/生命流转）
//
// 三档稀有度：common(普通) / rare(稀有) / epic(史诗)。
// stackable: 可叠加标记——重复获得则 stacks+1，效果线性叠加（数值型）；
//            非叠加的稀有/史诗技能重复获得不能再加成。
//
// 设计约定：
//  - computeStats(passives) 是「纯聚合」：只读取已拥有被动的 stacks，折算成 phys/spell/def/sustain
//    四类数值，绝不修改 run/items。run.maxHp / items.maxMana 的「即时结算」由路由在获得被动时单独处理。
//  - 物理/法术伤害类型由题目学科决定（damageTypeForSubject），combat 内核据此选择 physAtkMult 或 spellMult。

// 稀有度抽取权重：普通最多、史诗最少
const RARITY_WEIGHT = { common: 3, rare: 2, epic: 1 };

// 每一项 passive 的字段：
//   id, tree, rarity, name, icon, desc, stackable
//   —— 下面是「每叠一层」贡献的数值（0 / null 表示该技能无此项效果）
//   physAtkMult           普通攻击(物理)伤害 +%
//   armorPen              无视敌人护甲比例(0-1)
//   splash                近战命中后冲击波打前方多敌的比例(本体伤害%)
//   critChance            暴击率(0-1)
//   critMultAdd           暴击倍率额外加成(基础 1.0，叠加后 = 1.0 + ΣcritMultAdd)
//   bloodBladePer10       每损失 10% 生命，物理伤害 +%（动态按当前血量）
//   spellMult             法术伤害 +%
//   maxMana               最大蓝 +（获得时一次性结算）
//   cdMult                冷却 -%（每叠一层 -cdMult，最终 cdMult = 1 - Σ）
//   manaCostMult          蓝耗 +%（每叠一层 +manaCostMult，最终 = 1 + Σ）
//   scatterCount          额外副弹数量
//   scatterDmg            每发副弹伤害比例
//   killMana              击杀回蓝
//   spellSplash           法术触发范围爆炸比例
//   burn                  灼烧 DoT {dur(战斗秒), pct(法术伤害比例)}
//   voidBolt              虚空魔弹 {cost, cd(战斗秒)}
//   overload              魔力过载 {mult, drain(每战斗秒耗蓝)}
//   dmgReduce             受所有伤害 -%(0-1，封顶 0.75)
//   playerArmor           玩家护甲(减免 incoming 固定值)
//   dodge                 完全闪避率(0-1，封顶 0.5)
//   ironWill              钢铁意志：一局可免暴毙次数
//   manaBarrier           魔力屏障 {cost, pct(护盾=最大蓝比例), cd}
//   reflect               近战反弹比例(0-1)
//   deathGuard            濒死守护 {pct(临时护盾=最大生命比例), once}
//   maxHp                 最大生命 +（获得时一次性结算）
//   meditation            非战斗每战斗秒回蓝
//   lifesteal             物理命中吸血比例(0-1)
//   bloodFeast            击杀回生命
//   lifeConvert           生命转换 {mana, noLife}
//   lifeFlow              生命奔流 {pct(每周期回最大生命%), interval(战斗秒), pause(受伤暂停战斗秒)}
//   manaBlood             魔力血祭 {lifestealToMana(吸血转法力比例), lifestealBonus(吸血效率+%)}
export const PASSIVES = [
  // ===================== 攻击类（物理伤害） =====================
  {
    id: "p_brute", tree: "attack", rarity: "common", stackable: true,
    name: "猛攻", icon: "⚔️", desc: "普通攻击伤害 +20%",
    physAtkMult: 0.20,
  },
  {
    id: "p_armor_break", tree: "attack", rarity: "rare", stackable: true,
    name: "破甲打击", icon: "🛠️", desc: "无视敌人 35% 护甲",
    armorPen: 0.35,
  },
  {
    id: "p_cleave", tree: "attack", rarity: "rare", stackable: true,
    name: "分裂斩", icon: "🌊", desc: "近战命中后释放冲击波，对前方多敌造成本体 50% 伤害",
    splash: 0.50,
  },
  {
    id: "p_crit", tree: "attack", rarity: "rare", stackable: true,
    name: "致命一击", icon: "💥", desc: "12% 概率暴击，暴击造成 170% 伤害",
    critChance: 0.12, critMultAdd: 0.70,
  },
  {
    id: "p_blood_blade", tree: "attack", rarity: "epic", stackable: true,
    name: "血刃狂攻", icon: "🩸", desc: "每损失 10% 生命，物理伤害 +8%",
    bloodBladePer10: 0.08,
  },

  // ===================== 法术类（化学生物伤害） =====================
  {
    id: "p_mana_surge", tree: "spell", rarity: "common", stackable: true,
    name: "魔力涌动", icon: "🔮", desc: "法术伤害 +22%，最大蓝 +15",
    spellMult: 0.22, maxMana: 15,
  },
  {
    id: "p_quick_cast", tree: "spell", rarity: "common", stackable: true,
    name: "快速咏唱", icon: "⏩", desc: "冷却 -20%，蓝耗 +10%",
    cdMult: 0.20, manaCostMult: 0.10,
  },
  {
    id: "p_scatter", tree: "spell", rarity: "common", stackable: true,
    name: "法力弹散射", icon: "🎯", desc: "额外射出 2 发副弹，每发造成 40% 伤害",
    scatterCount: 2, scatterDmg: 0.40,
  },
  {
    id: "p_mana_regen", tree: "spell", rarity: "rare", stackable: true,
    name: "魔力回涌", icon: "💧", desc: "击杀敌人回复 8 点蓝",
    killMana: 8,
  },
  {
    id: "p_elemental_burst", tree: "spell", rarity: "rare", stackable: false,
    name: "元素爆裂", icon: "💫", desc: "法术命中触发范围爆炸，对周围敌人造成 50% 伤害",
    spellSplash: 0.50,
  },
  {
    id: "p_burn", tree: "spell", rarity: "rare", stackable: false,
    name: "蓝焰灼烧", icon: "🔥", desc: "法术附带灼烧，3 秒内持续造成 30% 法术伤害",
    burn: { dur: 3, pct: 0.30 },
  },
  {
    id: "p_void_bolt", tree: "spell", rarity: "epic", stackable: false,
    name: "虚空魔弹", icon: "🌌", desc: "消耗 30 蓝释放穿透弹，贯穿全部敌人（冷却 8 秒）",
    voidBolt: { cost: 30, cd: 8 },
  },
  {
    id: "p_overload", tree: "spell", rarity: "epic", stackable: false,
    name: "魔力过载", icon: "⚡", desc: "法术伤害 +40%，但每秒消耗 5 蓝，蓝归零失效",
    overload: { mult: 0.40, drain: 5 },
  },

  // ===================== 防御生存类 =====================
  {
    id: "p_iron_hide", tree: "defense", rarity: "common", stackable: true,
    name: "铁皮体魄", icon: "🛡️", desc: "受到的所有伤害 -15%",
    dmgReduce: 0.15,
  },
  {
    id: "p_extra_armor", tree: "defense", rarity: "common", stackable: true,
    name: "额外护甲", icon: "🪖", desc: "获得 6 点护甲，减免固定伤害（叠加上限 12）",
    playerArmor: 6,
  },
  {
    id: "p_dodge", tree: "defense", rarity: "common", stackable: true,
    name: "迅捷闪避", icon: "💨", desc: "8% 概率完全闪避一次伤害",
    dodge: 0.08,
  },
  {
    id: "p_iron_will", tree: "defense", rarity: "rare", stackable: false,
    name: "钢铁意志", icon: "🗿", desc: "单次大额伤害不再暴毙，保留 1 点血（一局最多 3 次）",
    ironWill: 3,
  },
  {
    id: "p_mana_barrier", tree: "defense", rarity: "rare", stackable: false,
    name: "魔力屏障", icon: "🔵", desc: "消耗 15 蓝生成护盾（=最大蓝 25%），每 8 秒刷新",
    manaBarrier: { cost: 15, pct: 0.25, cd: 8 },
  },
  {
    id: "p_reflect", tree: "defense", rarity: "rare", stackable: false,
    name: "反弹外壳", icon: "🪞", desc: "近战受击时反弹 25% 伤害给敌人",
    reflect: 0.25,
  },
  {
    id: "p_petrify", tree: "defense", rarity: "epic", stackable: false,
    name: "石化坚躯", icon: "🪨", desc: "减伤 +30%（移速 -15%，即时制下表现为蓄力略慢）",
    dmgReduce: 0.30,
  },
  {
    id: "p_death_guard", tree: "defense", rarity: "epic", stackable: false,
    name: "濒死守护", icon: "💠", desc: "生命低于 20% 时瞬间获得大额临时护盾（一局一次）",
    deathGuard: { pct: 0.40, once: true },
  },

  // ===================== 续航恢复类 =====================
  {
    id: "p_vitality", tree: "sustain", rarity: "common", stackable: true,
    name: "强健体质", icon: "❤️", desc: "最大生命 +35",
    maxHp: 35,
  },
  {
    id: "p_meditation", tree: "sustain", rarity: "common", stackable: true,
    name: "冥想", icon: "🧘", desc: "每战斗秒回复 4 点蓝",
    meditation: 4,
  },
  {
    id: "p_lifesteal", tree: "sustain", rarity: "common", stackable: true,
    name: "吸血打击", icon: "🦇", desc: "物理命中吸取 3% 伤害转为生命",
    lifesteal: 0.03,
  },
  {
    id: "p_blood_feast", tree: "sustain", rarity: "rare", stackable: true,
    name: "血食", icon: "🍖", desc: "击杀敌人回复 6 点生命",
    bloodFeast: 6,
  },
  {
    id: "p_life_convert", tree: "sustain", rarity: "rare", stackable: false,
    name: "生命转换", icon: "🔄", desc: "击杀回复 12 蓝，但不再回复生命",
    lifeConvert: { mana: 12, noLife: true },
  },
  {
    id: "p_life_flow", tree: "sustain", rarity: "rare", stackable: false,
    name: "生命奔流", icon: "🌿", desc: "每 2 秒回复 4% 最大生命，受伤暂停 3 秒",
    lifeFlow: { pct: 0.04, interval: 2, pause: 3 },
  },
  {
    id: "p_mana_blood", tree: "sustain", rarity: "epic", stackable: false,
    name: "魔力血祭", icon: "🩸", desc: "停止自然回蓝，但每次吸血额外回复等量法力，吸血效率 +50%",
    manaBlood: { lifestealToMana: 1.0, lifestealBonus: 0.50 },
  },
];

export const PASSIVE_BY_ID = Object.fromEntries(PASSIVES.map((p) => [p.id, p]));

// 题目学科 → 伤害类型。物理题走 phys 树，法术题走 spell 树。
export function damageTypeForSubject(subject = "") {
  const s = `${subject || ""}`;
  if (/化学|生物/.test(s)) return "spell";
  // 数学 / TMUA / 物理 / ESAT 均视为物理攻击
  return "phys";
}

// 获得某被动「一层」时，对 run.maxHp / items.maxMana 的一次性增量（路由在 pick 时调用）
export function passiveGainStats(id) {
  const p = PASSIVE_BY_ID[id];
  if (!p) return { maxHp: 0, maxMana: 0 };
  return { maxHp: p.maxHp || 0, maxMana: p.maxMana || 0 };
}

// ===================== 被动效果聚合 =====================
// passives: items.passives = [{ ref, stacks }]
// 返回 phys / spell / def / sustain 四类折算数值，供战斗内核读取。
export function computeStats(passives) {
  const list = Array.isArray(passives) ? passives : [];
  const acc = {
    // 攻击
    physAtkMult: 0,
    armorPen: 0,
    splash: 0,
    critChance: 0,
    critMult: 1.0,
    bloodBladePer10: 0,
    // 法术
    spellMult: 0,
    maxManaBonus: 0,
    cdMult: 1.0,
    manaCostMult: 1.0,
    scatterCount: 0,
    scatterDmg: 0.40,
    killMana: 0,
    spellSplash: 0,
    burn: null,
    voidBolt: null,
    overload: null,
    // 防御
    dmgReduce: 0,
    playerArmor: 0,
    dodge: 0,
    ironWill: 0,
    manaBarrier: null,
    reflect: 0,
    deathGuard: null,
    // 续航
    maxHpBonus: 0,
    meditation: 0,
    lifesteal: 0,
    bloodFeast: 0,
    lifeConvert: null,
    lifeFlow: null,
    manaBlood: null,
    // 便捷：拥有清单（去重 id）
    owned: [],
  };

  for (const { ref, stacks } of list) {
    const p = PASSIVE_BY_ID[ref];
    if (!p) continue;
    const n = Math.max(1, stacks || 1);
    acc.owned.push(ref);
    if (p.physAtkMult) acc.physAtkMult += p.physAtkMult * n;
    if (p.armorPen) acc.armorPen += p.armorPen * n;
    if (p.splash) acc.splash += p.splash * n;
    if (p.critChance) acc.critChance += p.critChance * n;
    if (p.critMultAdd) acc.critMult += p.critMultAdd * n;
    if (p.bloodBladePer10) acc.bloodBladePer10 += p.bloodBladePer10 * n;
    if (p.spellMult) acc.spellMult += p.spellMult * n;
    if (p.maxMana) acc.maxManaBonus += p.maxMana * n;
    if (p.cdMult) acc.cdMult -= p.cdMult * n;
    if (p.manaCostMult) acc.manaCostMult += p.manaCostMult * n;
    if (p.scatterCount) acc.scatterCount += p.scatterCount * n;
    if (p.killMana) acc.killMana += p.killMana * n;
    if (p.spellSplash) acc.spellSplash += p.spellSplash * n;
    // 对象型效果：取第一个（通常稀有/史诗不可叠加）
    if (p.burn && !acc.burn) acc.burn = { ...p.burn };
    if (p.voidBolt && !acc.voidBolt) acc.voidBolt = { ...p.voidBolt };
    if (p.overload && !acc.overload) acc.overload = { ...p.overload };
    if (p.dmgReduce) acc.dmgReduce += p.dmgReduce * n;
    if (p.playerArmor) acc.playerArmor += p.playerArmor * n;
    if (p.dodge) acc.dodge += p.dodge * n;
    if (p.ironWill) acc.ironWill = Math.max(acc.ironWill, p.ironWill);
    if (p.manaBarrier && !acc.manaBarrier) acc.manaBarrier = { ...p.manaBarrier };
    if (p.reflect) acc.reflect += p.reflect * n;
    if (p.deathGuard && !acc.deathGuard) acc.deathGuard = { ...p.deathGuard };
    if (p.maxHp) acc.maxHpBonus += p.maxHp * n;
    if (p.meditation) acc.meditation += p.meditation * n;
    if (p.lifesteal) acc.lifesteal += p.lifesteal * n;
    if (p.bloodFeast) acc.bloodFeast += p.bloodFeast * n;
    if (p.lifeConvert && !acc.lifeConvert) acc.lifeConvert = { ...p.lifeConvert };
    if (p.lifeFlow && !acc.lifeFlow) acc.lifeFlow = { ...p.lifeFlow };
    if (p.manaBlood && !acc.manaBlood) acc.manaBlood = { ...p.manaBlood };
  }

  // 封顶，避免无限叠加导致数值崩坏
  acc.armorPen = Math.min(0.8, acc.armorPen);
  acc.critChance = Math.min(0.75, acc.critChance);
  acc.cdMult = Math.max(0.2, acc.cdMult);
  acc.dodge = Math.min(0.5, acc.dodge);
  acc.playerArmor = Math.min(12, acc.playerArmor); // 固定护甲封顶：避免把后期敌人伤害全减到 1 而成「必赢」被动
  acc.dmgReduce = Math.min(0.75, acc.dmgReduce);
  acc.reflect = Math.min(0.5, acc.reflect);
  return acc;
}

// ===================== 三选一抽取 =====================
// owned: items.passives = [{ ref, stacks }]
// 返回 3 个候选（按稀有度加权），结构便于前端渲染：
//   { id, name, icon, tree, rarity, desc, newStacks }
export function pickThreePassives(owned) {
  const ownedMap = new Map();
  for (const { ref, stacks } of Array.isArray(owned) ? owned : []) {
    ownedMap.set(ref, Math.max(1, stacks || 1));
  }

  // 候选构建：
  //  - 未拥有 → 可抽（newStacks=1）
  //  - 已拥有且可叠加 → 仍可抽（newStacks=当前+1）
  //  - 已拥有且不可叠加 → 排除
  const candidates = [];
  for (const p of PASSIVES) {
    const have = ownedMap.get(p.id);
    if (have && !p.stackable) continue;
    candidates.push({ passive: p, newStacks: have ? have + 1 : 1 });
  }

  const draw = (pool, count) => {
    const out = [];
    const bag = pool.slice();
    while (out.length < count && bag.length) {
      const totalW = bag.reduce((s, c) => s + (RARITY_WEIGHT[c.passive.rarity] || 1), 0);
      let r = Math.random() * totalW;
      let idx = 0;
      for (let i = 0; i < bag.length; i++) {
        r -= RARITY_WEIGHT[bag[i].passive.rarity] || 1;
        if (r <= 0) { idx = i; break; }
      }
      out.push(bag.splice(idx, 1)[0]);
    }
    return out;
  };

  let picked = draw(candidates, 3);

  // 候选不足 3 个（背包快满）：从「可叠加且已拥有」的池里补抽（带放回）
  if (picked.length < 3) {
    const stackableOwned = PASSIVES.filter((p) => p.stackable && ownedMap.has(p.id)).map((p) => ({
      passive: p,
      newStacks: (ownedMap.get(p.id) || 0) + 1,
    }));
    if (stackableOwned.length) {
      while (picked.length < 3) {
        const totalW = stackableOwned.reduce((s, c) => s + (RARITY_WEIGHT[c.passive.rarity] || 1), 0);
        let r = Math.random() * totalW;
        let chosen = stackableOwned[0];
        for (const c of stackableOwned) {
          r -= RARITY_WEIGHT[c.passive.rarity] || 1;
          if (r <= 0) { chosen = c; break; }
        }
        picked.push(chosen);
      }
    }
  }

  // 极端兜底：实在没候选（全满且无可叠加），重复返回普通池前三个
  if (picked.length < 3) {
    for (const p of PASSIVES.filter((x) => x.rarity === "common")) {
      if (picked.length >= 3) break;
      picked.push({ passive: p, newStacks: (ownedMap.get(p.id) || 0) + 1 });
    }
  }

  return picked.map(({ passive, newStacks }) => ({
    id: passive.id,
    name: passive.name,
    icon: passive.icon,
    tree: passive.tree,
    rarity: passive.rarity,
    desc: passive.desc,
    newStacks,
  }));
}

// 把某被动加入 items.passives（获得时调用）：已拥有且可叠加则 stacks+1，否则 push。
export function addPassive(passives, id) {
  const p = PASSIVE_BY_ID[id];
  if (!p) return passives;
  const list = Array.isArray(passives) ? passives.map((x) => ({ ...x })) : [];
  const found = list.find((x) => x.ref === id);
  if (found) {
    if (p.stackable) found.stacks = (found.stacks || 1) + 1;
  } else {
    list.push({ ref: id, stacks: 1 });
  }
  return list;
}
