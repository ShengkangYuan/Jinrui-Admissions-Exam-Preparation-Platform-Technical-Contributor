# apps/api — 后端(Node + Express + Prisma)

> **负责人:WorkBuddy。** 目录所有权详见根目录 `AGENTS.md`。

## 首次初始化

```bash
# 1. 准备环境变量(根目录 npm install 后会自动 prisma generate)
cp .env.example .env

# 2. 创建 SQLite 表并写入种子数据(在仓库根目录执行)
npm run db:push
npm run seed:all
```

## 启动

```bash
npm run dev:api        # 根目录执行;http://localhost:4000(文件变更自动重启)
```

健康检查:`GET http://localhost:4000/api/health`(返回服务状态与 AI 是否已配置)。

## 环境变量

见 `.env.example`。仅 `DATABASE_URL` 必需(已有默认值);`LLM_*` 与 `VISION_*` 留空时 AI 功能关闭、其他功能正常;`UPLOAD_DIR` 默认指向 `apps/web/public/uploads`,Linux 生产环境可设为 Nginx 托管目录。

## 约定

- 响应统一为 `{ code, message, data }`,详见根目录 `docs/API.md`(唯一例外:`/api/planning` 返回裸 JSON)。
- 新接口必须先更新 `docs/API.md` 契约,再实现代码。
- 路由挂载一览见 `src/app.js`;判分规则见 `src/lib/grading.js`;数据模型见 `prisma/schema.prisma`。
