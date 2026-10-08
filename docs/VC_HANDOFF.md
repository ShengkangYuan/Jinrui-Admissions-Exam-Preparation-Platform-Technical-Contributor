# 给 Vibe Coding 工具的交接说明

> 本文件是 **Vibe Coding 工具(Cursor 等)** 接手本项目的上手说明书。
> 请先阅读根目录 `AGENTS.md`(分工与规范)、`docs/API.md`(接口契约)、`TASKS.md`(任务看板),再开始工作。
>
> **状态(v2.4.x)**:本交接最初写于 M1 阶段,下列 P0/P1/P2 待办均已完成并多次迭代;当前功能全貌以根目录 `README.md` 与 `解释.md` 为准。

## 1. 项目是什么

**金瑞升学金鹰系统** —— 面向 TMUA / ESAT 备考的在线刷题与教学管理平台,并扩展了雅思语言学习、牛剑面试训练、升学规划模块。

- **学生端**:练习/限时模拟考、自动判分、错题本与收藏、成绩历史、知识点掌握度、学习成长图谱、Roguelike 答题打怪、面试录音、雅思训练、规划档案
- **老师端**:五态题库管理与四种批量导入(含视觉大模型 PDF/图片录题)、组卷、作业与考试分发、七维学情画像、考情分析、AI 教学建议、分组与注册审核
- **管理员端**:教师账号与数据可见范围白名单

## 2. 技术栈与目录

| 目录 | 内容 | 负责人 |
|------|------|--------|
| `apps/web/` | Next.js 14 + React 18 + TypeScript + Tailwind | **你(Vibe Coding 工具)** |
| `apps/api/` | Node + Express + Prisma(SQLite 开发 / PostgreSQL 生产) | WorkBuddy |
| `docs/` | 架构设计 + 接口契约 | 双方 |

## 3. 快速启动

```bash
cp apps/api/.env.example apps/api/.env   # 环境变量(默认值即可本地运行)
npm install                              # 根目录安装全部依赖(自动 prisma generate)
npm run db:push                          # 创建 SQLite 表
npm run seed:all                         # 演示账号 + 40 道官方真题 + 知识点 + 面试题
npm run dev:api                          # 后端 http://localhost:4000(需先启动)
npm run dev:web                          # 前端 http://localhost:3000
```

演示账号:学生 `stu@example.com` / 老师 `teacher@example.com`,密码均为 `123456`。

## 4. 已实现功能(直接可用)

- 登录/注册(公开注册仅产生待审核学生;老师账号走 seed)
- 练习模式:随机/按知识点组卷、逐题作答、答题卡、实时保存、提交判分、解析(含 AI 解析)
- 模拟考模式:服务端校时倒计时、暂停冻结、超时自动交卷与禁答
- 成绩历史、错题本(掌握标记)、收藏、知识点掌握度雷达图与趋势折线图(Recharts)
- Roguelike 答题打怪(服务端权威战斗内核 + Canvas 粒子)、面试题录音、语言四技能训练、规划档案
- 老师题库管理:五态审核流、四种批量导入、视觉 OCR、一键修正、AI 按退回原因重调
- 老师教学:组卷、作业/考试分发、分组、注册审核、七维学情画像、考情分析(规则 + AI 建议)
- 种子题库:6 道示例题 + 40 道 TMUA/ESAT 官方样卷真题(另有 20 道 TMUA 2016 可选种子,导入后待审)

## 5. 已完成的早期待办(存档)

**P0 — 前端体验优化(M1 收尾)**
- [x] 题目公式渲染:已接入 KaTeX(`apps/web/lib/rich.tsx` 自研 Markdown 子集,兼容题干历史格式)
- [x] 移动端适配:学生端核心页面已做响应式处理

**P1 — 数据可视化**
- [x] 成绩趋势折线图(Recharts,数据源 `/me/sessions`)
- [x] 知识点掌握度雷达图(Recharts RadarChart,数据源 `/me/stats`;老师端学生详情页同款)

**P2 — 功能增强**
- [x] 考试成绩报告(每题用时、知识点分布)
- [x] 批量导入界面(Excel/Word/PDF/图片,见 `/teacher`)
- [x] 视觉风格统一(学生端三套主题、教师端统一设计系统)

## 6. 协作规范(务必遵守)

1. **分支**:每个任务一个分支 `feature/<任务名>`,**不要直接改 main**
2. **契约**:接口变更前先改 `docs/API.md`,再动代码;前端只依赖契约,不猜字段
3. **目录边界**:只改 `apps/web/`;`apps/api/` 归 WorkBuddy,确需修改先沟通
4. **提交**:小步提交,`feat:`/`fix:`/`refactor:` 前缀
5. **合并**:通过 Pull Request,由另一个 AI 审查后合并
6. **数据**:学生看不到答案字段(后端已按角色过滤),不要在客户端缓存答案

## 7. 常见问题

- **页面空白**:登录态校验在客户端完成,需先登录;后端未启动时 API 会报"无法连接服务器"
- **公式显示**:已用 KaTeX 渲染,支持 `$...$`/`$$...$$` 与智能公式识别;新录入题目遵循 `docs/QUESTION_FORMAT.md`
- **数据库**:开发用 SQLite 文件 `apps/api/prisma/dev.db`;重置数据可重新执行 `npm run db:push`(会清空)与 `npm run seed:all`(幂等)
