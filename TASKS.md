# TASKS.md — 任务清单与分工看板

> **当前状态(v2.4.x)**:本看板为开发过程的历史记录,M1–M5 各阶段任务均已完成并持续迭代(部分早期复选框未及时勾选)。当前功能全貌以根目录 `README.md` 为准,逐模块代码讲解见 `解释.md`。
>
> 每个任务标注负责人:`[WB]` = WorkBuddy,`[VC]` = Vibe Coding 工具,`[BOTH]` = 双方协作。
> 任务状态:`[ ]` 待办,`[x]` 完成,`[!]` 阻塞。

## 阶段一:项目初始化 ✅

- [x] `[BOTH]` 建立 monorepo 骨架(npm workspaces + 目录结构)
- [x] `[BOTH]` 编写 AGENTS.md 协作约定
- [x] `[BOTH]` 初始化 Git 仓库
- [ ] `[BOTH]` 推送到远程仓库(GitHub / Gitee),双方 clone

## 阶段二:系统设计与架构 ✅(文档已落档)

- [x] `[BOTH]` 确定业务:TMUA / ESAT 在线刷题系统(学生刷题 + 考试数据 + 老师题库)
- [x] `[BOTH]` docs/ARCHITECTURE.md 工程架构文档
- [x] `[BOTH]` docs/API.md 完整接口契约(认证/题库/会话/成绩/学情)
- [x] `[WB]` 数据模型 prisma/schema.prisma(User/Question/Paper/Session/AnswerRecord/WrongBook)
- [x] `[BOTH]` 题库来源确定:官方真题(UAT-UK esat-tmua.ac.uk),PDF 需结构化录入

## 阶段三:M1 基础闭环(后端 WorkBuddy 进行中)

- [x] `[WB]` Express 服务 + 健康检查接口 `GET /api/health`
- [x] `[WB]` 数据库接入:SQLite + Prisma(schema 已定)
- [ ] `[WB]` 认证 API:注册 / 登录 / 当前用户(JWT + bcrypt)
- [ ] `[WB]` 题库 API:题目 CRUD + 筛选 + 分页
- [ ] `[WB]` 判分引擎 + 会话 API:创建/作答/提交/详情
- [ ] `[WB]` 成绩与错题本 API:历史 / 错题 / 掌握度
- [ ] `[WB]` 种子数据脚本(官方真题示例题目 + 演示账号)
- [ ] `[WB]` 自动化测试(认证、判分)

## 阶段四:M1 前端 ✅(WorkBuddy 先行实现,VC 工具可在此基础上优化)

- [x] `[VC]` 初始化 Next.js 项目(TypeScript + Tailwind + ESLint)+ `/api` 代理
- [x] `[VC]` 登录 / 注册页面
- [x] `[VC]` 刷题页(练习模式):题目展示、选项作答、即时对错与解析
- [x] `[VC]` 题库管理页(老师):题目列表、新增/编辑/删除
- [x] `[BOTH]` 联调:注册 → 刷题 → 提交判分 → 看成绩

## 阶段五:M2 考试模式(基础已完成,图表待办)

- [x] `[VC]` 限时模拟考界面(倒计时、答题卡、防刷新丢进度)
- [x] `[WB]` 模考交卷判分(超时自动提交,timedOut 标记)
- [ ] `[VC]` 成绩历史与趋势图(建议 Recharts 折线图:按时间展示分数/正确率变化)

## 阶段六:M3 学情分析

- [x] `[VC]` 错题本页面(按知识点分组、掌握标记)
- [ ] `[VC]` 知识点掌握度雷达图(Recharts RadarChart,数据源 `/me/stats`)
- [ ] `[WB]` 老师学情统计 API(班级/个人成绩、按知识点聚合)
- [ ] `[VC]` 老师学情报表页(学生列表、个人详情、班级正确率排行)

## 阶段七:M4 题库增强(真题录入进行中)

- [x] `[WB]` 官方真题 PDF 存档(assets/papers/tmua/ 27 份 + 资料 3 份)
- [x] `[BOTH]` TMUA 真题 PDF 结构化录入实验(2016-2023 正卷为字体乱码需 OCR;早期样卷可提取)
- [x] `[WB]` 真题录入:TMUA Specimen 2017 Paper 1(20 题)+ Paper 2(17 题)+ **图形题 3 题(Q4 卡片 / Q7 函数图 / Q10 对数图)**,共 **40 道官方真题**入库(题库 50)
- [x] `[WB]` **前端图片支持**:`RichText` 组件解析 `![alt](url)`(题干/选项嵌图)、老师编辑/批量导入提示支持
- [x] `[WB]` 图形题图片素材生成:11 张(matplotlib,Q4 卡片 1 + Q7 四选项 + Q10 六选项)
- [x] `[WB]` 批量导入 API(Excel / CSV / JSON)
- [x] `[WB]` 组卷功能(按知识点/难度/数量生成试卷)
- [x] `[VC]` 导入与组卷界面(WorkBuddy 代做,详见 commit 987feec)
- [ ] `[WB]` 2016-2023 正卷录入(需 OCR 或人工,公式校对成本高,建议优先用批量导入接口)

## 阶段八:质量与交付

- [ ] `[BOTH]` 代码审查(互相审查 PR)
- [ ] `[WB]` 自动化测试完善
- [ ] `[VC]` 视觉走查与体验优化
- [ ] `[BOTH]` 部署上线(生产切 PostgreSQL)

---

## 进行中

- [ ] `[BOTH]` 推送到远程仓库(等待用户提供远程地址)
- [x] `[WB]` M1 后端:数据库接入(SQLite + Prisma schema 已落地)
- [ ] `[WB]` M1 后端:认证与题库 API(下一步)
