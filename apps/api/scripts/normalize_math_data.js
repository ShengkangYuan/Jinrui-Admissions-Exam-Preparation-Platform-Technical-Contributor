// 题库数据规范化:把题干/选项中的数学片段统一转成 $...$ 标准 LaTeX 存回数据库
// 参考交互式习题生成器的方法论:数据里直接预写 LaTeX,渲染零推断
// 运行:npm run normalize:math --workspace=apps/api
import "dotenv/config";
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

// ===== 与前端 lib/rich.tsx 同步的 smartMath =====
const OP_TOKEN = /^[+\-*/=<>≤≥≈≠×÷±()−]$/;
const NUM_TOKEN = /^[\-−]?\d+([.,]\d+)?%?$/;
const VAR_TOKEN = /^[a-zA-Z]$/;
const FUNC_TOKEN = /^(log|log₁₀|log₂|log₃|sin|cos|tan|ln|sec|csc|cot|exp|sqrt|sinh|cosh|tanh)$/;
const MATHY_TOKEN = /[√πθΣ∫≤≥≈≠×÷±²³⁴⁵⁶⁷⁸⁹⁰¹^]/;
const MIXED_NUM = /^[0-9√πθ([−\-+][a-zA-Z0-9₁₀₂₃√πθ−^(){}[\]/.,]*$/;
const MIXED_LET = /^[a-zA-Z][a-zA-Z0-9₁₀₂₃√πθ−^(){}[\]/.,]*[0-9₁₀₂₃^√πθ()\[\]/.,−][a-zA-Z0-9₁₀₂₃√πθ−^(){}[\]/.,]*$/;
const PURE_WORD = /^[a-z]{2,}$/;

function isMathToken(t) {
  if (PURE_WORD.test(t) && !FUNC_TOKEN.test(t)) return false;
  if (OP_TOKEN.test(t) || NUM_TOKEN.test(t) || FUNC_TOKEN.test(t)) return true;
  if (VAR_TOKEN.test(t) && !["a", "A", "i", "I"].includes(t)) return true;
  if (MATHY_TOKEN.test(t)) return true;
  if (MIXED_NUM.test(t) || MIXED_LET.test(t)) return true;
  return false;
}

// 把文本规范化:数学片段 → $latex$,文本保留;已 $ 包裹的不动
function normalizeText(text) {
  if (!text) return text;
  // 已存在成对的 $ 公式 → 视为已规范化,跳过
  if (text.includes("$")) {
    const pairs = text.match(/\$[^$\n]+\$/g);
    if (pairs && pairs.length > 0) return text;
  }
  const tokens = text.split(/(\s+)/);
  const out = [];
  let mathBuf = [];
  let textBuf = [];

  const flushMath = () => {
    if (mathBuf.length) {
      // 前后补空格,避免公式与英文粘连($...$of)
      out.push(` $${latexify(mathBuf.join(" "))}$ `);
      mathBuf = [];
    }
  };
  const flushText = () => {
    if (textBuf.length) {
      out.push(textBuf.join(""));
      textBuf = [];
    }
  };

  for (const t of tokens) {
    if (t.trim() === "") {
      (mathBuf.length ? mathBuf : textBuf).push(t);
      continue;
    }
    if (isMathToken(t.trim())) {
      flushText();
      mathBuf.push(t.trim());
    } else {
      flushMath();
      textBuf.push(t);
    }
  }
  flushMath();
  flushText();
  return out.join("").replace(/ {2,}/g, " ");
}

async function main() {
  const questions = await prisma.question.findMany();
  let updated = 0;
  let mathCount = 0;

  for (const q of questions) {
    let changed = false;

    const stem = normalizeText(q.stem || "");
    if (stem !== (q.stem || "")) { changed = true; mathCount += countDollar(stem); }

    let options = q.options;
    let answer = q.answer;
    try {
      const arr = JSON.parse(q.options);
      const next = arr.map((o) => normalizeText(String(o)));
      if (JSON.stringify(next) !== JSON.stringify(arr)) {
        options = JSON.stringify(next);
        changed = true;
        mathCount += next.reduce((n, o) => n + countDollar(o), 0);
        // 同步映射答案:原 answer 在原始选项中的索引 → 取规范化后的选项作为新 answer
        const idx = arr.indexOf(String(q.answer));
        if (idx >= 0 && next[idx] !== String(q.answer)) {
          answer = next[idx];
        } else if (idx < 0) {
          answer = normalizeText(String(q.answer));
        }
      }
    } catch { /* 保持原样 */ }

    if (changed) {
      await prisma.question.update({
        where: { id: q.id },
        data: {
          ...(stem !== (q.stem || "") ? { stem } : {}),
          ...(options !== q.options ? { options } : {}),
          ...(answer !== q.answer ? { answer } : {}),
        },
      });
      updated++;
    }
  }

  console.log(`规范化完成:更新 ${updated} 道题,生成 $公式$ 片段 ${mathCount} 个`);
  await prisma.$disconnect();
}

function countDollar(s) {
  return (s.match(/\$[^$]+\$/g) || []).length;
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
