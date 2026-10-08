// 全题库数学公式渲染回归验证
// 运行:npm run verify:math --workspace=apps/api
// 检测:① KaTeX 渲染错误(ERR,必须修) ② latexify 后残留未转换符号(WARN,提示)
// 注意:本文件的 latexify 必须与 apps/web/lib/rich.tsx 保持一致(同步修改)
import "dotenv/config";
import katex from "katex";
import { prisma } from "../src/lib/db.js";

// ===== 与前端 lib/rich.tsx 同步的 latexify =====
function latexify(s) {
  // 把文本形式的 sqrt(...) 转成 LaTeX \sqrt{...}(支持嵌套,排除 \sqrt 本身与 rsqrt 等变量前缀)
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
    .replace(/(?<![a-zA-Z\\])(log|sin|cos|tan|ln|sec|csc|cot|exp|sqrt|sinh|cosh|tanh)(?=[^a-zA-Z₁₀₂₃]|$)/g, "\\$1")
    .replace(/([0-9]*(?:\\pi|\\theta|π|θ)?|[a-zA-Z])(?![a-zA-Z])\s*\/\s*([0-9]+(?:\\pi|\\theta|π|θ)?|[a-zA-Z])(?![a-zA-Z0-9])/g, "\\frac{$1}{$2}")
    .replace(/\(([^()]+)\)\s*\/\s*([0-9]+(?:\\pi|\\theta|π|θ)?)(?![a-zA-Z0-9])/g, "\\frac{$1}{$2}")
    .replace(/(?<![\^{])([A-Za-z0-9][^()]*?)\s*\/\s*\(([^()]+)\)/g, "\\frac{$1}{$2}")
    .replace(/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g, "\\frac{$1}{$2}");
}

// 纯数学文本判定(与前端 isPureMath 一致)
const FUNC_NAMES = new Set(["log", "sin", "cos", "tan", "ln", "sec", "csc", "cot", "exp", "sqrt"]);
function isPureMath(s) {
  if (/[\u4e00-\u9fa5]/.test(s)) return false;
  const words = s.match(/[a-zA-Z]+/g) || [];
  for (const w of words) {
    if (w.length > 1 && !FUNC_NAMES.has(w.toLowerCase())) return false;
  }
  return true;
}

function isMathish(text) {
  return /[√πθΣ∫≤≥≈≠×÷±²³⁴⁵⁶⁷⁸⁹⁰¹^₁₀₂₃]/.test(text);
}

// 提取 $ 包裹的数学内容;无 $ 标记返回 null
// 允许 $ 后带空格("$ x $"),与前端 rich.tsx 保持一致
function extractDollarMath(text) {
  const parts = [];
  const re = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    parts.push(m[1] !== undefined ? m[1] : m[2]);
  }
  return parts.length ? parts : null;
}

