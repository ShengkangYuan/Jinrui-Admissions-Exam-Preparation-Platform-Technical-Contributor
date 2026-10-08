import React from "react";
import katex from "katex";

// 富文本渲染:
// - ![alt](url)  图片
// - $$...$$      块级公式(KaTeX)
// - $...$        行内公式(KaTeX)
// 其余按文本展示。用于题干与选项。

// 行内公式允许 $ 后紧跟空白(如 "$ f(x) $",常见于模型/录入数据),只要内容非空且不成对 $ 就不算
const TOKEN_RE = /!\[([^\]]*)\]\(([^)]+)\)|\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;

// 智能数学识别里的函数名白名单,也用于判定 $...$ 内是否更像普通英文句子
const FUNC_NAMES = new Set(["log", "sin", "cos", "tan", "ln", "sec", "csc", "cot", "exp", "sqrt", "sinh", "cosh", "tanh"]);

// 去掉 token 尾部零散的 $(PDF/导入常把公式闭合 $ 保留、开头 $ 丢失,如 "x$")
// 单独的 "$" 或纯 "$" 字符串不处理,避免误删货币/占位符。
function stripDollarArtifacts(token: string): string {
  if (/^\$+$/.test(token)) return token;
  return token.replace(/\$+$/g, "");
}

