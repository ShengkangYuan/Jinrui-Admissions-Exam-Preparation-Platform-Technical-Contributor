# AGENTS.md — 多 AI 协同开发约定

> 本文件是本仓库的「协作宪法」。任何进入此仓库工作的 AI 助手(WorkBuddy、Cursor、Claude Code、Copilot 等)**必须首先阅读并遵守本文件**。

## 项目概况

- **项目**:TMUA / ESAT 在线刷题系统(学生刷题 + 考试数据维护 + 老师题库管理)
- **技术栈**:Next.js 14 + React 18 + TypeScript(前端);Node.js + Express + Prisma(后端);SQLite(开发)/ PostgreSQL(生产);npm workspaces 管理 monorepo
- **包管理器**:npm(根目录 `package.json` 已配置 workspaces)
- **设计文档**:架构见 `docs/ARCHITECTURE.md`,接口契约见 `docs/API.md`,任务看板见 `TASKS.md`

## 目录结构与所有权(重要!)

| 目录 | 负责人 | 说明 |
|------|--------|------|
| `apps/web/` | **Vibe Coding 工具** | 前端应用(Next.js)。页面、UI 组件、交互、样式归此方 |
| `apps/api/` | **WorkBuddy** | 后端服务(Node + Express)。路由、数据库、业务逻辑、鉴权归此方 |
| `docs/` | 双方 | 接口契约等文档,**修改需同步双方** |
| `AGENTS.md`、`TASKS.md`、`README.md`、根 `package.json` | 双方 | 根目录公共文件,修改需在 PR 描述中说明理由 |

**铁律**:
1. 未经对方确认,**不得修改对方拥有的目录/文件**。
2. 接口(路径、参数、返回结构)变更前,必须先在 `docs/API.md` 更新契约,再实现代码。
3. 两个 AI 绝不同时修改同一个文件。若需要,先通过任务清单(TASKS.md)协调。

## 工作流程

1. **开工前**:`git pull` 拉取最新代码,检查 `TASKS.md` 认领自己的任务。
2. **分支**:每个任务在独立分支开发,命名 `feature/<task-name>`,如 `feature/user-auth`。
3. **提交**:小步提交,提交信息用 `feat:` / `fix:` / `docs:` / `refactor:` 前缀。
4. **合并**:通过 Pull Request 合并,**PR 由另一个 AI 审查通过后**才允许 merge 到 main。
5. **同步**:merge 后双方立即 `git pull` 保持同步。
6. **禁止**:任何人不得直接向 main 分支推送未经审查的代码。

## 代码规范

- **TypeScript**:前端必须使用 TypeScript 严格模式,后端建议使用。
- **接口调用**:前端调用后端统一走 `/api/*` 代理路径,禁止跨域直连后端端口。
- **错误处理**:后端统一返回 `{ code, message, data }` 结构(见 `docs/API.md`)。
- **样式**:前端使用 Tailwind CSS(初始化时配置),禁止内联样式。
- **环境变量**:所有密钥放入 `.env.local` / `.env`,**禁止**提交到仓库。

## 开发命令

```bash
# 首次初始化(完整步骤见 README.md)
cp apps/api/.env.example apps/api/.env   # 准备环境变量(默认值可直接本地运行)
npm install            # 安装全部 workspace 依赖(根目录执行,postinstall 自动 prisma generate)
npm run db:push        # 创建 SQLite 表
npm run seed:all       # 写入种子数据(演示账号 + 官方真题 + 知识点 + 面试题)

# 日常开发
npm run dev:web        # 启动前端,http://localhost:3000
npm run dev:api        # 启动后端,http://localhost:4000
```

## 沟通方式

- 任务认领、进度、阻塞点统一记录在 `TASKS.md`,不在聊天记录里留任务。
- 发现问题需要对方配合时,在 `TASKS.md` 对应任务下加 `@partner` 备注。
