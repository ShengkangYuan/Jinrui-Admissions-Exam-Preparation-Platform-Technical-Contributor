// 未提供 .env / DATABASE_URL 时的兜底默认,保证「克隆后未配置环境变量」也能直接启动。
// "file:./dev.db" 相对 prisma/schema.prisma 所在目录解析,即 apps/api/prisma/dev.db。
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = "file:./dev.db";
}

import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();
