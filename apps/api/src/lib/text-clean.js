// 共享文本清洗:把五花八门的原始题目文本,统一成 docs/QUESTION_FORMAT.md 的规范格式。
// 原先只在 scripts/adapters 下被离线脚本使用,现下沉到 src/lib,让 API 运行时(一键修正)也能复用同一套规则,
// 避免「脚本清洗过的题」和「接口修正过的题」出现两套标准。
// scripts/adapters/{latexify,sanitize}.js 现为本文件的再导出壳,历史脚本无需改动。

// 把常见非 LaTeX 数学记号转成 KaTeX 语法。
// 顺序敏感:简单分数必须在 π→\pi 之前处理,否则 \pi 的 i 会被误当变量。
export function latexify(s) {
  // 把文本形式的 sqrt(...) 转成 LaTeX \sqrt{...}(先转圆括号为花括号,避免 KaTeX 不识别)
  // 支持嵌套,并排除前面带反斜杠或字母的情况(避免误伤 \sqrt 本身或 rsqrt 等变量)
  const fixSqrt = (str) => {
    // 从最深层的 sqrt(...) 开始逐层替换,支持嵌套;排除 \sqrt 本身与 rsqrt 等变量前缀
    let prev;
    do {
      prev = str;
      str = str.replace(/(?<![a-zA-Z\\])sqrt\(([^()]+)\)/g, "\\sqrt{$1}");
    } while (str !== prev);
    return str;
  };

  return fixSqrt(s)
    .replace(/√\(([^)]+)\)/g, "\\sqrt{$1}")
    .replace(/√([0-9a-zA-Z])/g, "\\sqrt{$1}")
    .replace(/log₁₀/g, "\\log_{10}")
    .replace(/log₂/g, "\\log_2")
    .replace(/log₃/g, "\\log_3")
    .replace(/π/g, "\\pi")
    .replace(/θ/g, "\\theta")
    // 连续 Unicode 上标/下标 → 单个 LaTeX 上标/下标(先整体合并,避免 ⁻¹ 拆成 ⁻^{1})
    .replace(/([⁻⁰¹²³⁴⁵⁶⁷⁸⁹]+)/g, (m) =>
      "^{" + m.split("").map((c) => ({ "⁻": "-", "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4", "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9" })[c] || c).join("") + "}"
    )
    .replace(/([₀₁₂₃₄₅₆₇₈₉]+)/g, (m) =>
      "_{" + m.split("").map((c) => ({ "₀": "0", "₁": "1", "₂": "2", "₃": "3", "₄": "4", "₅": "5", "₆": "6", "₇": "7", "₈": "8", "₉": "9" })[c] || c).join("") + "}"
    )
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
    .replace(/\^\{(\d)\}\^\{(\d)\}/g, "^{$1$2}")
    .replace(/\^\{(\d)\}(\d{2,})/g, "^{$1$2}")
    .replace(/×/g, "\\times")
    .replace(/·/g, "\\cdot ")
    .replace(/≤/g, "\\le")
    .replace(/≥/g, "\\ge")
    .replace(/≈/g, "\\approx")
    .replace(/≠/g, "\\ne")
    .replace(/Σ/g, "\\sum")
    .replace(/∫/g, "\\int")
    .replace(/(?<![a-zA-Z\\])(log|sin|cos|tan|ln|sec|csc|cot|exp|sqrt|sinh|cosh|tanh)(?=[^a-zA-Z₁₀₂₃]|$)/g, "\\$1");
}

// 行内公式首尾空格规范化:$ x $ → $x$(块级 $$...$$ 原样保留)。
// 视觉模型/录入常写成 "$ f(x) $"($ 后带空格),旧版渲染正则要求 $ 后非空白会误判成纯文本,导致 \log 等裸命令露出反斜杠。
// 渲染层(rich.tsx)已兼容,这里再把数据规范化,双保险。
export function normalizeInlineFormula(s) {
  if (!s) return s;
  return String(s).replace(/\$\$[\s\S]+?\$\$|\$([^$\n]+?)\$/g, (all, inner) => {
    if (inner === undefined) return all; // 块级公式,原样保留
    const t = inner.trim();
    return t ? `$${t}$` : "$";
  });
}

// 换行归一化:统一换行符、去行尾空白、合并 >=3 连续换行为 2、去首尾换行与空白。
// 用于录入/导入/一键修正的边界,保证存库的题干/选项/解析换行一致(作者每行=一行,只清理多余空白)。
export function normalizeNewlines(s) {
  if (!s) return s;
  return normalizeInlineFormula(
    splitRomanNumeralItems(s)
      .replace(/\r\n?/g, "\n")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/^\n+|\n+$/g, "")
      .trim()
  );
}

