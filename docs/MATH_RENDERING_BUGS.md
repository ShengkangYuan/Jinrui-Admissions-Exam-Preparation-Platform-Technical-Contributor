# 题目公式渲染 Bug 库与预防规范

> 本文档记录「金瑞升学金鹰系统」中**题目数学公式渲染**发现的所有 Bug、
> 根因、修复与**预防规则**。任何对 `lib/rich.tsx`(latexify / smartMath / renderRich)的修改,
> 必须:① 阅读本库;② 修改后运行 `npm run verify:math` 全题库回归;③ 更新本库。

## 〇、登记流程(强制)

**任何显示类问题(斜体/字号/红框/缺字/公式错乱等)被定位并修复后,必须在同一轮工作中登记到本库**:

1. 在「已修复 Bug 清单」表格**最顶部**(按时间倒序)新增一行,填:现象 / 根因 / 修复 / 提交号;
2. 若引出了新的预防规则或回归样本,同步更新「预防规则」与「验证用例集」;
3. 修复+登记完成后,`git add docs/MATH_RENDERING_BUGS.md` 一起提交(与代码提交同 commit 或紧随其后)。

> 这条规则本身也适用于后续所有渲染/显示类修复——"发现问题→修复→登记"是闭环,不允许只修不记。
> 对应项目长期约定见 `.workbuddy/memory/MEMORY.md`。

## 一、已修复 Bug 清单(按时间倒序)

