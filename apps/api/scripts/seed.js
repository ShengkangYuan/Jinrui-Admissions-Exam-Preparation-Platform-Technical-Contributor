// 种子数据脚本:演示账号 + 示例题目
// 运行:npm run seed --workspace=apps/api
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/lib/db.js";

async function seedUsers() {
  const demo = [
    { email: "stu@example.com", password: "123456", name: "演示学生", role: "STUDENT" },
    { email: "teacher@example.com", password: "123456", name: "演示老师", role: "TEACHER" },
  ];
  for (const u of demo) {
    const existed = await prisma.user.findUnique({ where: { email: u.email } });
    if (existed) {
      console.log(`[skip] 用户已存在: ${u.email}`);
      continue;
    }
    await prisma.user.create({
      data: {
        email: u.email,
        name: u.name,
        role: u.role,
        // 种子学生直接设为已通过,避免被账号审核拦截
        ...(u.role === "STUDENT" ? { status: "APPROVED" } : {}),
        passwordHash: await bcrypt.hash(u.password, 10),
      },
    });
    console.log(`[ok] 创建用户: ${u.email} (${u.role})`);
  }
}

// 示例题目(机构自编,风格参考官方真题;正式真题录入见 M4 批量导入)
const demoQuestions = [
  {
    subject: "TMUA", paper: "Paper 1", topic: "代数", difficulty: 2, type: "SINGLE_CHOICE",
    stem: "方程 x^2 - 5x + 6 = 0 的两个实数根之和是多少?",
    options: ["2", "3", "5", "6", "-5"],
    answer: "5",
    solution: "由韦达定理,两根之和 = -(-5)/1 = 5。也可直接因式分解 (x-2)(x-3)=0,根为 2 和 3,和为 5。",
  },
  {
    subject: "TMUA", paper: "Paper 1", topic: "微积分", difficulty: 2, type: "SINGLE_CHOICE",
    stem: "设 f(x) = x^3,则 f'(1) 等于多少?",
    options: ["1", "3", "6", "0", "9"],
    answer: "3",
    solution: "f'(x) = 3x^2,代入 x=1 得 f'(1) = 3。",
  },
  {
    subject: "TMUA", paper: "Paper 1", topic: "数列", difficulty: 2, type: "SINGLE_CHOICE",
    stem: "等差数列 2, 5, 8, ... 的第 10 项是多少?",
    options: ["26", "29", "30", "32", "35"],
    answer: "29",
    solution: "公差 d=3,第 n 项 = 2 + 3(n-1),第 10 项 = 2 + 27 = 29。",
  },
  {
    subject: "TMUA", paper: "Paper 2", topic: "逻辑", difficulty: 3, type: "SINGLE_CHOICE",
    stem: "命题「所有质数都是奇数」是假的。下列哪个数能作为反例证明该命题为假?",
    options: ["2", "3", "5", "7", "9"],
    answer: "2",
    solution: "反例需要是「质数但不是奇数」的数。2 是唯一既是质数又是偶数的数。9 不是质数。",
  },
  {
    subject: "TMUA", paper: "Paper 1", topic: "几何", difficulty: 1, type: "SINGLE_CHOICE",
    stem: "一个直角三角形的两条直角边分别为 3 和 4,其面积是多少?",
    options: ["6", "12", "7", "24", "5"],
    answer: "6",
    solution: "面积 = (1/2) × 3 × 4 = 6。",
  },
  {
    subject: "ESAT", paper: "Maths 1", topic: "物理运动", difficulty: 2, type: "SINGLE_CHOICE",
    stem: "物体以 10 m/s 的速度做匀速直线运动,5 秒内的位移是多少?",
    options: ["50 m", "10 m", "2 m", "15 m", "500 m"],
    answer: "50 m",
    solution: "位移 = 速度 × 时间 = 10 × 5 = 50 m。",
  },
];

async function seedQuestions() {
  const count = await prisma.question.count();
  if (count > 0) {
    console.log(`[skip] 题库已有 ${count} 道题,不再重复写入`);
    return;
  }
  for (const q of demoQuestions) {
    await prisma.question.create({
      data: {
        ...q,
        options: JSON.stringify(q.options),
        answer: String(q.answer),
        solution: q.solution,
        source: "示例题目(机构自编,风格参考官方真题)",
        status: "PUBLISHED",
        createdBy: "seed",
      },
    });
  }
  console.log(`[ok] 写入 ${demoQuestions.length} 道示例题目`);
}

async function main() {
  await seedUsers();
  await seedQuestions();
  await prisma.$disconnect();
  console.log("种子数据完成。演示账号:stu@example.com / teacher@example.com,密码 123456");
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
