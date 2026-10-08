# 工程架构文档 — 金瑞升学金鹰系统(TMUA / ESAT)

> 本文件是系统的设计蓝本。**任何架构级变更必须先更新此文档**,再动代码。

## 1. 系统定位

系统名称:**金瑞升学金鹰系统**。面向 TMUA(Test of Mathematics for University Admission)与 ESAT(Engineering and Science Admissions Test)备考的在线刷题系统。

- **学生端**:按知识点/试卷刷题、限时模拟考、错题本、成绩与掌握度分析
- **老师端**:题库维护(新增/编辑/批量导入)、组卷、查看学生成绩与学情统计
- **角色**:学生(STUDENT)、老师(TEACHER)、管理员(ADMIN)

## 2. 技术架构

```
学生 ─┐                    ┌─ 前端(Next.js 14 + React + TS + Tailwind)
      ├── HTTP /api/* ────┤   学生端:刷题/模考/错题/成绩看板
老师 ─┘                    │   老师端:题库管理/组卷/学情报表
                          ├─ 后端(Node + Express)
                          │   认证(JWT) · 判分引擎 · 成绩聚合 · 批量导入解析
                          └─ 数据库(Prisma ORM)
                              SQLite(开发) → PostgreSQL(生产)
```

- **Monorepo**:npm workspaces,`apps/web`(前端)+ `apps/api`(后端)
- **接口契约先行**:前后端只认 `docs/API.md`,接口变更必须先改契约
- **协同规则**:见根目录 `AGENTS.md`(前端归 Vibe Coding 工具,后端归 WorkBuddy)

## 3. 核心数据模型

详见 `prisma/schema.prisma`。要点:

| 实体 | 职责 | 关键关系 |
|------|------|----------|
| User | 学生/老师账号 | 1:N Session、1:N WrongBook |
| Question | 题目(题干/选项/答案/解析) | 1:N AnswerRecord |
| Paper | 试卷(练习/模考,限时) | 1:N Session |
| Session | 一次答题会话(成绩) | 1:N AnswerRecord |
| AnswerRecord | 单题作答记录(对错/用时) | 分析之源 |
| WrongBook | 错题本(错误次数/掌握度) | 学生×题目 |

**判分规则**:答对得 1 分、答错不扣分(TMUA/ESAT 现行规则),分值在题目/试卷级可配置,不写死在代码。

## 4. 核心流程

刷题闭环:选择模式(练习/模考)→ 限时作答(实时保存)→ 提交判分 → 记录成绩与错题 → 复习薄弱知识点。

## 5. 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| M1 基础闭环 | 认证、题库 CRUD、练习刷题、判分、成绩记录 | 已完成 |
| M2 考试模式 | 限时模拟考(服务端校时/暂停冻结)、成绩趋势图 | 已完成 |
| M3 学情分析 | 错题本、知识点掌握度、老师七维学情画像 | 已完成 |
| M4 题库增强 | Excel/Word/PDF(视觉 OCR)批量导入、组卷、五态审核 | 已完成 |
| M5 扩展模块 | 作业/考试分发、分组、语言学习、面试题、Roguelike、升学规划 | 已完成 |

> 当前版本 v2.4.x,完整功能演进见根目录 `CHANGELOG.md`。

## 6. 关键工程决策

1. **数据库**:开发用 SQLite(零依赖,本地即可运行),生产切 PostgreSQL;Prisma 使切换成本最低
2. **题型**:以单选为主(TMUA/ESAT 均为 5 选 1),预留多选/数值填空
3. **答题实时保存**:模拟考中断刷新不丢进度
4. **题目内容**:官方真题来源 `https://esat-tmua.ac.uk`(UAT-UK 官方,含样题与 ENGAA/NSAA 历年存档),PDF 需结构化录入并人工校对
5. **题库状态机**:DRAFT(草稿)→ PENDING_REVIEW(提交待审)→ PUBLISHED(发布)/ REJECTED(退回)→ ARCHIVED(下架),学生只可见 PUBLISHED 题,退回原因支持 AI 重调

## 7. 环境与命令

```bash
# 首次初始化(详见根目录 README.md)
cp apps/api/.env.example apps/api/.env   # 准备环境变量(默认值可直接本地运行)
npm install                 # 根目录安装全部依赖(自动 prisma generate)
npm run db:push             # 创建 SQLite 表
npm run seed:all            # 演示账号 + 真题 + 知识点 + 面试题

# 日常开发
npm run dev:api              # 后端 http://localhost:4000
npm run dev:web              # 前端 http://localhost:3000
```
