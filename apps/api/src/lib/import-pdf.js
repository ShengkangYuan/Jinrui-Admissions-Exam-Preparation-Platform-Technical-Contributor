// PDF 批量导入编排:
//   1) 用 PyMuPDF 把 PDF 逐页栅格化为 PNG(pdf_rasterize.py),公式以渲染后的图像呈现
//   2) 把每页图片交给视觉模型(读渲染后的数学字形,还原为规范 LaTeX)
//   3) 模型返回的每条题目经 finalizeRow 归一化(answer 字母→选项文本、换行清洗等)
//   4) 过滤掉字段不完整/无效的题,交回 importRows 入库
import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { extractQuestionsFromPdfPages, extractAnswersFromPdfPages, isVisionConfigured } from "./vision.js";
import { finalizeRow } from "./parse-import-file.js";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const RASTER_SCRIPT = path.join(__dirname, "..", "..", "scripts", "pdf_rasterize.py");

// 跨平台调用 Python:Linux/macOS 通常是 python3,Windows 官方安装包通常是 python
async function runPython(scriptArgs, options) {
  let lastErr;
  for (const bin of process.env.PYTHON_BIN ? [process.env.PYTHON_BIN] : ["python3", "python"]) {
    try {
      return await execFileAsync(bin, scriptArgs, options);
    } catch (e) {
      // ENOENT = 该解释器不存在,换下一个;其他错误(脚本异常等)直接抛出
      if (e.code !== "ENOENT") throw e;
      lastErr = e;
    }
  }
  throw new Error(
    "未找到 Python 解释器(python3 / python)。PDF 导入需要 Python 3 并安装 PyMuPDF(pip install PyMuPDF)," +
      "也可用环境变量 PYTHON_BIN 指定解释器路径。原始错误:" + (lastErr?.message || "")
  );
}

