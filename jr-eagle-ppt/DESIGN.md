# 金瑞金鹰系统介绍 · 视觉设计文档

## 一、画布与母版（三区）
- 画布：1280 × 720（16:9），`Slide` 固定 `width:1280px; height:720px`
- A 标题块：0–120px（上 padding 20，主标题 32–40px bold）
- B 内容区：120–660px（高 540，所有正文/图/卡）
- C 页脚条：660–720px（左：项目名「金瑞金鹰系统」灰色小字；右：`NN / 18` 14px 灰字）
- 页面 padding：上下 20，左右 64
- 封面 / 章节过渡 / 结尾页允许自定义版式（可无 C 区）

## 二、颜色系统（深蓝金 · 高端科技）
| 角色 | hex | 用途 | 面积 |
| :-- | :-- | :-- | :-- |
| 背景深蓝 | `#0A0F1E` | 页面底色 | ≤60% |
| 面板蓝 | `#131C33` | 卡片/容器底 | 辅色 ≤30% |
| 主蓝 | `#2563EB` | 标题栏渐变、主按钮、图表系列1 | 主色 |
| 金 | `#D4AF37` | 巨型数字、强调、CTA、分隔线 | 强调 ≤10%（hero 可 15–20%） |
| 浅金 | `#F3D27A` | 金色文字高亮 | 强调 |
| 正文灰 | `#C7D0E0` | 正文 | 中性 |
| 标题白 | `#F8FAFC` | 标题/大字 | 中性 |
| 静默灰 | `#7A89A3` | 页脚、注释、坐标轴 | 中性 |

**渐变方案**：
- 标题/卡片头部：`linear-gradient(135deg, #1E3A8A 0%, #2563EB 100%)`
- 金色强调：`linear-gradient(135deg, #D4AF37 0%, #F3D27A 100%)`
- 背景质感：底层 `radial-gradient(circle at 80% 0%, rgba(37,99,235,0.18), transparent 55%)` 叠加在 `#0A0F1E` 上

**色彩节奏**：封面/章节过渡/结尾强调金占比高（15–20%）；内容页金 ≤8%；至少 2 页（封面、结尾）色彩比例显著不同。

## 三、字体系统
- 中文：`"PingFang SC","Microsoft YaHei","Source Han Sans SC",sans-serif`
- 西文/数字：`"Inter","Helvetica Neue",Arial,sans-serif`
- 层级：
  - 封面主标 64–72px bold，字距 `letterSpacing:2px`
  - 章节大字 56–64px bold
  - 巨型数据/锚点 72–110px bold（金色，与正文明显不同）
  - 页面主标 34px bold
  - 卡片小标 22–24px 600
  - 正文 18–20px regular，行高 1.6
  - 注释/页码 14px

## 四、信息密度
- 常规内容页留白 ≤ 35%；卡片内填充 ≥ 85%；每页 ≥ 1 视觉锚点（≥44px 或截图占 B 区 ≥40%）
- 截图页：截图作为 L1 主视觉占 B 区 55–70%，右侧/下方叠文字说明
- 章节过渡页：左大号章节数字 + 章节名 + 一句小标，留白可 40%

## 五、配图策略
- **L1 真实截图**（来自徐禾欣学生端，存 `assets/`）：个人空间4页、刷题练习、语言学习、冒险模式、面试练习，共 8 张。截图须 Read 核对内容后再嵌入。
- **L2/L1 抽象图（SVG）**：教师端能力、技术架构、导入流水线用 SVG 架构/流程图呈现（深蓝金配色）。
- 禁止混用摄影/插画；本 deck 截图为真实 UI 截图，架构图为 SVG，风格统一（UI 截图 + 矢量架构）。

## 六、页面映射表
| # | 文件 | 类型 | 角色 | 版式 | L1 | 留白% | 色彩分配 |
| :- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| 01 | 01_cover | cover | hero | 全屏深蓝+金色大标 | 背景光晕 | 38% | 金20% |
| 02 | 02_catalog | catalog | supporting | 左标引+右六章卡 | — | 25% | 主蓝+金 |
| 03 | 03_overview | content | hero | 巨型数字总览 | — | 35% | 金爆发 |
| 04 | 04_sec_student | transition | transition | 章节大字 | — | 42% | 金15% |
| 05 | 05_space | content | supporting | 左说明+右截图 | space_home | 28% | 主蓝+金 |
| 06 | 06_case_assign | content | supporting | 上截图+下要点 | sc_assign | 30% | 主蓝+金 |
| 07 | 07_case_analysis | content | hero | 大截图+数据卡 | 薄弱知识点/学情诊断入口 | 25% | 金12% |
| 08 | 08_case_grades_wrong | content | supporting | 双截图并排 | sc_grades/sc_wrong | 28% | 主蓝 |
| 09 | 09_practice | content | supporting | 左说明+右截图 | sc_practice | 28% | 主蓝+金 |
| 10 | 10_language | content | supporting | 左说明+右截图 | sc_language | 28% | 主蓝+金 |
| 11 | 11_roguelike | content | supporting | 左说明+右截图 | sc_rogue | 28% | 主蓝+金 |
| 12 | 12_interview | content | supporting | 左说明+右截图 | sc_interview | 30% | 主蓝 |
| 13 | 13_sec_teacher | transition | transition | 章节大字 | — | 42% | 金15% |
| 14 | 14_teacher_import | content | supporting | 左SVG流水线+右要点 | svg_import | 26% | 主蓝+金 |
| 15 | 15_teacher_paper | content | supporting | 左SVG架构+右要点 | svg_paper | 28% | 主蓝 |
| 16 | 16_teacher_students | content | supporting | 左SVG+右要点 | svg_students | 28% | 主蓝+金 |
| 17 | 17_tech | content | hero | 五大技术亮点卡 | — | 25% | 金12% |
| 18 | 18_ending | ending | hero | 收束金句+落款 | 背景光晕 | 40% | 金20% |
