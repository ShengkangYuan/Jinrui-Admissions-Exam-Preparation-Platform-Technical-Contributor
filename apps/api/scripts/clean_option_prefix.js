// 一次性清洗已存题库的 options 数组:去除视觉模型误带出的字母前缀
// 如 "A 1/25"、"A. 1/25"、"(A) 1/25" → "1/25"
// 选项 A./B./C. 标签由系统添加,库内只保留正文
// 运行:npm run clean:option-prefix 或 node scripts/clean_option_prefix.js [--dry]
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const RE = /^[\(\[【（]?[A-Ja-j][\.\s:、)）\]】」、\]】]*/;
// 选项文本过短(<2 字符)或清洗后包含特定关键词(像 "union" "and" 开头的并集/合取)
// 认为是误伤(原文以大写字母+空格开头但不是 A/B 选项),回退不洗
const LIKELY_FALSE = (cleaned, orig) => {
  if (!cleaned || cleaned.length < 2) return true;
  // 集合并/交等 "A union B" 这种会被误清洗成 "union B"
  if (/^(union|and|or|∪|∩)\b/i.test(cleaned)) return true;
  // 清洗前后长度差异极小(只是去 1 个字母),置信度低
  if (Math.abs(cleaned.length - orig.length) <= 1 && /^[A-Z]/i.test(cleaned)) return true;
  return false;
};

const dry = process.argv.includes("--dry");

const qs = await prisma.question.findMany({ select: { id: true, options: true } });
let fixed = 0, kept = 0, falseCleaned = 0;
for (const q of qs) {
  let arr;
  try {
    arr = JSON.parse(q.options || "[]");
  } catch {
    continue;
  }
  if (!Array.isArray(arr) || arr.length === 0) continue;
  let changed = false;
  const cleaned = arr.map((o) => {
    const orig = String(o ?? "");
    const c = orig.replace(RE, "").trimStart();
    if (c === orig) return orig;
    if (LIKELY_FALSE(c, orig)) {
      falseCleaned++;
      return orig;
    }
    if (c !== orig) changed = true;
    return c;
  });
  if (!changed) {
    kept++;
    continue;
  }
  fixed++;
  if (!dry) {
    await prisma.question.update({ where: { id: q.id }, data: { options: JSON.stringify(cleaned) } });
  }
}
console.log(`扫描 ${qs.length} 题${dry ? "(dry)" : ""}: 已清洗 ${fixed},无需清洗 ${kept},疑似误伤跳过 ${falseCleaned}`);
await prisma.$disconnect();