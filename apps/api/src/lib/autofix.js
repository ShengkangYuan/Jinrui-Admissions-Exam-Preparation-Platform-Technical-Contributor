// 退回题目「一键修正」引擎
//
// 目标:老师驳回时写了原因(如「公式渲染异常」「答案与选项不匹配」),系统据此自动定位并修好,
// 再重新进入审核队列,而不是让人逐字段手改。
//
// 双轨策略:
//   1) 定向修正 —— 解析 reviewNote 里的关键词,命中对应规则(在报告里标注「针对退回原因」)。
//   2) 通用体检 —— 无论原因写了什么,都跑一遍全部规则(与 scripts/verify_questions.js 同一套标准),
//      顺手把其它潜在显示问题一并修掉。原因没写/写得含糊时,这条兜底。
//
// 安全原则:
//   - 引擎只产出 patch 与 diff,是否落库由调用方决定(接口默认先 dry-run 给老师看前后对比)。
//   - 改不动的(如缺解析、公式语义错误)一律进 manual 列表交人工,绝不瞎猜。
//   - 修完再跑一次体检,把仍未解决的问题如实报告,避免「修了个寂寞还自动重新提交」。
import katex from "katex";
import { toCanonicalText, latexify } from "./text-clean.js";

// 与校验闸门保持同一套判定标准
// 用白名单而非通用 <\w+> —— 数学文本里可能出现 "$a<b>c$" 这类比较式,通用式会误报
const TAG_RE =
  /<\/?(?:p|div|br|hr|span|table|tbody|thead|tfoot|caption|col|colgroup|tr|td|th|ul|ol|li|dl|dt|dd|font|small|big|h[1-6]|strong|em|b|i|u|s|a|img|code|pre|blockquote|center|nobr|section|article|header|footer|sub|sup)\b[^<>]*>/i;
const TEX_DELIM_RE = /\\[([\])]/;
// 行内公式允许 $ 后带空格("$ x $"),与前端 rich.tsx 保持一致
const MATH_RE = /\$\$([\s\S]+?)\$\$|\$([^$]+?)\$/g;

// ---------- 通用小工具 ----------

function textsOf(d) {
  return [d.stem, d.solution, ...(d.options || []), d.answer].filter((t) => typeof t === "string" && t !== "");
}

// 对题目的所有可见文本字段套用同一变换,并记录 diff。
// answer 也一起变换,保证它与 options 始终用同一套写法(否则 opt === answer 判分会失配)。
function eachText(d, fn) {
  const diffs = [];
  for (const key of ["stem", "solution"]) {
    const before = d[key];
    if (before == null || before === "") continue;
    const after = fn(String(before));
    if (after !== before) {
      diffs.push({ field: key, before, after });
      d[key] = after;
    }
  }
  d.options = (d.options || []).map((o, i) => {
    const before = o == null ? "" : String(o);
    if (!before) return o;
    const after = fn(before);
    if (after !== before) diffs.push({ field: `选项 ${String.fromCharCode(65 + i)}`, before, after });
    return after;
  });
  if (d.answer) {
    const before = String(d.answer);
    const after = fn(before);
    if (after !== before) {
      diffs.push({ field: "answer", before, after });
      d.answer = after;
    }
  }
  return diffs;
}

function mathSegments(s) {
  const segs = [];
  MATH_RE.lastIndex = 0;
  let m;
  while ((m = MATH_RE.exec(s)) !== null) {
    segs.push({ expr: m[1] ?? m[2], display: !!m[1], start: m.index, end: MATH_RE.lastIndex });
  }
  return segs;
}

// 检测公式($...$ / $$...$$)之外的反斜杠 LaTeX 命令(如 \log、\sin、\frac、3\pi)。
// 这些命令渲染层(smartMath)能兜底,但数据不规范,应作为审查项提示用 $ 包裹。
function bareLatexCmds(s) {
  const stripped = String(s || "").replace(/\$\$[\s\S]+?\$\$|\$[^$]+?\$/g, "");
  return [...new Set((stripped.match(/\\[a-zA-Z]+/g) || []))];
}

function renders(expr, display) {
  try {
    katex.renderToString(expr, { throwOnError: true, displayMode: display });
    return true;
  } catch {
    return false;
  }
}

