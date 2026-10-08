// 一次性修复最近导入的数据:
// 1) subject 英文学科归一化(Chemistry→化学 等)
// 2) 题干/选项中"纯单位"公式还原为普通文本(如 $2.0\ \mathrm{mol}$ → 2.0 mol)
// 3) 按共享规则重新自动归类知识点(含斜杠拆分)
// 运行:npm run fix:import-data 或 node scripts/fix_import_data.js [--dry]
import "dotenv/config";
import { prisma } from "../src/lib/db.js";
import { KNOWLEDGE_RULES } from "../src/lib/knowledge-rules.js";
import { cleanUnits } from "../src/lib/text-normalize.js";

const dry = process.argv.includes("--dry");

const SUBJECT_NORM = { Chemistry: "化学", Physics: "物理", Biology: "生物", Math: "数学", Maths: "数学", Mathematics: "数学" };
const SUBJECT_POOL = { TMUA: ["数学"], ESAT: ["数学", "物理"], 数学: ["数学"], 物理: ["物理"], 化学: ["化学"], 生物: ["生物"] };

const kps = await prisma.knowledgePoint.findMany({ select: { id: true, subject: true, name: true } });
const kpBySubject = {};
for (const k of kps) (kpBySubject[k.subject] = kpBySubject[k.subject] || []).push(k);

function matchKps(subject, topicStr) {
  const names = String(topicStr || "").split(/[,、;；\/\s]+/).map((s) => s.trim()).filter(Boolean);
  const subs = SUBJECT_POOL[subject] || [subject];
  const pool = subs.flatMap((s) => kpBySubject[s] || []);
  const hits = [];
  for (const n of names) {
    let hit = pool.find((k) => k.name === n || k.name.includes(n) || n.includes(k.name));
    if (!hit) {
      for (const r of KNOWLEDGE_RULES) {
        if (!subs.includes(r.subject)) continue;
        if (r.re.test(n)) {
          hit = pool.find((k) => k.name === r.kp);
          if (hit) break;
        }
      }
    }
    if (hit && !hits.some((h) => h.id === hit.id)) hits.push(hit);
  }
  return hits;
}

const qs = await prisma.question.findMany({ select: { id: true, subject: true, topic: true, topicIds: true, stem: true, options: true } });
let changed = 0, detail = { subj: 0, units: 0, classify: 0, total: qs.length };
for (const q of qs) {
  const data = {};
  const subj = SUBJECT_NORM[q.subject] || q.subject;
  if (subj !== q.subject) { data.subject = subj; detail.subj++; }

  const stem = cleanUnits(q.stem);
  const opts = JSON.parse(q.options || "[]");
  const cleanedOpts = opts.map((o) => cleanUnits(o));
  const optsStr = JSON.stringify(cleanedOpts);
  if (stem !== q.stem) { data.stem = stem; detail.units++; }
  if (optsStr !== q.options) { data.options = optsStr; detail.units++; }

  // 重新归类(覆盖旧 topicIds,与导入时逻辑一致)
  const matched = matchKps(subj, q.topic);
  const newIds = matched.map((k) => k.id);
  const newTopic = matched[0]?.name || String(q.topic || "").trim();
  if (JSON.stringify(newIds) !== q.topicIds || newTopic !== q.topic) {
    data.topicIds = JSON.stringify(newIds);
    data.topic = newTopic;
    detail.classify++;
  }

  if (Object.keys(data).length) {
    changed++;
    if (!dry) await prisma.question.update({ where: { id: q.id }, data });
  }
}
console.log(`扫描 ${detail.total} 题${dry ? "(dry)" : ""}: 变更 ${changed} | 学科归一 ${detail.subj} | 题干单位清洗 ${detail.units} | 归类 ${detail.classify}`);
await prisma.$disconnect();