| # | 现象 | 根因 | 修复 | 提交 |
|---|------|------|------|------|
| 31 | **文本形式 `sqrt(...)` 未渲染为根号**:TMUA 自编卷套题选项大量显示 `±(18sqrt(21))/(49)`,`sqrt(21)` 原样外露,无根号;学生/教师看到的选项像是普通英文而非数学公式 | ① `latexify` 函数名替换白名单遗漏 `sqrt`;② 从未把 `sqrt(...)` 这种**文本圆括号**形式转成 LaTeX `\sqrt{...}`;smartMath 虽把整段判为数学,KaTeX 收到的 `sqrt` 被当变量乘积,根号无法显示 | ① `apps/web/lib/rich.tsx`、`apps/api/src/lib/text-clean.js`、`apps/api/scripts/{verify_math.js,normalize_math_data.js,latexify_options.js}` 的 `latexify` 均加入 `fixSqrt`:循环把 `sqrt(...)`(支持嵌套,排除 `\sqrt`/变量前缀如 `rsqrt`)→`\sqrt{...}`;② 函数名替换正则加入 `sqrt`,并统一排除反斜杠避免 `\sqrt`→`\\sqrt`;③ 部署后运行 `fix_sqrt_text.mjs` 修复线上存量数据并同步 answer | this |
| 30 | **PDF 双文件导入答案存成字母、全部无法判分(大量错答案)**:物理等学科「题目PDF+答案PDF」导入后,教师审题看到答案是 `F`/`H`/`G` 等单字母而非选项文本;学生选了正确选项也判错(判分 `a===s` 全等比对,字母永远≠选项文本);部分题字母越界(5 个选项却存 `G`) | ① `questions.js` 双文件导入在 `parsePdf`(已内部 `finalizeRow` 把字母→选项文本)之后,用答案文件**原始字母** `rows[i].answer = answers[i].answer` **覆盖答案**,而 `mapAnswerToOptionText` 只在 `finalizeRow` 内调用一次→覆盖后的字母再无映射机会;② 匹配用**位置**(`answers[i]`→`rows[i]`)而非题号,题数/编号不一致即整体错位 | ① `questions.js` 双文件匹配改为**按题号**(优先题目 `qno`,无则退回位置)并调用 `mapAnswerToOptionText` 把字母→选项文本;② `vision.js`/`import-pdf.js` 增加 `qno` 透传(题目提取带题号,答案按号匹配);③ **越界防护**:字母索引超出选项数量(如 5 选项给 G)视为识别错误,清空交教师审核;④ 一次性脚本把全库 `PDF 导入` 的字母答案映射回选项文本、越界清空 | 8e37100 |
| 29 | **选项里罗马数字 `I` 被吞**——`I only`→`only`、`I and II only`→`and II only`、`I and IV only`→`and IV only`;线上 46 道含 `only` 的题中 **10 道** 中招(如 `cmslhyim70005k9n8qqzs1ld7`、`cmsles85u000cfqh19eiutve8`)。TMUA/ESAT 的「以下哪些正确」题型几乎全用 `I/II/III` 选项,影响面大且**改变题意**(学生看到的选项与原卷不一致) | `cleanOptionPrefix` 正则字母类 `[A-Ja-j]` **包含了 `I`**;而 `I only` 恰好是「大写字母 + 空格分隔符」,完全符合"选项字母前缀"的模式(等价于 `I. only`)→ 被当前缀删除。**这是 #17 的同一函数第二次踩坑**:#17 修 `*`→`+` 解决了"零分隔符"的误删,但没意识到 `I` 本身既是英文单词/罗马数字**又是合法选项字母**,只要它后面跟空格就必然误判——`+` 量词救不了 | ① `questions.js` `cleanOptionPrefix` 字母类改为 `[A-HJ-Za-hj-z]`,把 `I/i` 排除在可清洗前缀之外(第 9 个选项标签 `I.` 极少出现,宁可漏清洗也不能吞题意);② 线上脚本扫描全部含 `only` 的选项,按 `only`→`I only`、`and <罗马数字> only`→`I and <罗马数字> only` 规则回填修正 10 道题;③ 修复后复扫,损坏数 0 | 5acb124 |
| 28 | **题干/解析多个独立公式挤在同一行、序号(I/II/III)贴在一起**:2022 TMUA Q10(`cmslcv3o0000zqayx5`)「I $y = x^3 - 3x^2 + 9x - 27$ II $y = x^3 - 9x^2 + 27x - 3$ III $y = 27x^3 - 9x^2 + x - 3$」、2022 TMUA Q3(`cmslcv3mn000sqayx16edoft6`)「- f''(x)=a for all x- f(0)=1,f(1)=2- ∫₀¹f(x)dx=1」等——**数据里每个公式独立一行(含 `\n`),但渲染出来全挤在一行** | `rich.tsx` text 包裹层用 `<span>{text}</span>`,HTML 默认 `white-space: normal` **把 `\n` 折叠为单个空格** → 多行数据渲染成一行 | `rich.tsx` 三处 `<span>` 加 `whitespace-pre-wrap` 类(L110/L111 renderRich 的 text token 包裹、L267 smartMath flushText),保留 `\n` 换行。短文本(无 `\n`)无影响。**注意**:V2.3.24 commit 曾因 push 遗漏导致线上未生效(用户复测仍坏),必须验证服务器 commit + grep 到改动才可交付 | this |
| 26 | **AI 生成英文解析格式/公式显示错乱**:解析出现 `## Solution Steps`、`- ` 列表、`**bold**` 字面显示,且英文正文段落被渲染成斜体(如 "never touches or crosses the $x$-axis" 整段数学化) | ① V2.3.17 的解析 prompt 要求「用 Markdown headings ## 组织」,但渲染层 `renderRich` 不解析 Markdown,`##`/`- `/`**` 原样显示;② `renderRich` 默认对非公式文本走 `smartMath`(为题干设计),英文长段落被误判成数学斜体 | ① `rich.tsx` `renderRich` 新增 `opts.smart=false` 参数,非公式文本原样输出——题干/选项仍 smartMath,解析类长文本(`reviewQ.solution`/`d.solution`/`w.solution`)传 `{smart:false}`;② `questions.js` 两处解析 prompt 改为「plain text + 简单换行分段,禁止 ##/- /**,公式只用 $...$/$$...$$,禁止 \\( \\[ \\text \\begin \\\\」;③ 一次性脚本清洗存量解析的 `##`/`- `(行首)/`**` 标记 | this |
| 25 | **公式块级/行内混用 + 裸 LaTeX 源码不渲染**:如 2017 第 11 题(cmsladx3n000a88r5027kxs8g)题干渲染为:`$$x_1 = 7$$` 居中独占一行,紧接着的 `x_{n+1} = \frac{23x_n - 53}{5x_n + 1}` 完全是裸 LaTeX 源码(KaTeX 不渲染,显示 `x_{n+1}` `\frac` 等源码),末尾的 `$$\n` 是孤儿 display math(开 `$$` 但找不到闭合 `$$`)→ 整段排版错乱 | 视觉模型对短公式习惯用 `$$...$$` 块级,但紧跟的下一行公式忘了加 `$` 包裹直接裸写,又用 `$$\n` 试图开新块级却没闭合;**`vision.js` SYSTEM_PROMPT 第 46 行只笼统说「开 `$$` 必有闭 `$$`,不要在公式中间出现孤立的 `$`」——过于抽象,模型没遵守** | ① 一次性 UPDATE 该题 stem,把 `$$x_1 = 7$$` → `$x_1 = 7$`、裸 `x_{n+1} = \frac{...}{...}` → `$...$` 包裹、删孤儿 `$$\n`;② `vision.js` SYSTEM_PROMPT 新增「**公式定界符选择**」规则(显式定义短公式用 `$...$` 行内、复杂表达式才用 `$$...$$`、严禁块级与行内混用/半边定界符) | this |
| 27 | **`\begin{pmatrix}` 等 LaTeX 环境命令原样外露**:题干 `$\begin{pmatrix} 3 \\ -5 \end{pmatrix}$` 显示为字面 `\begin{pmatrix}...` 源码(TMUA 2020 Q10) | `looksLikeTextInDollars`(V2.3.1 为防零散 `$` 引入)用 `\b[a-z]{2,}\b` 统计英文词,把 `begin`/`end`/`pmatrix` 当普通单词(≥2 个)→ 整个 `$...$` 误判为"数据残留文本"退回文本,KaTeX 不渲染 | `rich.tsx` `looksLikeTextInDollars` 先剔除 LaTeX 命令(`\\[a-zA-Z]+`)与环境名(`{[a-zA-Z]+}`)再统计;8 用例验证 | this |
| 25b | **同卷内两个公式挤在同一行**:**2018 Q3/Q4**(`cmslazgrq0002qgwy554gmrmm` 圆方程对、`cmslazgry0003qgwy3y08cvg2` 联立方程组)、**2017 两题**(联立方程、解积分方程)、**2019 一题**(`cmsjwe4gy000v1d4iif1ti8kq` 对数方程组)。每题 stem 都是 `$$ 公式 A $$ 公式 B $$`(第二公式裸 LaTeX,末尾 `$$\n` 是孤儿块级)。`tokenize` 正则 `\$\$([\s\S]+?)\$\$` non-greedy 在奇数 `$$` 时把后续所有内容吞进一个超长块级公式 → KaTeX 报「Unexpected 」整段 LaTeX 源码 fallback 显示 | 视觉模型按原文 PDF 多公式连写,但导入后端没自动清洗、也没要求导入时换行——**5 题都靠手工 UPDATE 修复**:`stem` 每个公式独立一行 + 完整 `$$...$$` 包裹。**`vision.js` prompt 强化**:① 「**每个公式必须独立一行,严禁多个公式挤在同一行**」② 「**`$$` 必须两两配对,严禁单边 `$$`**」③ 「**display math 仅用于多行/分式/积分/求和/极限/矩阵;短公式用行内 `$...$`**」。**配套**:`scripts/verify-md-pairs.cjs` 扫全库,任何 stem 含奇数个 `$$` 或奇数个 `$` 退出码 1,可入 CI 防回归 | this |
| 24 | **行内公式兜底分支仍泄露 `$` 字符**:V2.3.1 修复后,题干中 `$This is a regular sentence about numbers$` 这类零散 `$`(内含 ≥2 个普通英文词)仍显示为 `$This is a regular sentence about numbers$`(前后两个 `$` 字符原样显示) | V2.3.1 新增的 `looksLikeTextInDollars` 兜底分支退回到文本 token 时**用了 `m[0]`(整段匹配,含外层 `$` 字符)**;任何被拦截的 `$...$` 都会泄露 2 个 `$` 字符。被外层 `$` 包裹的英文句子本来想作为文本渲染却被 `$` 字符本身污染 | `apps/web/lib/rich.tsx` tokenize:退回时改用 `expr`(剥掉外层 `$`),仅把内部内容作为文本 token 推进。`$` 字符从此**不会再进入文本 token** | this |
| 23 | **题库题干/选项中 `$` 字符直接外露、整段被吞成巨大公式**:如题干出现 `f(x)g(x) = \cos^2 x$ for all real numbers x ... any x$ ?`,`$` 符号可见且后续整段被渲染成 KaTeX 变量斜体,导致题干无法阅读 | 数据导入/PDF 提取残留**只保留闭合 `$` 而丢失开头 `$**;`rich.tsx` 行内公式正则 `\$([^$]+?)\$` 会把两个零散 `$` 之间的整段正文吞进一个巨大行内公式,触发 KaTeX 把英文单词全部当变量渲染 | `apps/web/lib/rich.tsx`:① tokenize 增加 `looksLikeTextInDollars`,若 `$...$` 内含多个普通英文单词则退回文本;② `isMathToken` 增加 `stripDollarArtifacts`,让 `x$` 按变量 `x` 进入数学模式;③ `smartMath` 开头去掉片段首尾零散 `$`,flushMath 时从数学 buffer 中剔除所有残留 `$` | this |
| 22 | **行内公式/字母/数字比正文小**:题库、练习、错题本中 `$x^2 - 5x + 6 = 0$`、`$3$` 等行内公式/数字比 surrounding text 小一截;同一句中 `$3$` 与正文 `4` 大小不一 | V2.2.5 修复 #21 对齐时,在 `globals.css` 给 `.math-inline .katex` 加了 `font-size: 1em !important`;KaTeX 字形本按 1.21em 设计,强制 1em 后视觉上比正文小,且该规则是全局样式,所有走 `renderRich` 的页面均中招 | `apps/web/app/globals.css`:移除 `.math-inline .katex { font-size: 1em !important }`,恢复 KaTeX 默认 1.21em;保留 `.math-inline { display:inline; vertical-align:baseline; overflow:visible }` 保证基线对齐 | this |
| 21 | **行内数学 `x`/公式与正文上下不齐**:题干中 `x`、`x - 3y + 1 = 0`、`3x² - 7xy = 5` 等行内公式相对 surrounding text 明显上浮/下沉,单字母 `x` 看起来像上标 | `.math-inline` 外层被设为 `inline-block` 并加 `overflow-x:auto`;当 inline-block 的 `overflow` 不为 `visible` 时,其基线会落到块底部,导致 KaTeX 数学片段与正文基线错位 | `rich.tsx` 行内数学包裹层只保留 `className="math-inline"`,去掉 `inline-block`/`overflow-x-auto` 等工具类;`globals.css` 显式设置 `.math-inline { display:inline; vertical-align:baseline; overflow:visible; }`,内部 `.katex` 同样 `display:inline; vertical-align:baseline;` | this |
| 18 | **化学式括号仍斜体**:`NaCl(aq)` 的 `(aq)`、`copper(II)` 的 `(II)` 显示斜体;smartMath 把括号当 OP_TOKEN,括号内字符被判数学 | `(aq)`/`(II)` 单 token 进入 smartMath,`(` `)` 匹配 OP_TOKEN 数学,内部字符 `aq`/`II` 经 MIXED_LET/VAR 判数学 → KaTeX 数学字体斜体 | `isMathToken` 新增:`/^\(([a-z]{2,}|[IVX]+)\)$/i` 命中→文本(化学状态 `(aq)`、罗马数字 `(II)/(III)/(IV)`);`(x)` 单字母不匹配,仍数学 | this |
| 20 | **化学式裸下标显示 `X_n` 而非 `X₃`**:`HNO_3`、`CuNO_3`、`H_2O`、`NO_2` 等下标全部保留为 LaTeX `_n` 字面 | `cleanUnits` 只处理了**裸上标**(负幂次 `mol^{-1}`、`cm^3`)和 `$...$` 内的内容,**没有处理裸文本下标** `([A-Z][a-z]?)_(\d+)` 形式;视觉模型常输出 `HNO_3`/`CuNO_3` 等 | `cleanUnits` 新增:`.replace(/([A-Z][a-z]?)_(\d+)/g, (_, formula, n) => `${formula}${toSub(n)}`)`。`HNO_3`→`HNO₃`、`H_2O`→`H₂O`、`CuNO_3`→`CuNO₃`、`NO_2`→`NO₂` ✓。配合 #16 的 `HAS_UNI_SUP_SUB` 规则,清洗后判文本(正文字体)。**注意**:`x_n` 数学变量下标不误伤(`x` 不匹配 `[A-Z]`) | this |
| 19 | **句子末尾括号注释整段斜体**:`(Ignore ions produced by dissociation of water.)` 中 `Ignore`、`dissociation`、`water` 整段斜体 | smartMath 按空白切分 `(Ignore...)` 得到 tokens `(`+`Ignore`、`ions`...、`water.)`(末尾 `)` 与 `.` 紧贴)。`water.)` 含 `)` 命中 `MIXED_LET` 数学特征 → 被判数学 → KaTeX 渲染;前面累积文本被 flush,整段视觉在数学上下文中 | `isMathToken` 新增:`/^[a-zA-Z][a-zA-Z.,;:'\-]*\)$/` 命中→文本(末尾 `)` 前面是普通英文)。`water.)` → 文本 ✓;`(x)` 数学不破坏(单字母被 `[a-z]{2,}`/规则不命中,仍数学) | this |
| 17 | **选项首字母被吞**——`Covalent`→`ovalent`、`It has`→`t has`、`gains`→`ains`;扫库 72 个选项中招,本质是导入时清洗函数 | `cleanOptionPrefix` 正则 `[\(\[【（]?[A-Ja-j][\.\s:、)）\]】」、\]】]*` 用 `*`(零或多个),允许**零个分隔符**,等价于"删开头的单个字母":任何 `[A-Ja-j]` 开头的选项(几乎所有选项)都被误删首字母 | `*` 改为 `+`(一个或多个),要求字母后**至少一个分隔符**(`.`/` `/`:`/`)`/`]`等)。`Covalent bonds` 中 `C` 后是 `o`(字母,非分隔符)→ 不匹配 → 不删 ✓;"A 1/25" 中 `A` 后是 ` `(分隔符)→ 删 `A ` ✓ | this |
| 16 | 选项/题干出现红框 `mol~^{-1}`,KaTeX 报 **Double superscript**;`mol⁻¹`、`dm⁻³` 等单位大量报错;以及 `AgNO₃`/`C₃H₇OH` 化学式斜体、`is/are` 英文词斜体 | ① 数据清洗把 `^{-1}` 转成 **Unicode 上标 `⁻¹`**,但 latexify 把 Unicode 上标 `¹` **单字符**转回 `^{1}`,与 `⁻` 拼成 `⁻^{1}` → KaTeX 双上标;② `isMathToken` 把含 Unicode 上下标的 `mol⁻¹`/`AgNO₃` 误判数学(化学式字母变斜体);③ `is/are` 等含 `/` 英文组合被 `/`(OP_TOKEN)带进数学模式 | ① latexify **先合并连续 Unicode 上下标序列**(`⁻¹`→`^{-1}`、`cm³`→`cm^{3}`);② `isMathToken` 开头 `HAS_UNI_SUP_SUB` 命中→文本;`MIXED_LET/MIXED_NUM` 特征类移除 Unicode 上下标;③ `^[a-z]+(/[a-z]+)+$`(is/are、and/or)→文本;④ `^\circ`→`°`;⑤ `renderMathExpr` 渲染失败 **fallback 原文**;前后端两份 latexify 同步 | 6d74a86 76b5df6 a04bd9a d14d4f1 |
| 15 | 题干/解析大量**英文单词莫名变斜体**(如 `radius.`、`Thus,`、`points.`、`-coordinate`) | `MIXED_LET` 把 `.` `,` 当"数学特征"→ 英文单词带句号/逗号("radius.")被判数学;`MIXED_NUM` 开头类含 ASCII `-`,把 "-coordinate" 整词判数学;KaTeX 数学模式默认斜体 | ① `MIXED_LET` 数学特征类去掉 `.` `,`;② `MIXED_NUM` 开头类去掉 ASCII `-`/`+`/`[`(负号由 OP_TOKEN 处理,不破坏 "(n"、"-5x" 等真数学) | bc8d7ec 2a9a283 |
| 14 | `log`/`sin`/`\frac` 前**露出反斜杠**、排版错乱换行;且反复出现于导入题 | ① 视觉模型/录入常写 `$ f(x) $`(`$` 后带空格),行内公式正则 `\$([^\s$][^$]*)\$` 要求 `$` 后非空白 → 整段被降级为普通文本;② smartMath 不认反斜杠开头的裸命令(`\log`)→ 按纯文本字面显示反斜杠 | **三层修复**:① `rich.tsx` 行内公式正则改 `\$([^$]+?)\$`(允许 `$` 后空格);② smartMath 识别含 `\` 的裸命令(`\\[a-zA-Z]+`,覆盖 `3\pi`),latexify 函数名 lookbehind 加 `\\` 防 `\log`→`\\log`;③ 导入层 `text-clean.js` 新增 `normalizeInlineFormula`(`$ x $`→`$x$`,并入 `normalizeNewlines`/`toCanonicalText`),存量数据全库清洗 | 865a4f8 5f4e126 479a527 |
| 13 | `log₁₀(2/(a+2b+3c))` 分数显示斜杠 | KaTeX 数学模式**不推断语义**,`/` 必须显式 `\frac`;而 `$...$` 数学分支**跳过了 latexify** | math 分支渲染前也调 `latexify(t.expr)`(幂等) | 02b4baf |
| 12 | `2 / (a+2b+3c)`(带空格)分数不转 | 分数正则 `/` 前后不容忍空格 | 正则加 `\s*` | 1cd0aca |
| 11 | `(n−1)/(3n−1)` 两边括号未转分数 | 分数正则只匹配 `A/(B)` | 增加 `\(A\)/(B)` 形式;并限制 A 首字符为字母/数字(避免吞 `+`/`−` 运算符) | bcf5eec |
| 10 | `3x/(x−2√3)` 中 3 显示在根号外 | 外层 `align-middle`(vertical-align:middle)干扰 KaTeX 内部基线计算 | 外层改 `align-baseline`;另加 `/` → `\frac` 自动转换 | 72c962a |
| 9 | `2x²−11x+c = 0differ by 2`(0 与 differ 粘连) | KaTeX 数学模式**忽略表达式尾部空格** | flushMath 后显式追加 `" "` 文本节点 | c11b292 |
| 8 | 题干英文单词(Given/sum/it)被当数学整段斜体 | 字符类 `[+\-−*/=...]` 中 `+\-−` 被解析为**范围**(+ 到 −,覆盖整个 ASCII)→ 任意单字符误判为运算符 | `\-` 转义、`−` 移末尾;MIXED 拆数字头/字母头两式;纯小写单词(≥2 字非函数名)判文本 | f9fb5a7 |
| 7 | 单字母变量 x/y 被当英文单词 | PURE_WORD `/^[a-z]+$/` 误伤单字母 | 改为 `/^[a-z]{2,}$/` | f9fb5a7 |
| 6 | `3cos θ` 的 cos 未转 `\cos` | `\b` 边界在数字与字母之间**不成立**(3c 都是 \w) | 函数名替换用 `(?<![a-zA-Z])` 否定后视 | 1ce9f6c |
| 5 | 选项 `q.options.map` 崩溃 | 后端创建会话返回的 options 是 JSON 字符串(仅 GET 详情解析过) | 后端 `safeParseOptions()` 统一解析为数组 + 前端 normalize 兜底 | 23ee8cc |
| 4 | 图形题图片不显示 | 渲染层未支持 Markdown 图片语法 | RichText 解析 `![alt](url)` | ce89346 |
| 3 | 根号 `√3` 显示为 `√` 加散落 3 | latexify 未将 `√` 转 `\sqrt` | `/√\(...\)/→\sqrt{...}`,`/√[a-zA-Z0-9]/→\sqrt{字符}` | 1ce9f6c |
| 2 | `x^2` 上标不标准 | latexify 未处理 `^` | `\^\(...\)→^{...}`,`\^[0-9a-zA-Z]→^{...}` | 1ce9f6c |
| 1 | 公式显示不标准(题干中 3x^2 等纯文本) | 只有纯数学选项被渲染,题干中夹英文的公式未识别 | smartMath 智能切分 + latexify + KaTeX | 1ce9f6c |

## 二、预防规则(核心规范,改代码前必读)

1. **正则字符类中的 `-` 必须转义(`\-`)或放首尾**,否则形成范围陷阱(如 `[-−]` 覆盖整个 ASCII)。凡是含 `+`/`-`/`−`/`*` 等符号的字符类,逐字符检查。
2. **KaTeX 不做语义推断**:`\frac`、`\sqrt`、`\log` 等所有命令必须显式。latexify 是"语义化转换器",**任何传给 KaTeX 的输入都必须先过 latexify**(text 分支和 math 分支都要)。
3. **KaTeX 数学模式忽略空格**(行内):混排时数学片段后必须显式补视觉空格(flushMath 后 push `" "`)。
4. **不要用 `vertical-align: middle` 包裹 KaTeX**,用默认/`baseline`,否则根号、上下标基线错乱。
5. **函数名转换**(sin/cos/log...)用 `(?<![a-zA-Z])` 而非 `\b`(数字后 `\b` 不成立);**且 lookbehind 必须再排除反斜杠 `(?<![a-zA-Z\\])`**,否则会把已是 `\log` 的重复加 `\` 成 `\\log`(见 #14)。
6. **单字母变量**排除英文冠词/代词 `a/A/i/I`;纯小写英文单词(长度≥2、非函数名)判文本。
7. **选项的 options 字段**:后端接口返回前必须解析为数组(`safeParseOptions`),前端渲染再做一次 normalize 兜底。
8. **改动必须回归**:改完 latexify/smartMath 后运行 `npm run verify:math --workspace=apps/api`(全题库扫描,检测 KaTeX 渲染错误、未转换残留、**公式外裸命令**)。
9. **行内公式正则必须允许 `$` 后带空格**:统一用 `\$([^$]+?)\$`(而非 `[^\s$]`),否则 `$ f(x) $` 会被当纯文本、内部 `\log` 等裸命令露出反斜杠。**此正则在前端 `rich.tsx`、`autofix.js`、`scripts/verify_math.js` 三处各有一份,改动必须同步**(见 #14)。
10. **`$...$` 包裹外的裸反斜杠命令必须被 smartMath 识别为数学**(`/\\[a-zA-Z]+/`),否则字面露出 `\`。渲染层兜底之外,导入归一化(`text-clean.js` 的 `normalizeInlineFormula`)负责把数据规范成 `$...$`。
11. **核心审查项——公式外裸命令**:`autofix.js` 的 `bare_latex` 规则与 `healthCheck`、`verify_math.js` 的裸命令扫描,会检出 `$` 外未包裹的 `\log`/`\sin`/`\frac`/`3\pi` 等并报告;所有导入/修改的数据入库前都应通过该审查。
12. **数学特征判定(MIXED_LET/MIXED_NUM)必须用"真数学特征"**:`.`/`,`(英文标点)、ASCII 连字符 `-` 不是数学特征,否则 `radius.`、`Thus,`、`-coordinate` 等英文词会被误判为数学而渲染成**斜体**(见 #15)。判定"是数学"的特征应是:数字、`^`、`√πθ`、`−`(U+2212)、下划线、括号等。
13. **latexify 处理 Unicode 上下标必须先"合并连续序列"再"单字符转换"**:`⁻¹` 等必须整体转 `^{-1}`,禁止拆成 `⁻`+`^{1}`(会 Double superscript 报错,见 #16)。`MATHY_TOKEN` **不要**包含 Unicode 上下标字符(²³⁴⁵⁶⁷⁸⁹⁰¹⁻₀₁₂₃...),它们多出现在单位/化学式(`mol⁻¹`、`cm³`)中,应按普通文本显示而非数学渲染。
14. **任何 KaTeX 渲染失败必须 fallback 显示原文**(escapeHtml 后输出),禁止把 `katex-error` 红框留给用户;同时保留数据层清洗(把 `^{-1}`→`⁻¹`、`^\circ`→`°` 等)让单位用正文字体。
15. **含 Unicode 上下标的 token 一律判文本**(`HAS_UNI_SUP_SUB` 命中即 false),化学式/单位(`AgNO₃`、`mol⁻¹`、`cm³`)不得进数学模式。
16. **纯小写英文用 `/` 连接的组合**(`is/are`、`and/or`、`either/or`)一律判文本,防止 `/`(OP_TOKEN)把英文词带进数学模式变斜体。
17. **清洗正则里的量词要审查**:允许"零个"的量词(`*`、`?`)常导致误删(见 #17:`[A-Ja-j][分隔符]*` 变成"删任意单字母")。凡"必须要有 X 才删"的规则,分隔符量词用 `+`。
29. **选项前缀清洗必须排除 `I/i`**(见 #29):`cleanOptionPrefix` 的字母类固定为 `[A-HJ-Za-hj-z]`,**永远不要把 `I` 加回去**。理由:`I` 同时是英文单词(`I have...`)、罗马数字(`I only`、`I and II only`)和合法选项字母,三义重叠且无法从上下文可靠区分;而 TMUA/ESAT 大量使用 `I/II/III` 罗马数字选项,一旦误删就**改变题意**且用户很难发现。第 9 个选项标签 `I.` 出现概率远低于罗马数字选项,**宁可漏清洗,不可吞正文**。
    - 同理,任何"按开头字符删前缀"的清洗都必须先问:**这个字符本身有没有可能是正文的一部分?** 有则加白名单排除,而不是靠加严分隔符规则(#17 的 `*`→`+` 就救不了 `I only`)。
    - **清洗类改动必须配套扫库验证**:改完 `cleanOptionPrefix` 之类的函数,要用脚本扫全库对比清洗前后差异(至少抽查含罗马数字、化学式、英文短语的选项),而不只是单测几个字符串。
18. **括号内的化学状态/罗马数字判文本**(见 #18):smartMath 把 `(` `)` 当 OP_TOKEN,容易把 `(aq)` `(II)` 这类带进数学模式。`isMathToken` 增加:`/^\(([a-z]{2,}|[IVX]+)\)$/i` → 文本。单字母 `(x)` 不命中,保留数学。
19. **句子末尾括号注释也容易整体被吞**(见 #19):`(Ignore ions produced by dissociation of water.)` 因末尾 `water.)` 含 `)` 被 `MIXED_LET` 判数学,整段渲染走样。`isMathToken` 增加:`/^[a-zA-Z][a-zA-Z.,;:'\-]*\)$/` → 文本(英文开头 + 末尾 `)`)。
20. **化学式裸下标要清洗**(见 #20):视觉模型输出 `HNO_3`/`CuNO_3`/`H_2O`/`NO_2`,前端渲染显示 `X_n` 字面。`cleanUnits` 增加:`/([A-Z][a-z]?)_(\d+)/g` → Unicode 下标(`HNO₃` 等);`x_n` 数学变量不误伤(`x` 不匹配 `[A-Z]`)。
21. **行内 KaTeX 必须用 `display:inline` + `vertical-align:baseline` 包裹,不能用 `inline-block` 加 `overflow:auto` 等会改变基线的容器**(见 #21)。行内公式需要滚动时,优先改用 `$$...$$` 块级公式;若坚持行内滚动,也必须在 CSS 中避免破坏基线(如给 `.katex` 自身加 `overflow-x:auto` 而非外层 inline-block)。
23. **零散 `$` 必须被渲染层鲁棒处理,不能只依赖导入清洗**(见 #23):PDF/Word/图片提取很容易只保留公式闭合 `$` 而丢掉开头 `$`,导致 `$` 字符外露或整段正文被吞进 `$...$`。前端 `rich.tsx` 必须具备三重兜底:① 识别 `$...$` 内是否像普通英文句子,是则退回文本;② `smartMath` 自动识别数学片段时去掉 token 尾部零散 `$`;③ 文本片段首尾孤立的 `$ ` / ` $` 直接清洗掉。修改后要跑新增回归样本验证。
22. **禁止对 `.math-inline .katex` 强制 `font-size: 1em` 或更小**(见 #22):KaTeX 默认 `font-size: 1.21em` 是数学公式与 surrounding text 协调的正确比例;强行压成 1em 会让公式/字母/数字看起来比正文小。若需统一字号,应调整外层容器字号,而不是压扁数学公式,否则题库、练习、错题本等所有使用 `renderRich` 的页面都会看到公式偏小。
28. **`renderRich`/`smartMath` 的 text 包裹层必须保留换行(`whitespace-pre-wrap`)**(见 #28):HTML `<span>` 默认 `white-space: normal` 会把数据里的 `\n` 折叠为单个空格——数据里明明每个公式独立一行,渲染出来却全挤成一行(2022 Q3/Q10 踩坑)。**规则**:`rich.tsx` 中任何渲染文本内容的 `<span>` 都加 `className="whitespace-pre-wrap"`(当前在 L110/L111 与 smartMath 的 flushText L267);**新增文本渲染点时必须同步加该类**。另:**修复后必须验证服务器 commit 已推送 + grep 到改动**,否则用户复测仍坏(V2.3.24 曾因 push 遗漏导致线上未生效)。
25. **公式定界符必须严格二选一,严禁混用或半边**(见 #25):同一份题干里要么全部用 `$...$`(行内)要么全部用 `$$...$$`(块级),**任何公式都不能「半边」**。具体判定:
   - 短公式 / 简单等式 / 单变量赋值 / 短不等式 / 短函数定义 → **行内** `$...$`(例:`$x_1 = 7$`、`$a+b=c$`、`$f(x) = 2x+1$`);
   - 多行 / 分式 / 积分 / 求和 / 极限 / 矩阵 / 复杂表达式 → 独立 `$$...$$`(例:`$$\int_0^1 f(x)\,dx$$`);
   - 像 `x_1 = 7`、`x_{n+1} = \frac{...}{...}` 这类短公式**禁止**用 `$$...$$`;
   - **严禁**出现 `$$x_1 = 7$x_{n+1} = ...$$` 这类块级与行内混用,或 `$\n...` / `...$$` 这类半边定界符(光视觉模型不渲染、且 KaTeX 报 orphan error);
   - **视觉模型 prompt(`vision.js` SYSTEM_PROMPT)必须**显式列出以上短公式 vs 复杂表达式分界规则,并明确禁止块级与行内混用;修改 `vision.js` 务必同步登记到本规则集;
   - **`vision.js` 模板字符串内禁止反引号**(本规则集中最严的隐患):SYSTEM_PROMPT = \`...\` 是 JS 模板字符串,若在 prompt 内容里写反引号包裹示例(如 \`\`$x_1 = 7$\`\`)会**提前闭合**模板字符串,触发 SyntaxError 导致 api 启动失败(pm2 errored 一直重启 99 次,线上 api 整个不可用)。**已踩坑三次**(V2.3.14 加答案页 prompt / V2.3.15 修复 / V2.3.18 加公式排版规则——三次都因反引号)。**规则**:prompt 内的规则示例要用「公式」时,直接裸写 `$x_1 = 7$` 或用中文「」括号,绝不使用反引号;**修改 `vision.js` 后必须本地 `node --check` 验证语法**,并部署后 `curl /api/health` 确认 api 启动成功。

30. **PDF 双文件导入的答案必须是「选项文本」而非字母**(见 #30):判分 `a===s` 全等比对,答案字段存 `F`/`G` 这类字母永远≠选项文本→全错。规则:① 任何把答案文件字母写回题目 `rows[i].answer` 的代码,**必须**经过 `mapAnswerToOptionText(letter, options)` 映射成选项文本(字母→文本只在 `finalizeRow` 内发生一次,覆盖式赋值时不会自动重跑,极易漏);② 答案与题目**按题号(`qno`)匹配**,绝不按位置(`answers[i]`→`rows[i]`),否则题数/编号错位即全错;③ **越界防护**:字母索引 `charCode-65 >= 选项数`(如 5 选项给 G)视为识别错误,清空交教师审核,绝不写入明显错误答案。修改 `questions.js` 双文件导入逻辑后,必须 `grep` 确认答案落库前经过 `mapAnswerToOptionText`,并查库确认 `PDF 导入` 题目的 answer 不再是单字母。
31. **文本形式 `sqrt(...)` 必须转成 `\sqrt{...}`**(见 #31):视觉模型/外部导入常把根号写成 `sqrt(21)`。latexify 必须先把**圆括号参数**转成**花括号**,再给函数名加反斜杠;否则 KaTeX 把 `sqrt` 当变量乘积,根号无法显示。**必须**支持嵌套(如 `sqrt(a+sqrt(b))`→`\sqrt{a+\sqrt{b}}`);**必须**排除 `\sqrt` 本身(lookbehind 排除反斜杠)与 `rsqrt` 等变量前缀;新增数学函数时同步更新四份 latexify 与函数名白名单(FUNC_NAMES/FUNC_TOKEN/SM_FUNC)。

## 三、验证用例集(手动/自动化回归样本)

以下字符串经 latexify 后必须全部能由 KaTeX 无错误渲染:

```
3x^2 − 7xy = 5
sin^2 θ + 3cos θ = 3
y = −log₁₀(1 − x) for x < 1
2x^2 − 11x + c = 0
10^(−y)
√(11/2)
2x/(x − 2√3)
(n − 1)/(3n − 1)
log₁₀(2/(a + 2b + 3c))
5650/79.5
(4 − x^2)[(1 + 2x + 3x^2)^4 − (1 + 4x^3)^3]
Σ(n=1..100) aₙ
0 ≤ θ ≤ 4π
±(18sqrt(21))/(49)        → ±\frac{18\sqrt{21}}{49}   (文本 sqrt 须正确渲染为根号)
sqrt(a+sqrt(b))            → \sqrt{a+\sqrt{b}}        (支持嵌套)
```

**#14 回归样本($ 后带空格 / 裸命令,必须正确渲染、不得露出反斜杠):**

```
$ f(x) = x^{\frac{1}{7}}(x^2 - x + 1) $
We are solving $$ (x+1)(3-x) = 2(1 - \cos(\pi x)). $$
原方程：$2\log_{10}(x - y) = \log_{10}(2 - 2x) + \log_{10}(y + 5)$
The function is $y = x^3 - 6x + 3$. Differentiating gives:
Use trapezium rule with 3 strips over $[\frac{1}{2}, 2]$.
选项: 5 | 10 | 15 | 3\pi | 9\pi | 12\pi      (裸 \pi 也须渲染)
$\log_{10}\frac{3}{2}$                       (latexify 不得变 \\log)
```

**#15 回归样本(这些英文词不得渲染成斜体,须保持正文字体):**

```
The circles have the same radius. Two circles intersect at two points.
Thus, the minimum is attainable. Similarly, the region is a square.
x-coordinate, y-coordinate, -coordinate           (连字符开头也不得整词斜体)
```

**#16 回归样本(单位/化学式用正文字体显示,不得红框、不得斜体):**

```
115 kJ mol⁻¹    0.40 mol dm⁻³    4 J g⁻¹ °C⁻¹    20 cm³
AgNO₃(aq)       C₃H₇OH           mol⁻¹            g⁻¹
-150 kJ mol⁻¹   $x^2 + \frac{1}{2}$               (真公式仍须 KaTeX 正常渲染)
```

**#16 延伸回归样本(is/are 与化学式不得斜体;Covalent 不得缺首字母):**

```
Which of the following statements is/are correct?   (is/are 正文,不斜体)
Covalent bonds are broken on melting.               (C 不得丢)
It has strong intermolecular forces.                (I 不得丢)
AgNO₃(aq) + KCl(aq) → AgCl(s) + KNO₃(aq)           (化学式全正文字体)
```

**#18 回归样本(化学式括号不得斜体):**

```
NaCl(aq) + AgNO₃(aq) → AgCl(s) + NaNO₃(aq)          (aq)/(s) 不得斜体
copper(II) sulfate, Fe(III) chloride                (II)/(III) 罗马数字不得斜体
Tin(IV) oxide, sodium chloride(IV)                   (IV) 不得斜体
f(x) = x² + 1                                         (单字母 (x) 仍为数学)
```

**#19 回归样本(句子末尾括号注释不得斜体):**

```
5 mol dm⁻³ magnesium nitrate solution? (Ignore ions produced by dissociation of water.)
20 cm³ of solution (heated to 100 °C)                  (注释整段正文)
Calculate the rate (in mol dm⁻³ s⁻¹) at t = 10s.        (英文短语 (in ... at ...) 注释)
```

**#20 回归样本(化学式裸下标必须清洗为 Unicode 下标,不得显示 _n):**

```
HNO_3 + NaOH → NaNO_3 + H_2O          →  HNO₃ + NaOH → NaNO₃ + H₂O   (清洗为下标)
Cu + 2HNO_3 → CuNO_3 + NO_2 + H_2O   →  Cu + 2HNO₃ → CuNO₃ + NO₂ + H₂O
x_n + 1 = 0                              (数学变量下标不变,仍为数学)
```

**#22 回归样本(行内公式不得比 surrounding text 小,相邻数字大小需协调):**

```
方程 $x^{2} - 5x + 6 = 0 $ 的两个实数根之和是多少?                   (整段公式大小与正文协调)
一个直角三角形的两条直角边分别为 $3 $ 和 4,其面积是多少?            ($3$ 与旁边 4 不得明显一小一大)
Find the value of x where f(x) = 2x gives f(3) = 6.                  (smartMath 自动识别的数学片段大小与正文协调)
```

**#23 回归样本(零散 $ 不得外露、整段英文不得被吞进公式):**

```
$$f(x) - g(x) = 2\sin x$$f(x)g(x) = \cos^2 x$ for all real numbers x . Across all solutions for f(x) , what is the minimum value that f(x) attains for any x$ ?
                                                        (结果:行内公式正常渲染,$ 字符不可见,英文保持正文)
$ f(x) = x^{\frac{1}{7}}(x^2 - x + 1) $                 ($ 后带空格仍正确渲染,且 $ 不可见)
选项: 5 | 10 | 15 | 3\pi | 9\pi | 12\pi                 (裸 \pi 仍须渲染,不露出 $)
```

**#29 回归样本(`cleanOptionPrefix` 输入 → 期望输出,罗马数字选项一字不得少):**

```
"I only"              → "I only"              (不得变 "only")
"I and II only"       → "I and II only"       (不得变 "and II only")
"I and IV only"       → "I and IV only"
"I, II and III"       → "I, II and III"
"II only"             → "II only"
"III only"            → "III only"
"It has a maximum."   → "It has a maximum."   (英文句子开头的 I 也不得吞)
"A. 1/25"             → "1/25"                (真前缀仍须清洗)
"(A) 1/25"            → "1/25"
"A 1/25"              → "1/25"
"Covalent bonds"      → "Covalent bonds"      (#17 样本,回归保留)
```

## 四、运行验证

```bash
# 全题库数学渲染回归(需后端已启动或直接连库)
npm run verify:math --workspace=apps/api
```
