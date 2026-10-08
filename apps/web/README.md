# apps/web — 前端(Next.js 14 + TypeScript + Tailwind)

> 系统名称:**金瑞升学金鹰系统**(TMUA / ESAT),含语言学习、面试训练与升学规划模块。

## 已实现页面

| 路由组 | 说明 |
|------|------|
| `/login` | 登录 / 注册(公开注册仅产生待审核学生账号) |
| `/app` | 学生首页:作业/模考、练习入口、学情概览 |
| `/app/practice/[id]` | 核心做题页:逐题作答、答题卡、实时保存、服务端校时倒计时、暂停冻结、草稿板、提交判分与解析 |
| `/app/favorites` | 错题本与收藏,可发起"需要讲评" |
| `/app/interview` | 牛剑风格面试题,录音作答(IndexedDB 本地存储) |
| `/app/language`、`/app/language/practice/[id]` | 雅思等语言学习:听/读/写/说、全真连考分段倒计时、口语录音 |
| `/app/roguelike` | 答题打怪游戏化模式(服务端权威即时战斗,Canvas 粒子) |
| `/app/space` | 个人空间:作业、成绩历史、语言成长曲线、成就与打卡 |
| `/app/my-questions` | 学生原创题(提交后走教师审核流) |
| `/app/planning` | 升学规划档案(嵌入 public/planning.html) |
| `/teacher` | 题库管理:五态审核、四种批量导入、视觉 OCR、一键修正、AI 重调 |
| `/teacher/papers` | 组卷与试卷管理(题量预览、审核进度条、上下架) |
| `/teacher/students`、`/teacher/students/[id]` | 教学管理:作业/考试分发、分组、注册审核、七维学情画像 |
| `/teacher/exams` | 考试安排与考情分析(规则建议 + AI 教学建议) |
| `/teacher/language` | 语言题库、篇章、组卷、写作/口语批改台 |
| `/teacher/knowledge` | 四学科知识点维护 |
| `/teacher/student-questions` | 学生原创题审核 |
| `/teacher/review-requests` | 学生讲评请求处理 |
| `/teacher/teachers` | 管理员:教师账号与可见范围白名单 |

## 技术说明

- **API 代理**:`next.config.mjs` 将 `/api/*` 转发到 `http://localhost:4000`(可用环境变量 `API_PROXY_TARGET` 覆盖)
- **API 客户端**:`lib/api.ts` — 统一 token 注入、`{code,message,data}` 解包、401 自动跳登录
- **数学渲染**:`lib/rich.tsx` 自研 Markdown 子集 + KaTeX(全局引入 `katex/dist/katex.min.css`),支持智能公式识别、`$...$` / `$$...$$` 与题干嵌图
- **图表**:Recharts(雷达图、趋势线、热力网格、环图等),全部客户端动态加载并包错误边界
- **答题进度**:题目存 `sessionStorage`(`session-{id}`),答案实时保存(`answers-{id}`),刷新不丢;考试时间以服务端为准

## 运行

```bash
# 根目录安装依赖、后端已初始化数据库后
npm run dev:web        # http://localhost:3000(需后端在 4000 运行)
```
