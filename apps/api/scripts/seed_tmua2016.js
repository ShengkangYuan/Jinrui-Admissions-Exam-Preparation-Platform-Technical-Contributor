// 2016 真题导入(真实考年):TMUA 2016 Paper 1,共 20 题
// 数据来源:scripts/data/tmua2016.js(由 extract_tmua2016.js 从 HTML 生成,已部署不依赖本地文件)
// 运行:npm run seed:tmua2016
import "dotenv/config";
import { prisma } from "../src/lib/db.js";
import questions from "./data/tmua2016.js";

const SOURCE = "TMUA 2016 Paper 1";

async function main() {
  const existing = await prisma.question.count({ where: { source: SOURCE } });
  if (existing > 0) {
    console.log(`[skip] ${SOURCE} 已有 ${existing} 道题`);
    await prisma.$disconnect();
    return;
  }
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    await prisma.question.create({
      data: {
        subject: "TMUA",
        paper: "Paper 1",
        topic: q.topic || "TMUA 2016",
        difficulty: Math.min(5, 2 + Math.floor(i / 6)), // 2,2,2.../3/4/5 分布
        type: "SINGLE_CHOICE",
        stem: q.stem,
        options: JSON.stringify(q.options),
        answer: q.answer,
        solution: q.solution,
        source: SOURCE,
        status: "PENDING_REVIEW",
        createdBy: "official-import-2016",
      },
    });
  }
  console.log(`[ok] 导入 ${SOURCE} ${questions.length} 道`);
  console.log(`题库总数: ${await prisma.question.count()}`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