// 归一化比较键:忽略空白、$、花括号、\left\right 差异
function normKey(s) {
  return String(s)
    .replace(/\\left|\\right/g, "")
    .replace(/\$/g, "")
    .replace(/[{}]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

// ---------- 各类修复算法 ----------

function fixDollars(s) {
  const count = (s.match(/\$/g) || []).length;
  if (count % 2 === 0) return s;
  const idx = s.lastIndexOf("$"); // 去掉落单的那个定界符
  return s.slice(0, idx) + s.slice(idx + 1);
}

// 针对渲染失败的公式,按由轻到重给出候选修法
function repairCandidates(expr) {
  const out = [];
  let e = expr
    .replace(/\\frac\s*([0-9a-zA-Z])\s*([0-9a-zA-Z])(?![{}])/g, "\\frac{$1}{$2}") // \frac12 → \frac{1}{2}
    .replace(/\\sqrt\s*([0-9a-zA-Z])(?!\{)/g, "\\sqrt{$1}") // \sqrt2 → \sqrt{2}
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/(?<!\\)%/g, "\\%"); // 未转义百分号会让 KaTeX 把后面全当注释
  out.push(e);
  out.push(latexify(e));
  const open = (e.match(/(?<!\\)\{/g) || []).length;
  const close = (e.match(/(?<!\\)\}/g) || []).length;
  if (open > close) out.push(e + "}".repeat(open - close));
  if (close > open) out.push("{".repeat(close - open) + e);
  const l = (e.match(/\\left/g) || []).length;
  const r = (e.match(/\\right/g) || []).length;
  if (l !== r) out.push(e.replace(/\\left/g, "").replace(/\\right/g, "")); // 配不上就降级成普通括号
  return out;
}

// 逐段扫描文本里的公式,修好能修的;返回 { text, failed: [expr] }
function repairMath(text) {
  const segs = mathSegments(text);
  const failed = [];
  let out = text;
  // 从后往前替换,避免前面的改动影响后面的下标
  for (let i = segs.length - 1; i >= 0; i--) {
    const seg = segs[i];
    if (renders(seg.expr, seg.display)) continue;
    const fixed = repairCandidates(seg.expr).find((c) => c !== seg.expr && renders(c, seg.display));
    if (fixed) {
      const wrap = seg.display ? "$$" : "$";
      out = out.slice(0, seg.start) + wrap + fixed + wrap + out.slice(seg.end);
    } else {
      failed.push(seg.expr);
    }
  }
  return { text: out, failed };
}

function normalizeWhitespace(s) {
  return s
    .replace(/\u00a0|\u3000/g, " ") // NBSP / 全角空格
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizeImages(s) {
  // ![说明]( /path/x.png ) → ![说明](/path/x.png):URL 前后空格会让 Markdown 图片解析失败
  return s.replace(/!\[([^\]]*)\]\(\s*([^)\s]+)\s*\)/g, "![$1]($2)");
}

// ---------- 规则表(顺序敏感:先清洗文本,再校对答案) ----------

const RULES = [
  {
    code: "strip_html",
    label: "按规范格式重新清洗(剥离残留 HTML 标签、表格/列表转可读文本)",
    detect: (d) => textsOf(d).some((t) => TAG_RE.test(t)),
    apply: (d) => eachText(d, toCanonicalText),
  },
  {
    code: "latex_delim",
    label: "公式定界符归一化(\\( \\) \\[ \\] → $ $$)",
    detect: (d) => textsOf(d).some((t) => TEX_DELIM_RE.test(t)),
    apply: (d) =>
      eachText(d, (s) => s.replace(/\\\[/g, "$$").replace(/\\\]/g, "$$").replace(/\\\(/g, "$").replace(/\\\)/g, "$")),
  },
  {
    code: "image_path",
    label: "修正图片语法(去掉链接内多余空格)",
    // 用「变换后是否有变化」做判定,保证 detect 与 apply 永远一致,不会出现检出了却改不动
    detect: (d) => textsOf(d).some((t) => normalizeImages(t) !== t),
    apply: (d) => eachText(d, normalizeImages),
  },
  {
    code: "whitespace",
    label: "空白与排版规范化(全角空格、多余空行、首尾空格)",
    detect: (d) => textsOf(d).some((t) => normalizeWhitespace(t) !== t),
    apply: (d) => eachText(d, normalizeWhitespace),
  },
  {
    code: "unbalanced_dollar",
    label: "修复 $ 公式定界符不成对",
    detect: (d) => textsOf(d).some((t) => (t.match(/\$/g) || []).length % 2 !== 0),
    apply: (d) => eachText(d, (s) => ((s.match(/\$/g) || []).length % 2 !== 0 ? fixDollars(s) : s)),
  },
  {
    code: "bare_latex",
    label: "公式外存在裸 LaTeX 命令(如 \\log、\\sin、\\frac),建议用 $...$ 包裹",
    // 渲染层已兜底(smartMath 可正确渲染),但数据不规范;不自动改,交人工/后续清洗统一处理
    detect: (d) => textsOf(d).some((t) => bareLatexCmds(t).length > 0),
    apply: () => ({
      manual: [
        {
          code: "bare_latex",
          label: "公式外存在裸 LaTeX 命令,建议用 $ 包裹",
          detail: "渲染层已兜底显示,但建议规范化为 $...$;可运行 data-clean 脚本批量处理",
        },
      ],
    }),
  },
  {
    code: "katex_repair",
    label: "修复无法渲染的公式(补花括号、\\frac12 补全、转义百分号等)",
    detect: (d) => textsOf(d).some((t) => mathSegments(t).some((s) => !renders(s.expr, s.display))),
    apply: (d) => {
      const manual = [];
      const diffs = eachText(d, (s) => {
        const r = repairMath(s);
        if (r.failed.length) manual.push(...r.failed);
        return r.text;
      });
      if (manual.length) {
        diffs.manual = [
          {
            code: "katex_unfixable",
            label: "公式仍无法渲染,需人工改写",
            detail: [...new Set(manual)].slice(0, 5).map((e) => e.slice(0, 60)).join(" / "),
          },
        ];
      }
      return diffs;
    },
  },
  {
    code: "option_hygiene",
    label: "整理选项(去空白项、去重复项)",
    detect: (d) => {
      const opts = (d.options || []).map((o) => String(o ?? "").trim());
      const kept = opts.filter(Boolean);
      return kept.length !== opts.length || new Set(kept).size !== kept.length;
    },
    apply: (d) => {
      const before = [...(d.options || [])];
      const seen = new Set();
      const kept = [];
      for (const o of before) {
        const t = String(o ?? "").trim();
        if (!t || seen.has(t)) continue;
        seen.add(t);
        kept.push(t);
      }
      if (kept.length < 2) {
        return { manual: [{ code: "option_too_few", label: "选项不足 2 个,无法自动补全", detail: `当前 ${kept.length} 个` }] };
      }
      d.options = kept;
      return [{ field: "options", before: before.join(" | "), after: kept.join(" | ") }];
    },
  },
  {
    code: "answer_mismatch",
    label: "校正答案与选项失配(判分必错的隐患)",
    detect: (d) => {
      const opts = (d.options || []).map((o) => String(o).trim());
      return !!d.answer && opts.length >= 2 && !opts.includes(String(d.answer).trim());
    },
    apply: (d) => {
      const opts = (d.options || []).map((o) => String(o).trim());
      const raw = String(d.answer).trim();

      // ① 答案写成了选项序号 A/B/C…
      if (/^[A-Ha-h]$/.test(raw)) {
        const hit = opts[raw.toUpperCase().charCodeAt(0) - 65];
        if (hit) {
          d.answer = hit;
          return [{ field: "answer", before: raw, after: hit, why: "答案填的是选项字母,已替换为该选项的完整内容" }];
        }
      }
      // ② 仅写法差异(空白/$/花括号/\left\right)
      let hit = opts.find((o) => normKey(o) === normKey(raw));
      if (hit) {
        d.answer = hit;
        return [{ field: "answer", before: raw, after: hit, why: "与选项仅有写法差异,已对齐为选项原文" }];
      }
      // ③ a/b 除法写法 vs \frac{a}{b}
      const asFrac = raw.replace(/(\d+)\s*\/\s*(\d+)/g, "\\frac{$1}{$2}");
      hit = opts.find((o) => normKey(o) === normKey(asFrac));
      if (hit) {
        d.answer = hit;
        return [{ field: "answer", before: raw, after: hit, why: "答案用 / 表示分数、选项用 \\frac,已统一" }];
      }
      // ④ 数学记号未 LaTeX 化(√ π ² 等)
      hit = opts.find((o) => normKey(o) === normKey(latexify(raw)));
      if (hit) {
        d.answer = hit;
        return [{ field: "answer", before: raw, after: hit, why: "答案使用了非 LaTeX 记号,已对齐为选项原文" }];
      }
      return {
        manual: [
          {
            code: "answer_unresolved",
            label: "答案不在选项中,且无法自动判定对应哪一项",
            detail: `答案「${raw.slice(0, 40)}」;选项:${opts.map((o) => o.slice(0, 20)).join(" / ")}`,
          },
        ],
      };
    },
  },
  {
    code: "difficulty_range",
    label: "修正难度取值(须为 1-5 的整数)",
    detect: (d) => !Number.isInteger(Number(d.difficulty)) || Number(d.difficulty) < 1 || Number(d.difficulty) > 5,
    apply: (d) => {
      const before = d.difficulty;
      d.difficulty = 3;
      return [{ field: "difficulty", before: String(before), after: "3", why: "取值非法,回退为默认中等难度" }];
    },
  },
  {
    code: "missing_solution",
    label: "缺少解析",
    detect: (d) => !d.solution || !String(d.solution).trim(),
    apply: () => ({
      manual: [{ code: "missing_solution", label: "缺少解析,需人工补充", detail: "学生做错后看不到讲解" }],
    }),
  },
];

// 退回原因关键词 → 优先命中的规则
const NOTE_HINTS = [
  { re: /(标签|html|乱码|代码|残留)/i, codes: ["strip_html"] },
  { re: /(公式|渲染|latex|katex|数学|符号|\$)/i, codes: ["latex_delim", "unbalanced_dollar", "katex_repair", "strip_html"] },
  { re: /(答案|判分|对不上|不匹配|失配|错配)/, codes: ["answer_mismatch"] },
  { re: /(选项|重复|空项)/, codes: ["option_hygiene", "answer_mismatch"] },
  { re: /(空格|排版|格式|换行|对齐)/, codes: ["whitespace", "image_path"] },
  { re: /(难度)/, codes: ["difficulty_range"] },
  { re: /(解析|讲解|步骤|过程)/, codes: ["missing_solution"] },
  { re: /(图片|图片路径|配图|image|图)/i, codes: ["image_path"] },
];

export function codesFromNote(note) {
  if (!note) return [];
  const codes = new Set();
  for (const h of NOTE_HINTS) if (h.re.test(note)) h.codes.forEach((c) => codes.add(c));
  return [...codes];
}

// 修完后再体检一遍,如实报告仍存在的问题
export function healthCheck(d) {
  const issues = [];
  if (!d.stem || !String(d.stem).trim()) issues.push("题干为空");
  const opts = (d.options || []).map((o) => String(o).trim());
  if (opts.length < 2) issues.push("选项少于 2 个");
  if (!d.answer) issues.push("缺少答案");
  else if (opts.length >= 2 && !opts.includes(String(d.answer).trim())) issues.push("答案仍不在选项中");
  for (const t of textsOf(d)) {
    if (TAG_RE.test(t)) issues.push("仍有残留 HTML 标签");
    if ((t.match(/\$/g) || []).length % 2 !== 0) issues.push("$ 定界符仍不成对");
    for (const s of mathSegments(t)) if (!renders(s.expr, s.display)) issues.push(`公式仍无法渲染:${s.expr.slice(0, 40)}`);
    const bare = bareLatexCmds(t);
    if (bare.length) issues.push(`公式外有裸 LaTeX 命令(${bare.slice(0, 4).join(", ")})`);
  }
  return [...new Set(issues)];
}

/**
 * 计算一道题的修正方案(纯函数,不落库)
 * @param {object} q  数据库里的 Question 行(options 为 JSON 字符串)
 * @returns {{ fixes, manual, patch, remaining, clean, targetedCodes, noteMatched }}
 */
export function planAutoFix(q) {
  let options = [];
  try {
    const parsed = JSON.parse(q.options || "[]");
    options = Array.isArray(parsed) ? parsed : [];
  } catch {
    options = [];
  }
  const original = {
    stem: q.stem ?? "",
    solution: q.solution ?? "",
    options,
    answer: q.answer ?? "",
    difficulty: q.difficulty,
  };
  const draft = { ...original, options: [...options] };

  const targetedCodes = codesFromNote(q.reviewNote);
  const fixes = [];
  const manual = [];

  for (const rule of RULES) {
    let hit = false;
    try {
      hit = rule.detect(draft);
    } catch {
      hit = false;
    }
    if (!hit) continue;
    const r = rule.apply(draft) || [];
    // 规则可返回 diff 数组,也可返回 { manual: [...] };katex 规则两者都有(数组上挂 manual 属性)
    const diffs = Array.isArray(r) ? r : [];
    const extraManual = r.manual || [];
    for (const d of diffs) {
      fixes.push({
        code: rule.code,
        label: rule.label,
        targeted: targetedCodes.includes(rule.code),
        ...d,
      });
    }
    for (const m of extraManual) manual.push({ ...m, targeted: targetedCodes.includes(rule.code) });
  }

  // 只把真正变化的字段放进 patch,减少无谓写库
  const patch = {};
  if (draft.stem !== original.stem) patch.stem = draft.stem;
  if (draft.solution !== original.solution) patch.solution = draft.solution;
  if (draft.answer !== original.answer) patch.answer = draft.answer;
  if (Number(draft.difficulty) !== Number(original.difficulty)) patch.difficulty = Number(draft.difficulty);
  if (JSON.stringify(draft.options) !== JSON.stringify(original.options)) patch.options = JSON.stringify(draft.options);

  const remaining = healthCheck(draft);
  return {
    fixes,
    manual,
    patch,
    remaining,
    clean: remaining.length === 0,
    targetedCodes,
    noteMatched: targetedCodes.length > 0,
    preview: { stem: draft.stem, options: draft.options, answer: draft.answer, solution: draft.solution, difficulty: draft.difficulty },
  };
}