// 判断一段被 $...$ 包裹的内容是否更像普通英文句子而非数学公式。
// 若包含多个普通英文单词(非函数名),很可能是数据源里的零散 $ 被误当定界符。
// 注意:先剔除 LaTeX 命令/环境名(如 \begin {pmatrix} \frac \sqrt),否则会把真公式误判成文本。
function looksLikeTextInDollars(expr: string): boolean {
  // 含明显数学信号(反斜杠命令 / 数字 / 上下标 / 运算符 / 希腊字母 / 括号)的,直接判为数学。
  // 否则会把含微分记号 dx 的积分式(如 "$2\int_0^1 f(x)\,dx + 5\int_1^2 f(x)\,dx = 14$")误判成英文正文,
  // 导致积分以裸 LaTeX 源码显示(#2026-08-22 双源 M2 卷 Q15/Q21 再现此问题)。
  if (/[\\0-9]/.test(expr) || /[=_^+\-*/<>≤≥≈≠×÷πθ()]/.test(expr)) return false;
  // 先把 \command{...}（包括 \text{circumference of } 这种带空格的文本参数）连同其花括号参数一起剥离，
  // 避免真实数学公式里 \text{} 中的英文单词被误判成正文。
  const cleaned = expr
    .replace(/\\[a-zA-Z]+\{[^{}]*\}/g, " ")
    .replace(/\\[a-zA-Z]+/g, " ")
    .replace(/\\[^a-zA-Z]/g, " ") // 去掉 \, \; \! 等"反斜杠+非字母"间距命令,避免残留成英文片段
    .replace(/\{[a-zA-Z]+\}/g, " ")
    .replace(/\bd[a-z]\b/g, " "); // 微分记号 dx/dy/dt 不算英文单词
  const words = (cleaned.match(/\b[a-z]{2,}\b/g) || []).filter((w) => !FUNC_NAMES.has(w));
  return words.length >= 2;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function renderMathExpr(expr: string, displayMode: boolean): string {
  try {
    // 行内公式默认按 textstyle 排版,\frac 的分子分母会被压到 script 尺寸、
    // 分母里的上标更是"script 的 script",整体显得又小又挤(用户反馈"公式看起来很小")。
    // 统一加 \displaystyle:分数/求和等按 display 尺寸渲染,但仍保持行内排版(不独占一行)。
    const tex = displayMode ? expr : `\\displaystyle ${expr}`;
    const html = katex.renderToString(tex, { throwOnError: false, displayMode });
    // KaTeX 渲染失败时返回的 HTML 含 katex-error(红框),此时退回显示原文,避免刺眼报错
    return html.includes("katex-error") ? escapeHtml(expr) : html;
  } catch {
    return escapeHtml(expr);
  }
}

interface Token {
  type: "text" | "img" | "math";
  text?: string;
  alt?: string;
  src?: string;
  expr?: string;
  display?: boolean;
}

function tokenize(text: string): Token[] {
  const tokens: Token[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  TOKEN_RE.lastIndex = 0;
  while ((m = TOKEN_RE.exec(text)) !== null) {
    if (m.index > last) tokens.push({ type: "text", text: text.slice(last, m.index) });
    if (m[1] !== undefined && m[2] !== undefined) {
      tokens.push({ type: "img", alt: m[1], src: m[2] });
    } else if (m[3] !== undefined) {
      tokens.push({ type: "math", expr: m[3], display: true });
    } else {
      // 行内公式:若内容明显是普通英文句子而非数学,退回成文本,交给 smartMath 自动识别真正的数学片段。
      // 这能防止数据里只保留了一个闭合 $ 时,整段正文被吞进一个巨大的 $...$ 公式。
      // 退回时只保留 expr(剥掉外层 $),避免 $ 字符本身被当文本显示。
      const expr = m[4];
      if (looksLikeTextInDollars(expr)) {
        tokens.push({ type: "text", text: expr });
      } else {
        tokens.push({ type: "math", expr, display: false });
      }
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ type: "text", text: text.slice(last) });
  return tokens;
}

// opts.smart=false 时,非公式文本按纯文本输出(不 smartMath)——用于 LLM 生成的解析/长文本,
// 避免英文正文被误判成数学斜体。题干/选项仍走 smartMath(默认)。
export function renderRich(text: string | null | undefined, opts?: { smart?: boolean }): React.ReactNode[] {
  if (!text) return [];
  let key = 0;
  return tokenize(text).map((t) => {
    switch (t.type) {
      case "img":
        return (
          <img
            key={key++}
            src={t.src}
            alt={t.alt || "题目图片"}
            className="mt-2 inline-block max-h-56 max-w-full rounded-lg border border-slate-200 bg-white"
          />
        );
      case "math":
        return (
          <span
            key={key++}
            className={t.display ? "my-2 block overflow-x-auto" : "math-inline"}
            dangerouslySetInnerHTML={{ __html: renderMathExpr(latexify(t.expr!), t.display!) }}
          />
        );
      default:
        // 普通文本:智能识别其中的数学片段并渲染为公式(解析类长文本可用 opts.smart=false 关闭)
        // whiteSpace-pre-wrap 保留 \n 换行 — 否则多个公式挤同一行,序号/标题也挤在一起
        if (opts?.smart === false) return <span key={key++} className="whitespace-pre-wrap">{t.text}</span>;
        return <span key={key++} className="whitespace-pre-wrap">{smartMath(t.text!)}</span>;
    }
  });
}

// 纯文本版本(用于截断展示):去掉图片与公式标记
export function plainText(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(TOKEN_RE, (all, alt, src, block, inline) => {
      if (src) return " [图片] ";
      return "";
    })
    .trim();
}

// 保护 \text{...} 等文本参数块,避免 latexify 把里面的 "m/s"、"km/h" 等当成数学分式转换,
// 导致 KaTeX 在 text 模式下遇到 \frac 而报错,最终回退为裸露源码。
function protectTextBlocks(s: string): { text: string; chunks: string[] } {
  const chunks: string[] = [];
  // 匹配 \text{...}、\mathrm{...}、\operatorname{...} 等文本/算子参数,支持一层嵌套花括号
  const re = /\\(text|mathrm|operatorname|mathsf|mathit|mathbf|mathtt)\{/g;
  let out = "";
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) {
    out += s.slice(last, m.index + m[0].length);
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < s.length && depth > 0) {
      if (s[i] === "{") depth++;
      else if (s[i] === "}") depth--;
      i++;
    }
    // i 现在指向匹配闭合花括号的下一个字符
    const content = s.slice(m.index + m[0].length, i - 1);
    const idx = chunks.push(content) - 1;
    out += `__PROT_${idx}__}`;
    last = i;
    re.lastIndex = last;
  }
  out += s.slice(last);
  return { text: out, chunks };
}

function restoreTextBlocks(s: string, chunks: string[]): string {
  return s.replace(/__PROT_(\d+)__/g, (_, idx) => chunks[parseInt(idx, 10)]);
}

// 将常见非 LaTeX 数学记号转换为 KaTeX 语法(供批量录入使用)
// 注意执行顺序:简单分数(π/4 等)必须在 π→\pi 之前处理,否则 \pi 中的 i 会被误当变量
export function latexify(s: string): string {
  // 把文本形式的 sqrt(...) 转成 LaTeX \sqrt{...}(必须先把圆括号参数转成花括号,否则 KaTeX 不识别)
  // 支持嵌套括号,并排除前面带反斜杠或字母的情况(避免误伤 \sqrt 本身或 rsqrt 等变量名)
  const fixSqrt = (str: string): string => {
    // 从最深层的 sqrt(...) 开始逐层替换,支持嵌套;排除 \sqrt 本身与 rsqrt 等变量前缀
    let prev: string;
    do {
      prev = str;
      str = str.replace(/(?<![a-zA-Z\\])sqrt\(([^()]+)\)/g, "\\sqrt{$1}");
    } while (str !== prev);
    return str;
  };

  const { text: protectedText, chunks } = protectTextBlocks(s);
  const out = fixSqrt(protectedText)
    .replace(/√\(([^)]+)\)/g, "\\sqrt{$1}")
    .replace(/√([0-9a-zA-Z])/g, "\\sqrt{$1}")
    .replace(/log₁₀/g, "\\log_{10}")
    .replace(/log₂/g, "\\log_2")
    .replace(/log₃/g, "\\log_3")
    // 希腊字母/导数符号:后面紧跟字母时必须加空格,否则 \pix/\thetax/\primex 会被 KaTeX 当成未定义命令
    .replace(/π(?=[a-zA-Z])/g, "\\pi ")
    .replace(/π(?![a-zA-Z])/g, "\\pi")
    .replace(/θ(?=[a-zA-Z])/g, "\\theta ")
    .replace(/θ(?![a-zA-Z])/g, "\\theta")
    // 字面撇号(导数符号)→\prime:KaTeX 不识别 U+2032,会报 unknownSymbol 并渲染成 <mtext>′</mtext>
    // ( stray 字形,在中文环境下像乱码)。转为 \prime 后才是正确的数学撇号。(#2026-09-08 M2 模考23 Q27)
    .replace(/′(?=[a-zA-Z])/g, "\\prime ")
    .replace(/′(?![a-zA-Z])/g, "\\prime")
    .replace(/″(?=[a-zA-Z])/g, "\\prime\\prime ")
    .replace(/″(?![a-zA-Z])/g, "\\prime\\prime")
    .replace(/‴(?=[a-zA-Z])/g, "\\prime\\prime\\prime ")
    .replace(/‴(?![a-zA-Z])/g, "\\prime\\prime\\prime")
    .replace(/²/g, "^{2}")
    .replace(/³/g, "^{3}")
    .replace(/⁴/g, "^{4}")
    .replace(/⁵/g, "^{5}")
    .replace(/⁶/g, "^{6}")
    .replace(/⁷/g, "^{7}")
    .replace(/⁸/g, "^{8}")
    .replace(/⁹/g, "^{9}")
    .replace(/⁰/g, "^{0}")
    .replace(/¹/g, "^{1}")
    .replace(/\^\(([^)]*)\)/g, "^{$1}")
    .replace(/\^([0-9a-zA-Z])/g, "^{$1}")
    // 合并被拆分的上标数字(如 sin^{1}^{0} → sin^{10},(1/2)^{1}00 → (1/2)^{100})
    .replace(/\^\{(\d)\}\^\{(\d)\}/g, "^{$1$2}")
    .replace(/\^\{(\d)\}(\d{2,})/g, "^{$1$2}")
    .replace(/×/g, "\\times")
    .replace(/·/g, "\\cdot ")
    .replace(/≤/g, "\\le")
    .replace(/≥/g, "\\ge")
    .replace(/≈/g, "\\approx")
    .replace(/≠/g, "\\ne")
    .replace(/Σ(?=[a-zA-Z])/g, "\\sum ")
    .replace(/Σ(?![a-zA-Z])/g, "\\sum")
    .replace(/∫(?=[a-zA-Z])/g, "\\int ")
    .replace(/∫(?![a-zA-Z])/g, "\\int")
    // 连续 Unicode 上标/下标 → 单个 LaTeX 上标/下标
    // 关键:先整体合并,避免 ⁻¹ 被后续单字符转换拆成 ⁻^{1}(Double superscript 报错)
    .replace(/([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (m) =>
      "^{" + m.split("").map((c) => ({ "⁻": "-", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" })[c] || c).join("") + "}"
    )
    .replace(/([₀₁₂₃₄₅₆₇₈₉]+)/g, (m) =>
      "_{" + m.split("").map((c) => ({ "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" })[c] || c).join("") + "}"
    )
    // 函数名 → LaTeX 命令(如 sin → \sin、3cos → 3\cos;前面不能是字母或已有反斜杠,避免 \log 变成 \\log)
    .replace(/(?<![a-zA-Z\\])(log|sin|cos|tan|ln|sec|csc|cot|exp|sqrt|sinh|cosh|tanh)(?=[^a-zA-Z₁₀₂₃]|$)/g, "\\$1")
    // ===== 简单/括号分数转换已禁用 =====
    // 原转换会误伤真公式:如 `$d_2/m_1$` 里的 `d_2`/`m_1` 是单字母+数字下标,
    // 但正则 A 部分 `[a-zA-Z]` 只看单字符,把 `d_2` 错认成 `d`,把 `d_2/m_1` 转成 `\frac{d}{m_1}`,
    // KaTeX 渲染时下标 2 丢失→乱码(`d_{2}{m}_1`)。同理 23/05/1967 被吃成 `\frac{23}{05}1967`。
    // 真分数请源里直接写 `\frac{}{}`;本函数不再做 `A/B → \frac{A}{B}` 自动转换。
    // ===== 括号的分数转化 `_space.bracket` B 为空时还原表达式 (保留原表达式不做 / 转 \frac) =====
  return restoreTextBlocks(out, chunks);
}

// ===== 智能数学识别:将文本中的数学片段自动渲染为公式 =====

// 运算符 / 数字 / 单字母变量 / 函数名
// 注意:字符类中的连字符需用 \- 转义或放末尾,避免被解析为范围
const OP_TOKEN = /^[+\-*/=<>≤≥≈≠×÷±()−]$/;
const NUM_TOKEN = /^[\-−]?\d+([.,]\d+)?%?$/;
const VAR_TOKEN = /^[a-zA-Z]$/;
const FUNC_TOKEN = /^(log|log₁₀|log₂|log₃|sin|cos|tan|ln|sec|csc|cot|exp|sqrt|sinh|cosh|tanh)$/;
// 含数学符号的 token(Unicode 上下标 ⁻¹²³ 等排除:它们是单位/化学式文本,如 mol⁻¹、cm³,不应按数学渲染)
const MATHY_TOKEN = /[√πθΣ∫≤≥≈≠×÷±^]/;
// 纯小写英文单词(长度≥2 且非函数名) → 文本(避免 sum/Given/it 等英文单词误判;单字母 x/y 由 VAR 处理)
const PURE_WORD = /^[a-z]{2,}$/;
// 数字/数学符号开头的紧凑表达式(如 3x^2、10^(-y)、2π、5650/79.5、−log₁₀(1)
// 开头类不含 ASCII 连字符/加号/方括号:它们多是英文标点("-coordinate"),负号由 OP_TOKEN 单独处理,避免整个英文词被误判斜体(#15)
// 内部 Unicode 上下标排除:`AgNO₃` 等化学式/单位含 ₀₁₂₃ 不应被判数学(单位/化学式按正文字体显示)
const MIXED_NUM = /^[0-9√πθ(−][a-zA-Z0-9√πθ−^(){}[\]/.,]*$/;
// 字母开头,内部必须含数学特征(数字/^/()/减号等)(如 x^2、x、(c+1)²、)
// 注意:句号/逗号(英文标点)不是数学特征,否则 "radius."、"Thus," 会被误判为数学渲染成斜体(#15)
// Unicode 上下标 ₀₁₂₃⁰¹²³ 也不是数学特征(`AgNO₃` 应作文本)
const MIXED_LET = /^[a-zA-Z][a-zA-Z0-9√πθ−^(){}[\]/.,]*[0-9^√πθ()\[\]/−][a-zA-Z0-9√πθ−^(){}[\]/.,]*$/;
function isMixedMath(token: string): boolean {
  return MIXED_NUM.test(token) || MIXED_LET.test(token);
}

// 含 Unicode 上下标的 token 一律当文本:化学式(AgNO₃)、单位(mol⁻¹、cm³)等
// 不应进入 KaTeX 数学模式(否则字母变斜体、显示为数学字体)。见 #16。
const HAS_UNI_SUP_SUB = /[⁰¹²³⁴⁵⁶⁷⁸⁹⁻₀₁₂₃₄₅₆₇₈⁹]/;

export function isMathToken(token: string): boolean {
  // 去除 token 尾部零散的 $,让 "x$" 能按变量 x 进入数学模式,避免把 $ 字符显示出来。
  const t = stripDollarArtifacts(token);
  if (t === "") return false; // 原 token 只是零散 $,按普通文本处理
  token = t;
  if (HAS_UNI_SUP_SUB.test(token)) return false;
  // 纯小写英文用 / 连接的组合(如 is/are、and/or、either/or)→ 一律文本
  if (/^[a-z]+(\/[a-z]+)+$/.test(token)) return false;
  // 括号内全小写≥2字母(化学状态如 (aq)/(gas)) 或纯罗马数字((II)/(III)/(IV))→ 文本
  // 见 #18(NaCl(aq)、copper(II) 等化学式中括号被当 OP 带进数学模式)
  if (/^\(([a-z]{2,}|[IVX]+)\)$/i.test(token)) return false;
  // 小写/英文开头的 token 末尾带 ) (如 "water.)"、"sentence.)") → 文本
  // 这是句子末尾括号注释被 smartMath 切碎后误判的常见模式(#19);含数学特征 ) 但前面是普通英文
  if (/^[a-zA-Z][a-zA-Z.,;:'\-]*\)$/.test(token)) return false;
  // 裸 LaTeX 命令(如 \log、\sin、\frac、\sqrt,没有 $ 包裹)也必须按数学渲染,否则会露出反斜杠
  if (/\\[a-zA-Z]+/.test(token)) return true;
  // 纯小写英文单词(非函数名)直接判文本;单字母变量由 VAR 处理
  if (PURE_WORD.test(token) && !FUNC_TOKEN.test(token)) return false;
  if (FUNC_TOKEN.test(token)) return true;
  // 裸数字/裸运算符不再自动判为数学,避免 "by 3 units" / "factor of 4" 里的普通数字被 KaTeX 渲染后基线偏移
  // 这些 token 会在 smartMath 里二次判断:若与真正数学片段相邻则被吸收进数学模式
  // (OP_TOKEN 与 NUM_TOKEN 保留为下方 smartMath 的"连接器"使用)
  if (OP_TOKEN.test(token) || NUM_TOKEN.test(token)) return false;
  // 单字母变量(a/A/i/I 是英文冠词/代词,不当作数学)
  if (VAR_TOKEN.test(token) && !["a", "A", "i", "I"].includes(token)) return true;
  if (MATHY_TOKEN.test(token)) return true;
  if (isMixedMath(token)) return true;
  return false;
}

// 将文本按"数学片段 / 纯文本片段"切分,数学片段用 KaTeX 渲染
// 关键:每次 flushMath 后追加一个 " " 文本节点,避免 KaTeX 吞掉尾部空格导致与后续文本挤在一起(0differ)
export function smartMath(text: string): React.ReactNode[] {
  // 前置清洗:文本片段首尾出现的零散 $ (开头 "$ " 或结尾 " $")
  // 是 PDF/导入残留,去掉后 smartMath 才能正确识别真正的数学片段。
  text = text.replace(/^\$\s+/, "").replace(/\s+\$$/, "");
  const parts: React.ReactNode[] = [];
  const tokens = text.split(/(\s+)/);
  let mathBuf: string[] = [];
  let textBuf: string[] = [];
  let key = 0;

  const flushMath = () => {
    if (mathBuf.length) {
      // smartMath 自动检测的数学片段里不应再残留 $;残留的 $ 多为数据格式错误,
      // 保留会导致 KaTeX "$ 不能在数学模式中使用" 或直接把 $ 字符显示出来。
      const expr = latexify(mathBuf.join(" ").replace(/\$+/g, ""));
      parts.push(
        <span key={key++} className="math-inline" dangerouslySetInnerHTML={{ __html: renderMathExpr(expr, false) }} />
      );
      // KaTeX 数学模式忽略尾部空格,显式补一个视觉间隔
      parts.push(<span key={key++}> </span>);
      mathBuf = [];
    }
  };
  const flushText = () => {
    if (textBuf.length) {
      // inline 元素(<span>)里 \n 即便 white-space:pre-wrap 也不强制换行
      // (CSS 行模型限制,pre-wrap 只能在 block 元素上保留换行)。把 \n 拆出来
      // 替换为 <br> 才能可靠换行,避免题干里 I./II./III. 陈述列表挤成一行。
      const raw = textBuf.join("");
      const segs: React.ReactNode[] = [];
      raw.split(/(\n)/).forEach((seg) => {
        if (seg === "") return;
        if (seg === "\n") segs.push(<br key={`br-${key++}`} />);
        else segs.push(seg);
      });
      parts.push(<span key={key++} className="whitespace-pre-wrap">{segs}</span>);
      textBuf = [];
    }
  };

  // 第一轮:先给每个 token 打标签
  // math = 本身含数学特征(变量/函数/混合表达式/数学符号/LaTeX 命令)
  // bare = 裸数字/裸运算符,只在与 math 相邻时才被提升为数学
  // promoted = 被提升为数学的裸数字/裸运算符
  // text = 普通正文
  type Cls = "space" | "math" | "bare" | "promoted" | "text";
  const cls: Cls[] = tokens.map((t) => {
    if (t.trim() === "") return "space";
    if (isMathToken(t.trim())) return "math";
    if (NUM_TOKEN.test(t.trim()) || OP_TOKEN.test(t.trim())) return "bare";
    return "text";
  });

  const prevNonSpace = (i: number): number => {
    for (let j = i - 1; j >= 0; j--) if (cls[j] !== "space") return j;
    return -1;
  };
  const nextNonSpace = (i: number): number => {
    for (let j = i + 1; j < tokens.length; j++) if (cls[j] !== "space") return j;
    return -1;
  };

  // 第二轮:把与 math 相邻(直接或通过其它 bare 串联)的 bare token 提升为 promoted
  // 这样 "x = 3" 整段进入数学模式,但 "by 3 units" / "factor of 4" 里的数字保持正文
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < tokens.length; i++) {
      if (cls[i] !== "bare") continue;
      const pi = prevNonSpace(i);
      const ni = nextNonSpace(i);
      const leftIsMath = pi >= 0 && (cls[pi] === "math" || cls[pi] === "promoted");
      const rightIsMath = ni >= 0 && (cls[ni] === "math" || cls[ni] === "promoted");
      if (leftIsMath || rightIsMath) {
        cls[i] = "promoted";
        changed = true;
      }
    }
  }

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const kind = cls[i];
    if (kind === "space") {
      // 含换行符的 space token 必须进 textBuf(flushText 会把它转成 <br>),
      // 不能被吸入 mathBuf——否则 \n 在 LaTeX join(" ") 后变成空格,
      // KaTeX 渲染时丢失,导致 I./II./III. 等陈述列表挤成一行。
      if (t.includes("\n")) {
        flushMath();
        textBuf.push(t);
      } else {
        (mathBuf.length ? mathBuf : textBuf).push(t);
      }
      continue;
    }
    if (kind === "math" || kind === "promoted") {
      flushText();
      mathBuf.push(t);
    } else {
      flushMath();
      textBuf.push(t);
    }
  }
  flushMath();
  flushText();
  return parts;
}

// 判断是否为"纯数学"文本(适合整体用 $ 包裹渲染)
export function isPureMath(s: string): boolean {
  if (/[\u4e00-\u9fa5]/.test(s)) return false;
  const words = s.match(/[a-zA-Z]+/g) || [];
  for (const w of words) {
    if (w.length > 1 && !FUNC_NAMES.has(w.toLowerCase())) return false;
  }
  return true;
}