// 罗马数字序号(I II III IV V ...)列表拆行:#25b/#28 反复出现的问题——
// 视觉模型常把 "I $a$ II $b$ III $c$" 挤在同一行。这里把紧跟公式的罗马数字序号
// 识别为「列表项」并在序号前强制换行(每项独立一行),避免整段挤成一团。
// 匹配:公式闭合符 $ 之后 空格 + 罗马序号 + 空格 + 公式开 $ (即 "…$ II $…" 模式);
//     或换行/行首之后已独立成项则不重复处理。
// 仅在文本已含 "$…$" 公式且出现 ≥2 个罗马序号项时才拆,降低误伤(如 "I" 作单词/变量)。
export function splitRomanNumeralItems(s) {
  if (!s) return s;
  const hasFormula = /\$[^$\n]+\$/.test(s);
  if (!hasFormula) return s;
  // 统计罗马序号项:I/II/III/IV/V/VI/VII/VIII/IX/X 后紧跟公式开 $
  const itemRe = /(I{1,3}|IV|V|VI{1,3}|IX|X)\s*(\$)/g;
  const items = s.match(itemRe);
  if (!items || items.length < 2) return s;
  // 把"公式闭合$ + 空格 + 罗马序号"模式前的空白改成换行:
  // "…$ II $…" → "…$\nII $…" (序号前是公式结束 $ 时)
  return s.replace(/(\$)\s+(I{1,3}|IV|V|VI{1,3}|IX|X)(?=\s*\$)/g, "$1\n$2");
}

// 把一份可能含 HTML 与 \( \) 的文本,转成规范富文本(含 $...$ 公式)
// 关键点:
//  - 数学:`\(...\)` → `$...$`,`\[...\]` → `$$...$$`,并用 latexify 把 √/π/²/≤ 等转成 LaTeX
//  - HTML:白名单剥离,已知标签先转成可读文本,其余标签整体删除
//  - 不等式 < > 当作文本保留,绝不用全局 <[^>]+> 直接删除(那会误删数学符号)
export function toCanonicalText(raw = "") {
  if (!raw) return "";
  let s = String(raw);

  // 1) 白名单处理已知标签(先转成可读文本,避免被后续整体剥离误伤或丢失内容)
  s = s
    .replace(/<b>/gi, "**").replace(/<\/b>/gi, "**")
    .replace(/<strong>/gi, "**").replace(/<\/strong>/gi, "**")
    .replace(/<i>/gi, "*").replace(/<\/i>/gi, "*")
    .replace(/<em>/gi, "*").replace(/<\/em>/gi, "*")
    .replace(/<sub>/gi, "_{").replace(/<\/sub>/gi, "}")
    .replace(/<sup>/gi, "^{").replace(/<\/sup>/gi, "}")
    // 表格 → 可读文本(行间换行、单元格用 | 分隔,避免内容粘连)
    .replace(/<tr\s*\/?>/gi, "\n").replace(/<\/tr>/gi, "")
    .replace(/<t[hd]\s*\/?>/gi, " | ").replace(/<\/t[hd]>/gi, "")
    .replace(/<ul\s*\/?>/gi, "\n").replace(/<ol\s*\/?>/gi, "\n")
    .replace(/<\/ul>/gi, "").replace(/<\/ol>/gi, "")
    .replace(/<li\s*\/?>/gi, "\n- ").replace(/<\/li>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n").replace(/<p>/gi, "")
    .replace(/<\/div>/gi, "\n").replace(/<div>/gi, "")
    .replace(/<span[^>]*>/gi, "").replace(/<\/span>/gi, "");

  // 2) 删除其余所有 HTML 标签(此时 < > 仅剩真正的不等式等文本符号)
  s = s.replace(/<[^>]+>/g, "");

  // 3) 换行规范化(统一换行符、去行尾空白、合并多余空行)
  s = normalizeNewlines(s);

  // 4) 数学定界符归一化
  s = s
    .replace(/\\\[/g, "$$")
    .replace(/\\\]/g, "$$")
    .replace(/\\\(/g, "$")
    .replace(/\\\)/g, "$");

  // 5) LaTeX 化(√/π/²/≤ 等)
  s = latexify(s);

  // 6) 行内公式首尾空格规范化($ x $ → $x$)
  s = normalizeInlineFormula(s);

  return s;
}

// 适配一个原始题目对象 → 规范题目对象
// raw: { topic, stem, options:[{letter,text}|string], answer(letter|text), explanation|solution, ... }
// 返回: { topic, stem, options:string[], answer:string, solution:string }
export function toCanonical(raw, { answerByLetter = false } = {}) {
  const stem = toCanonicalText(raw.stem);
  let options = Array.isArray(raw.options)
    ? raw.options.map((o) => (typeof o === "string" ? toCanonicalText(o) : toCanonicalText(o.text ?? o)))
    : [];
  options = options.filter((o) => o && o.trim());

  let answer = raw.answer;
  if (answerByLetter && /^[A-Za-z]$/.test(String(answer))) {
    const idx = answer.toUpperCase().charCodeAt(0) - 65;
    answer = options[idx] ?? answer;
  }
  answer = typeof answer === "string" ? answer.trim() : answer;

  const solution = toCanonicalText(raw.explanation ?? raw.solution ?? "");

  return { topic: raw.topic, stem, options, answer, solution };
}
