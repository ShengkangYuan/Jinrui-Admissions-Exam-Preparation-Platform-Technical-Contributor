// 修复题库中的数学格式问题
// 运行:npm run fix:math --workspace=apps/api
// 当前修复:① \cdot 后缺空格(\cdotb → \cdot b) ② 连续上标拆分(sin^{1}^{0} → sin^{10})
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

async function main() {
  const questions = await prisma.question.findMany();
  let updated = 0;

  for (const q of questions) {
    let changed = false;
    const fix = (s) => {
      let out = s;
      // \cdot 后紧跟字母 → 补空格
      out = out.replace(/(\\cdot)(?=[a-zA-Z])/g, "\\cdot ");
      // 连续上标合并
      out = out.replace(/\^\{(\d)\}\^\{(\d)\}/g, "^{$1$2}");
      out = out.replace(/\^\{(\d)\}(\d{2,})/g, "^{$1$2}");
      if (out !== s) changed = true;
      return out;
    };

    const stem = fix(q.stem || "");
    let options = q.options;
    try {
      const arr = JSON.parse(q.options);
      const next = arr.map((o) => fix(String(o)));
      if (JSON.stringify(next) !== JSON.stringify(arr)) {
        options = JSON.stringify(next);
        changed = true;
      }
    } catch { /* 保持原样 */ }

    if (changed || stem !== q.stem) {
      await prisma.question.update({
        where: { id: q.id },
        data: { ...(stem !== q.stem ? { stem } : {}), ...(options !== q.options ? { options } : {}) },
      });
      updated++;
    }
  }
  console.log(`修复完成:更新 ${updated} 道题`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