export async function rasterize(pdfBuf) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "pdfimp-"));
  try {
    const pdfPath = path.join(tmpDir, "input.pdf");
    fs.writeFileSync(pdfPath, pdfBuf);
    const outDir = path.join(tmpDir, "pages");
    fs.mkdirSync(outDir, { recursive: true });
    const { stdout } = await runPython(
      [RASTER_SCRIPT, pdfPath, outDir, "150"],
      { maxBuffer: 50 * 1024 * 1024, timeout: 120000 }
    );
    // 子进程 stdout 可能混入依赖库的告警,只截取 JSON 主体
    const s = stdout.indexOf("{");
    const e = stdout.lastIndexOf("}");
    if (s < 0 || e <= s) throw new Error("栅格化脚本未返回 JSON:" + stdout.slice(0, 200));
    const info = JSON.parse(stdout.slice(s, e + 1));
    const pages = (info.pages || []).map((p) => ({
      image: fs.readFileSync(p.path).toString("base64"),
      text: p.text || "",
    }));
    if (!pages.length) throw new Error("PDF 没有任何可栅格化的页面");
    return pages;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

// 从文件名推测卷名,如 "TMUA-2021-paper-1.pdf" → "TMUA 2021 Paper 1"。
// 用作题目的 paper 字段,既能让审核列表/试卷名可读,又能避免不同年份同名卷
// 因 sourceKey(subject::paper::source) 相同而被错误合并。解析不出时回落到视觉模型返回的 paper。
export function paperFromFilename(filename) {
  let f = String(filename || "")
    .replace(/\.[^.]+$/, "")
    .replace(/[_\-]+/g, " ")
    .trim();
  if (!f) return "";
  // 去掉文件名里的"题目N"等分卷序号(用户常把一套真题拆成 题目1/题目2 多文件导入),
  // 避免同一套卷被拆成多套、paper 名带奇怪序号。年份/paper 号提取不受影响。
  f = f.replace(/题目\s*\d+/gi, " ").replace(/相关真题/gi, " ").replace(/真题/gi, " ").replace(/\s+/g, " ").trim();
  const subj = /SMC/i.test(f) ? "SMC" : /ESAT/i.test(f) ? "ESAT" : /TMUA/i.test(f) ? "TMUA" : "";
  const year = (f.match(/\b(19|20)\d{2}\b/) || [])[0] || "";
  const pNum = (f.match(/paper\s*(\d+)/i) || f.match(/p\s*(\d+)/i) || [])[1] || "";
  if (subj && year && pNum) return `${subj} ${year} Paper ${pNum}`;
  if (subj && pNum) return `${subj} Paper ${pNum}`;
  // 兜底:用文件名本身(去扩展名/分隔符)作为卷名。
  // 这样物理/化学等非 ESAT·TMUA 的真题 PDF 只要文件名不同就会各自成卷,
  // 同名文件重复导入仍按 sourceKey 自动合并(dedup),避免不同套题被错误并卷。
  return f;
}

// ——— 文件级元数据统一:彻底避免同一份 PDF 被拆成多套卷 ———
// 视觉模型是逐题判断 subject 的,同卷内偶尔会判错(如把 NSAA 物理题判成 ESAT),
// 导致 syncAutoPaperSets 按 subject::paper::source 三元组拆成多套卷。
// 这里在同一份 PDF 内强制统一 subject(科目)与 sourceType(题源):
//   paper:     文件名解析优先 → 文件内多数派 → 首个非空 → 保持空
//   subject:   paper 组内学科多数派 → 文件内学科多数派 → sourceType=TMUA 时兜底"数学" → 保持空
//   sourceType:文件名题源信号(ESAT/TMUA/NSAA...) → 文件内题源多数派 → 保持空
// 注意:subject 归一化映射须与 routes/questions.js 的 SUBJECT_NORM 保持一致。
const SUBJECT_NORM = {
  Chemistry: "化学",
  Physics: "物理",
  Biology: "生物",
  Math: "数学",
  Maths: "数学",
  Mathematics: "数学",
  Alevel: "数学",
};
function normSubject(s) {
  const v = String(s || "").trim();
  return SUBJECT_NORM[v] || v;
}

// 已知考试题源(会出现在视觉模型的 subject 字段或文件名里)。新增题源时在此扩展。
const SOURCE_TYPE_NAMES = ["TMUA", "ESAT", "NSAA", "BMAT", "STEP", "MAT", "PAT", "ENGAA", "SMC"];
// 科目(知识学科)。视觉模型 subject 属于这些值时记入科目投票,否则若在 SOURCE_TYPE_NAMES 则记入题源投票。
const SUBJECT_NAMES = ["数学", "物理", "化学", "生物"];

// 从文件名提取题源信号(ESAT/TMUA/NSAA/BMAT/STEP/MAT/PAT/ENGAA),未命中返回 ""
export function sourceTypeFromFilename(filename) {
  const m = String(filename || "").match(/\b(TMUA|ESAT|NSAA|BMAT|STEP|MAT|PAT|ENGAA|SMC)\b/i);
  return m ? m[1].toUpperCase() : "";
}

// 取列表中出现次数最多的非空值,平票取先出现的;全空返回 ""
function modeOf(list) {
  const cnt = new Map();
  const order = [];
  for (const v of list) {
    const s = String(v || "").trim();
    if (!s) continue;
    if (!cnt.has(s)) {
      cnt.set(s, 0);
      order.push(s);
    }
    cnt.set(s, cnt.get(s) + 1);
  }
  if (!order.length) return "";
  let best = order[0];
  for (const v of order) if (cnt.get(v) > cnt.get(best)) best = v;
  return best;
}

export function unifyFileMeta(raws, filename) {
  if (!raws.length) return raws;
  const fnSourceType = sourceTypeFromFilename(filename);
  const fnPaper = paperFromFilename(filename);

  // 1) 统一 paper:文件名解析 → 文件内多数派 → 首个非空
  const paperVotes = raws.map((r) => String(r?.paper || "").trim());
  const paper = fnPaper || modeOf(paperVotes) || paperVotes.find(Boolean) || "";

  // 2) 逐题归一化 subject,区分「学科信号」与「题源信号」
  const inGroup = paper
    ? raws.filter((r) => String(r?.paper || "").trim() === paper)
    : raws;
  const allSubjectVotes = [];
  const groupSubjectVotes = [];
  const sourceTypeVotes = [];
  for (const r of raws) {
    const t = normSubject(r?.subject);
    if (!t) continue;
    if (SOURCE_TYPE_NAMES.includes(t)) sourceTypeVotes.push(t);
    else allSubjectVotes.push(t);
  }
  for (const r of inGroup) {
    const t = normSubject(r?.subject);
    if (t && !SOURCE_TYPE_NAMES.includes(t)) groupSubjectVotes.push(t);
  }

  // 3) 统一 sourceType:文件名题源信号 → 解析出的卷名题源信号 → 文件内逐题题源多数派
  //    注意:逐题 subject 由视觉模型逐题判断,同卷偶尔误判(如把 NSAA 数学卷判成 TMUA),
  //    故卷名信号优先级高于逐题投票,避免被误投票覆盖。
  const sourceType = fnSourceType || sourceTypeFromFilename(paper) || modeOf(sourceTypeVotes) || "";

  // 4) 统一 subject:paper 组内学科多数派 → 文件内学科多数派 → 纯数学类题源兜底"数学"
  //    视觉模型常把 MAT/TMUA 等题的 subject 误读成题源词(归到 sourceType),导致学科为空;
  //    NSAA/ESAT 含物理/化学,保留逐题学科投票结果,此处只给「纯数学类题源」兜底为"数学"。
  const MATH_SOURCE_TYPES = ["TMUA", "MAT", "STEP", "BMAT", "PAT", "ENGAA", "SMC"];
  let subject = modeOf(groupSubjectVotes) || modeOf(allSubjectVotes) || "";
  if (!subject && sourceType && MATH_SOURCE_TYPES.includes(sourceType)) subject = "数学";

  // 5) 应用到每一道题
  // 注意:subject/sourceType 算不出就置 null,绝不回退 r?.subject——
  //     视觉模型的 subject 可能是题源词(如 ESAT),回退会把题源混进科目,违背「科目/题源分离」。
  return raws.map((r) => ({
    ...r,
    subject: subject || null,
    paper: paper || r?.paper,
    sourceType: sourceType || null,
  }));
}

function normalizeRaw(r, filename) {
  return {
    subject: r?.subject,
    sourceType: r?.sourceType || null,
    paper: paperFromFilename(filename) || r?.paper,
    qno: r?.qno != null ? Number(r.qno) || null : null, // 题号:双文件导入按 qno 与答案表匹配,避免位置错位
    topic: r?.topic,
    difficulty: r?.difficulty,
    type: r?.type,
    stem: r?.stem,
    options: Array.isArray(r?.options) ? r.options : r?.options ? [r.options] : [],
    answer: r?.answer,
    solution: r?.solution,
    source: "PDF 导入", // PDF 来源统一标记,便于区分
  };
}

export async function parsePdf(filename, buffer) {
  if (!isVisionConfigured()) throw new Error("VISION_NOT_CONFIGURED");
  const isSMC = /\bSMC\b/i.test(String(filename || ""));
  const pages = await rasterize(buffer);
  // SMC 等短选项密集卷:一页往往有多道题且选项横向排列,减少每批页数可提高识别精度
  const raws = await extractQuestionsFromPdfPages(pages, { maxPagesPerCall: isSMC ? 1 : undefined });
  // 丢题预警:TMUA/ESAT 等官方卷一页通常 1-2 题;若题目页数明显多于提取题数,大概率有题没识别到
  // (视觉模型偶发漏题是已知问题,2022 Paper 2 曾丢 Q7-Q10 整整 4 题)。此时打日志并在结果里带 warning。
  const questionPageCount = pages.filter((p) => !/^\s*(BLANK|PAGE)\b/i.test(String(p.text || ""))).length;
  const warning = questionPageCount > raws.length + 2 ? `:识别到 ${raws.length} 题,但题目页有 ${questionPageCount} 页,可能漏题(建议核对原卷题数)` : "";
  if (warning) console.warn(`[import-pdf] ${filename}${warning}`);
  // 文件级统一 subject/paper:同一份 PDF 的所有题必须是同一套卷,视觉模型逐题误判
  // (如把物理题判成 ESAT)不应导致拆卷。详见 unifyFileMeta。
  const unified = unifyFileMeta(raws, filename);
  const parsed = unified
    .map((r) => {
      try {
        return finalizeRow(normalizeRaw(r, filename));
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .filter((r) => r.stem && Array.isArray(r.options) && r.options.length >= 2);
  // 疑似并题行:视觉模型偶尔会把一页多道题的选项合并进一行(如 NSAA 出现 24 个选项的"假题")。
  // 也识别"纯字母选项"(所有选项都只剩 A/B/C 字母,选项正文丢失)的失败行。
  // 这类行无法还原为有效题,直接剔除并在 meta 里计数,避免把合并错乱的假题写进题库。
  // 例外:SMC 等短选项卷视觉模型偶发只读出字母,宁可保留待审也不全部丢弃,故对 SMC 放宽。
  const tooMany = (r) => Array.isArray(r.options) && r.options.length > 8;
  const letterOnly = (r) => Array.isArray(r.options) && r.options.length >= 2 && r.options.every((o) => /^[A-Ha-h]$/.test(String(o).trim()));
  const corrupt = parsed.filter((r) => tooMany(r) || (!isSMC && letterOnly(r)));
  const rows = parsed.filter((r) => !tooMany(r) && (isSMC || !letterOnly(r)));
  if (corrupt.length) console.warn(`[import-pdf] ${filename}:${corrupt.length} 行选项异常(疑似多题合并或选项提取失败),已跳过`);
  if (!rows.length) {
    throw new Error("视觉模型未从 PDF 解析出有效的选择题(可能是纯文本试卷、或公式无法识别)");
  }
  return {
    rows,
    meta: {
      corrupt: corrupt.length,
      questionPages: questionPageCount,
      lostCount: Math.max(0, questionPageCount - rows.length),
    },
  };
}

// 解析独立的答案文件(PDF):返回按题号升序的 [{ question, answer }]
export async function parseAnswerPdf(filename, buffer) {
  if (!isVisionConfigured()) throw new Error("VISION_NOT_CONFIGURED");
  const pages = await rasterize(buffer);
  const raws = await extractAnswersFromPdfPages(pages);
  const map = new Map();
  for (const r of raws) {
    const q = parseInt(String(r?.question ?? "").replace(/^0+/, ""), 10);
    const a = String(r?.answer ?? "").trim();
    if (Number.isFinite(q) && q > 0 && a && !map.has(q)) map.set(q, a);
  }
  const out = [...map.entries()].sort((x, y) => x[0] - y[0]).map(([question, answer]) => ({ question, answer }));
  if (!out.length) {
    throw new Error("视觉模型未从答案文件中识别出答案表(请确认答案文件是包含题号+答案的表格/列表)");
  }
  return out;
}
