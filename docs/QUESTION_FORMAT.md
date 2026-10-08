# 题目规范格式（唯一真源 / Single Source of Truth）

所有题目**在进入数据库之前**，必须在「录入边界」一次性转换为下面的规范格式。
数据库里永远只存这一种干净格式；不同来源的方言（TMUA 的 `\(...\)`、面试题的 `<sup>`、
示例题的 HTML 实体……）只存在于各自的 `adapters/<source>.js` 里，绝不下沉到题库。

## 1. 字段约定

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `subject` | string | ✅ | `TMUA` / `ESAT` |
| `paper` | string? | | `Paper 1` / `Maths 1` 等 |
| `topic` | string | ✅ | 知识点，如 `代数`、`微积分` |
| `difficulty` | int | | 1–5，默认 3 |
| `type` | string | | `SINGLE_CHOICE` / `MULTIPLE_CHOICE` / `NUMERIC`，默认 `SINGLE_CHOICE` |
| `stem` | string | ✅ | **规范富文本**（见第 2 节） |
| `options` | string[] | ✅ | 选项数组，**至少 2 个**；存库时 `JSON.stringify` |
| `answer` | string | ✅ | **选项文本内容**（不是字母）。需等于 `options` 中某一项（trim 后） |
| `solution` | string? | | 解析，**规范富文本**；可为空 |
| `source` | string? | | 来源标签，如 `TMUA 2016 Paper 1`；用于隔离与灰度 |
| `status` | string | | 默认 `PENDING_REVIEW`（见第 3 节），**绝不默认 `PUBLISHED`** |

> 选项存「文本内容」而非字母，是为了让老师日后能自由增删/重排选项而不破坏答案关联。

## 2. 富文本规范（stem / solution）

只接受以下三种标记，**禁止裸 HTML**：

- 行内公式：`$...$` （如 `求 $x^2-5x+6=0$ 的根`）
- 块级公式：`$$...$$` （独占一行，居中）
- 图片：`![说明](/images/questions/xx.png)`

其余一律按纯文本渲染。数学符号优先用 LaTeX（`\le` `\ge` `\sqrt{}` `\frac{}{}`），
不要写原始 `<` `>` 作为不等号（会被误判为 HTML 标签）；确需文本不等号时用 `≤` `≥`。

**入库前的自动清洗**（见 `scripts/adapters/sanitize.js`）会：
- 把 `\(...\)` → `$...$`、`\[...\]` → `$$...$$`
- 把常见数学记号（`√` `π` `²` `×` `≤` `≥` …）转为 LaTeX（复用前端的 `latexify`）
- **白名单**剥离 HTML：只保留 `<b> <i> <sub> <sup> <br>`，其余标签整体删除；
  不等式 `<`/`>` 当作文本保留（绝不用全局 `<[^>]+>` 删除，那会误删数学符号）

## 3. 状态机（审核机制）

```
       录入/导入/新建
            │
            ▼
       PENDING_REVIEW  ←── 题库默认状态，学生不可见
            │  老师审核
   ┌────────┴─────────┐
   │ approve           │ reject
   ▼                   ▼
PUBLISHED          REJECTED ──(老师修改后重新提交)──► PENDING_REVIEW
(学生可见)          (退回修改)
   │
   ▼ (老师下架)
ARCHIVED
```

- 学生侧（练习/会话/试卷/详情）**永远只看 `PUBLISHED`**；该约束在 API 多处强制。
- 老师通过 `/api/questions/:id/review`（`{action:"approve"|"reject", note?}`）审核；
  审核会记录 `reviewNote` / `reviewedBy` / `reviewedAt`。
- `DRAFT` = 老师自建但未提交的草稿，不进入审核队列。

## 4. 录入管线（防显示 bug 的核心）

```
  原始源 (PDF/网页/截图)
        │
        ▼
  adapters/<source>.js  →  toCanonical(raw)  →  Question[]   （多方言在此消化）
        │
        ▼
  scripts/verify_questions.js  （静态闸门：公式平衡 / 无裸标签 / 选项合法 / KaTeX 可渲染）
        │  任一题不过 → 整批拒绝，报告标注题号+字段
        ▼
  seed / import  →  DB(status=PENDING_REVIEW)
        │
        ▼
  老师审核预览（renderRich 真实渲染）→ 通过 → PUBLISHED
```

`npm run verify:questions` 既能校验待入库的 JSON/JS 数据文件，也能扫全库出「渲染健康报告」。