function findLeftover(latex) {
  const issues = [];
  if (/(?<![\\])√/.test(latex)) issues.push("裸√未转\\sqrt");
  if (/[0-9a-zA-Z)]\s*\/\s*[(0-9a-zA-Z]/.test(latex.replace(/\\frac/g, ""))) issues.push("可能未转\\frac的/");
  if (/(?<![\\])[0-9a-zA-Z]\^(?!\{)/.test(latex)) issues.push("裸^未转上标");
  return issues;
}

// 公式($...$ 外)的裸反斜杠命令,如 \log、\sin、\frac、3\pi
function bareLatexCmds(text) {
  const stripped = String(text || "").replace(/\$\$[\s\S]+?\$\$|\$[^$]+?\$/g, "");
  return [...new Set((stripped.match(/\\[a-zA-Z]+/g) || []))];
}

// ===== 复刻前端 smartMath 的数学判定(必须与 apps/web/lib/rich.tsx 同步) =====
const SM_MIXED_NUM = /^[0-9√πθ(−][a-zA-Z0-9₁₀₂₃√πθ−^(){}[\]/.,]*$/;
const SM_MIXED_LET = /^[a-zA-Z][a-zA-Z0-9₁₀₂₃√πθ−^(){}[\]/.,]*[0-9₁₀₂₃^√πθ()\[\]/−][a-zA-Z0-9₁₀₂₃√πθ−^(){}[\]/.,]*$/;
const SM_FUNC = new Set(["log", "log₁₀", "log₂", "log₃", "sin", "cos", "tan", "ln", "sec", "csc", "cot", "exp", "sqrt", "sinh", "cosh", "tanh"]);
function smIsMath(t) {
  if (/\\[a-zA-Z]+/.test(t)) return true;
  if (/^[a-z]{2,}$/.test(t) && !SM_FUNC.has(t)) return false;
  if (/^[+\-*/=<>≤≥≈≠×÷±()−]$/.test(t) || /^[\-−]?\d+([.,]\d+)?%?$/.test(t) || SM_FUNC.has(t)) return true;
  if (/^[a-zA-Z]$/.test(t) && !["a", "A", "i", "I"].includes(t)) return true;
  if (/[√πθΣ∫≤≥≈≠×÷±²³⁴⁵⁶⁷⁸⁹⁰¹^]/.test(t)) return true;
  if (SM_MIXED_NUM.test(t) || SM_MIXED_LET.test(t)) return true;
  return false;
}
// 英文单词带句号/逗号、或连字符开头 → 被误判为数学的 token(=会渲染成斜体,见 #15)
function falseItalicTokens(text) {
  const stripped = String(text || "").replace(/\$\$[\s\S]+?\$\$|\$[^$]+?\$/g, "");
  const out = [];
  for (const t of String(stripped).split(/\s+/)) {
    const t2 = t.trim();
    if (!t2) continue;
    if (smIsMath(t2) && (/^[a-zA-Z]{2,}[.,:;]/.test(t2) || /^-[a-zA-Z]{2,}/.test(t2))) out.push(t2);
  }
  return [...new Set(out)];
}

async function main() {
  const questions = await prisma.question.findMany();
  let errCount = 0;
  let warnCount = 0;
  let checked = 0;

  for (const q of questions) {
    let options;
    try { options = JSON.parse(q.options || "[]"); } catch { options = []; }
    const fields = [["题干", q.stem || ""], ...options.map((o, i) => [`选项 ${String.fromCharCode(65 + i)}`, String(o)])];

    for (const [label, text] of fields) {
      const dollarMath = extractDollarMath(text);
      // 候选验证片段:$ 包裹的数学 + (非 $ 时)整段纯数学文本;英文题干只验 $ 片段
      const candidates = dollarMath !== null
        ? dollarMath
        : (isMathish(text) && isPureMath(text) ? [text] : []);
      for (const expr of candidates) {
        checked++;
        const latex = latexify(expr);
        let renderErr = null;
        try {
          katex.renderToString(latex, { throwOnError: true });
        } catch (e) {
          renderErr = String(e.message || e).split("\n")[0];
        }
        const leftover = findLeftover(latex);
        if (renderErr) {
          errCount++;
          console.log(`\n[ERR][${q.source || "未知来源"}] ${label} (题目 ${q.id.slice(0, 8)})`);
          console.log(`  原文: ${text.slice(0, 110)}`);
          console.log(`  KaTeX 错误: ${renderErr}`);
          console.log(`  latexify: ${latex.slice(0, 130)}`);
        } else if (leftover.length) {
          warnCount++;
          console.log(`[WARN][${q.source || "未知来源"}] ${label} (题目 ${q.id.slice(0, 8)})`);
          console.log(`  原文: ${text.slice(0, 90)}`);
          console.log(`  残留: ${leftover.join("; ")}`);
          console.log(`  latexify: ${latex.slice(0, 110)}`);
        }
      }
      // 公式外裸 LaTeX 命令扫描(核心审查项,如 \log 未用 $ 包裹)
      const bare = bareLatexCmds(text);
      if (bare.length) {
        warnCount++;
        console.log(`[WARN][${q.source || "未知来源"}] ${label} (题目 ${q.id.slice(0, 8)})`);
        console.log(`  原文: ${text.slice(0, 90)}`);
        console.log(`  公式外裸命令: ${bare.join(", ")} — 建议用 $...$ 包裹(渲染层已兜底)`);
      }
      // 英文单词被误判为数学(会渲染成斜体,见 #15)
      const falseItalic = falseItalicTokens(text);
      if (falseItalic.length) {
        warnCount++;
        console.log(`[WARN][${q.source || "未知来源"}] ${label} (题目 ${q.id.slice(0, 8)})`);
        console.log(`  原文: ${text.slice(0, 90)}`);
        console.log(`  疑似被误判为数学的英文: ${falseItalic.join(", ")} — 会渲染成斜体,应修复数据或渲染规则`);
      }
    }
  }

  console.log(`\n========== 扫描完成 ==========`);
  console.log(`题库 ${questions.length} 题,验证数学片段 ${checked} 个:ERR ${errCount} 处, WARN ${warnCount} 处`);
  await prisma.$disconnect();
  process.exit(errCount > 0 ? 1 : 0);
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
