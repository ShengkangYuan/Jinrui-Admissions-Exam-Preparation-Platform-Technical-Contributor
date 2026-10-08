// 题目渲染校验闸门(verify gate)
// 用法:
//   node scripts/verify_questions.js                 # 校验全库(DB)
//   node scripts/verify_questions.js data/foo.js     # 校验某个数据文件(导出 default 的 Question[])
//   node scripts/verify_questions.js data/foo.json   # 校验 JSON 数组
// 任一题存在「阻断级」问题(缺字段/选项非法/公式无法渲染/裸标签泄漏)→ 退出码 1,并打印题号+字段报告。
// 设计目标:把"上线后学生撞见乱码"变成"入库前当场拦截"。
import "dotenv/config";
import katex from "katex";
import { pathToFileURL } from "url";
import path from "path";
import { fileURLToPath } from "url";
import { prisma } from "../src/lib/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 应被清洗掉、却仍残留的结构性/格式标签(不等式 < > 不会命中,因为 b/i 被排除)
// 与 src/lib/autofix.js 的 TAG_RE 保持同一份白名单(一键修正与离线校验必须同标准)
const TAG_RE =
  /<\/?(?:p|div|br|hr|span|table|tbody|thead|tfoot|caption|col|colgroup|tr|td|th|ul|ol|li|dl|dt|dd|font|small|big|h[1-6]|strong|em|b|i|u|s|a|img|code|pre|blockquote|center|nobr|section|article|header|footer|sub|sup)\b[^<>]*>/gi;
const MATH_RE = /\$\$([\s\S]+?)\$\$|\$([^\s$][^$]*?)\$/g;
const TEX_CMD_RE = /\\[\(\[\)\]]/g; // 残留的 \( \) \[ \]

function checkField(name, text, issues) {
  if (text == null || text === "") return;
  const t = String(text);
  if (TEX_CMD_RE.test(t)) issues.push(`${name}: 残留 LaTeX 定界符 \\( \\) \\[ \\]`);
  const dollars = (t.match(/\$/g) || []).length;
  if (dollars % 2 !== 0) issues.push(`${name}: $ 公式定界符不成对(共 ${dollars} 个)`);
  const tags = t.match(TAG_RE);
  if (tags && tags.length) issues.push(`${name}: 残留裸 HTML 标签 ${[...new Set(tags)].join(" ")}`);
  // 真实 KaTeX 可渲染性
  let m;
  MATH_RE.lastIndex = 0;
  while ((m = MATH_RE.exec(t)) !== null) {
    const expr = m[1] ?? m[2];
    try {
      katex.renderToString(expr, { throwOnError: true, displayMode: !!m[1] });
    } catch (e) {
      issues.push(`${name}: 公式渲染失败 [${expr.slice(0, 40)}...]: ${e.message.split("\n")[0]}`);
    }
  }
}

function validate(q, idx, source) {
  const issues = [];
  const label = `#${idx + 1}${q.source ? " (" + q.source + ")" : ""}${q.topic ? " " + q.topic : ""}`;
  if (!q.subject) issues.push("缺少 subject");
  if (!q.topic) issues.push("缺少 topic");
  if (!q.stem) issues.push("缺少 stem");

  let options = q.options;
  if (typeof options === "string") {
    try { options = JSON.parse(options); } catch { options = []; }
  }
  if (!Array.isArray(options) || options.length < 2) {
    issues.push(`options 必须是 ≥2 的数组(当前: ${Array.isArray(options) ? options.length : typeof options})`);
  } else {
    options.forEach((o, i) => checkField(`options[${i}]`, o, issues));
    if (q.answer != null) {
      const norm = String(q.answer).trim();
      const hit = options.some((o) => String(o).trim() === norm);
      if (!hit) issues.push(`answer「${norm}」不在 options 中`);
    }
  }
  if (q.answer == null) issues.push("缺少 answer");

  checkField("stem", q.stem, issues);
  checkField("solution", q.solution, issues);
  return { label, issues };
}

async function loadSource(arg) {
  if (!arg || arg === "--db") {
    const rows = await prisma.question.findMany({ orderBy: { createdAt: "asc" } });
    return { items: rows, label: `全库(${rows.length} 题)` };
  }
  const ext = path.extname(arg).toLowerCase();
  const abs = path.isAbsolute(arg) ? arg : path.resolve(process.cwd(), arg);
  if (ext === ".json") {
    const data = JSON.parse(await import("fs").then((fs) => fs.promises.readFile(abs, "utf8")));
    return { items: Array.isArray(data) ? data : data.questions || [], label: arg };
  }
  // .js / .mjs 默认导出
  const mod = await import(pathToFileURL(abs).href);
  const items = mod.default || mod.questions || [];
  return { items, label: arg };
}

async function main() {
  const arg = process.argv[2];
  const { items, label } = await loadSource(arg);
  console.log(`\n校验对象: ${label}`);
  let pass = 0, fail = 0;
  const failures = [];
  for (let i = 0; i < items.length; i++) {
    const r = validate(items[i], i, arg);
    if (r.issues.length === 0) pass++;
    else {
      fail++;
      failures.push(r);
    }
  }
  console.log(`通过 ${pass} 题,阻断 ${fail} 题,共 ${items.length} 题\n`);
  if (failures.length) {
    console.log("==== 阻断级问题 ====");
    for (const f of failures) {
      console.log(`\n${f.label}`);
      for (const iss of f.issues) console.log(`  ✗ ${iss}`);
    }
    console.log(`\n结果:❌ 存在 ${fail} 道不合格题目,已拒绝。请修复后再入库/发布。`);
    await prisma.$disconnect();
    process.exit(1);
  }
  console.log("结果:✅ 全部题目通过渲染校验,可安全入库/发布。");
  await prisma.$disconnect();
}

main().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch {}
  process.exit(1);
});
