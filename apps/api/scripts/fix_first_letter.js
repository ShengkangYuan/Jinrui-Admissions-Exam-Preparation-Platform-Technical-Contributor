// 一次性恢复因 #17 bug(cleanOptionPrefix * 允许零分隔符)被误删首字母的选项
// 仅补回高频化学短语的确定模式;其余不动,留给老师手动编辑
// 运行:npm run fix:first-letter 或 node scripts/fix_first_letter.js
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const PREFIX_RULES = [
  // { pattern: 选项开头的字符串, restore: 还原后的开头 }
  // 严格按"开头 + 空格"匹配,避免误伤
  { from: /^ovalent bonds\b/, to: "Covalent bonds" },
  { from: /^ovalent\b/, to: "Covalent" },
  { from: /^t has\b/, to: "It has" },
  { from: /^t forms\b/, to: "It forms" },
  { from: /^ts structure\b/, to: "Its structure" },
  { from: /^ts shape\b/, to: "Its shape" },
  { from: /^ts melting point\b/, to: "Its melting point" },
  { from: /^ains an electron\b/, to: "gains an electron" },
  { from: /^ains an electro\b/, to: "gains an electro" },
  { from: /^s found in\b/, to: "is found in" },
  { from: /^n each reaction\b/, to: "In each reaction" },
  { from: /^n the reaction\b/, to: "In the reaction" },
  { from: /^none of them$/, to: "None of them" },
  { from: /^greater mass of\b/, to: "The greater mass of" },
  { from: /^smaller mass of\b/, to: "The smaller mass of" },
  { from: /^greater mass\b/, to: "The greater mass" },
  { from: /^smaller mass\b/, to: "The smaller mass" },
];

const qs = await prisma.question.findMany({ select: { id: true, options: true } });
let fixed = 0;
for (const q of qs) {
  const arr = JSON.parse(q.options || "[]");
  let changed = false;
  const cleaned = arr.map((o) => {
    const s = String(o ?? "").trim();
    if (!s || !/^[a-z]/.test(s)) return o;
    for (const r of PREFIX_RULES) {
      if (r.from.test(s)) {
        const restored = s.replace(r.from, r.to);
        if (restored !== s) {
          changed = true;
          return restored;
        }
      }
    }
    return o;
  });
  if (changed) {
    fixed++;
    await prisma.question.update({ where: { id: q.id }, data: { options: JSON.stringify(cleaned) } });
  }
}
console.log(`扫描 ${qs.length} 题, 已恢复 ${fixed} 题选项首字母`);
console.log("(其余首字母小写的选项属于无法自动确定的,留待老师手动编辑)");
await prisma.$disconnect();