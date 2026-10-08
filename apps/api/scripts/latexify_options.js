// 批量将题库中的"纯数学"选项升级为 $LaTeX$ 公式(KaTeX 渲染)
// 运行:npm run latexify --workspace=apps/api
import "dotenv/config";
import { prisma } from "../src/lib/db.js";

const FUNC_NAMES = new Set(["log", "sin", "cos", "tan", "ln", "sec", "csc", "cot", "exp", "sqrt"]);

function isPureMath(s) {
  if (/[\u4e00-\u9fa5]/.test(s)) return false;
  const words = s.match(/[a-zA-Z]+/g) || [];
  for (const w of words) {
    if (w.length > 1 && !FUNC_NAMES.has(w.toLowerCase())) return false;
  }
  return true;
}

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
    .replace(/×/g, "\\times")
    .replace(/·/g, "\\cdot")
    .replace(/≤/g, "\\le")
    .replace(/≥/g, "\\ge")
    .replace(/≈/g, "\\approx")
    .replace(/≠/g, "\\ne")
    .replace(/Σ/g, "\\sum")
    .replace(/∫/g, "\\int");
}

async function main() {
  const questions = await prisma.question.findMany({ select: { id: true, options: true } });
  let updated = 0;
  let converted = 0;
  for (const q of questions) {
    const options = JSON.parse(q.options);
    let changed = false;
    const next = options.map((o) => {
      const str = String(o);
      if (str.includes("$") || !isPureMath(str)) return o;
      const latex = latexify(str);
      if (latex !== str) {
        changed = true;
        converted++;
        return `$${latex}$`;
      }
      return o;
    });
    if (changed) {
      await prisma.question.update({ where: { id: q.id }, data: { options: JSON.stringify(next) } });
      updated++;
    }
  }
  console.log(`处理题目 ${questions.length} 道:更新 ${updated} 道,选项公式转换 ${converted} 个`);
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
