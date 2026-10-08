import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { syncAutoPaperSets, recalcPapersOfQuestion, parseIds } from "../lib/paper-set.js";
import { planAutoFix } from "../lib/autofix.js";
import { KNOWLEDGE_RULES } from "../lib/knowledge-rules.js";
import { buildSubjectFilter } from "../lib/subject-filter.js";
import { cleanUnits } from "../lib/text-normalize.js";
import { chatComplete, llmConfigured, llmInfo } from "../lib/llm.js";
import { planSkillFix } from "../lib/fix-question.js";
import { normalizeNewlines } from "../lib/text-clean.js";
import { applyTeacherPerms, expandSourceType } from "../lib/teacherPerms.js";
import { parseImportFile, mapAnswerToOptionText, alignAnswerToOptions } from "../lib/parse-import-file.js";
import { parsePdf, parseAnswerPdf } from "../lib/import-pdf.js";
import { createImportTask, updateImportTask, finishImportTask, failImportTask, getImportTask } from "../lib/import-task.js";
import { extractQuestionFromImage } from "../lib/vision.js";

const router = Router();
const PUBLIC_FIELDS = { id: true, subject: true, sourceType: true, paper: true, topic: true, topicIds: true, difficulty: true, type: true, stem: true, options: true, source: true, status: true, importedAt: true, createdAt: true, updatedAt: true };

// 后台执行导入任务:捕获异常 → 任务标记 error;成功 → finishImportTask
async function runImportTask(taskId, fn) {
  try {
    const result = await fn();
    finishImportTask(taskId, result);
  } catch (e) {
    failImportTask(taskId, e?.message || "导入失败");
  }
}

// 解析 JSON 字符串数组(如 topicIds)
function parseJsonIds(s) {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// 依据 subject + topic 字符串,从知识点库自动匹配知识点(名称相等或互相包含)。
// 题目学科 → 可归类的知识点学科池(TMUA 是数学思维考试 → 数学;ESAT → 数学+物理)
function knowledgeSubjectsFor(subject) {
  if (subject === "TMUA") return ["数学"];
  if (subject === "ESAT") return ["数学", "物理"];
  if (subject === "SMC") return ["数学"];
  return [subject];
}

// 视觉模型/导入数据里学科可能是英文,归一化到知识点库的四门中文学科(及 TMUA/ESAT)
const SUBJECT_NORM = {
  Chemistry: "化学",
  Physics: "物理",
  Biology: "生物",
  Math: "数学",
  Maths: "数学",
  Mathematics: "数学",
  Alevel: "数学",
};
function normalizeSubject(s) {
  const v = String(s || "").trim();
  return SUBJECT_NORM[v] || v;
}

// 匹配不到返回 []——题目留白,由老师后续归类。
async function matchKnowledgePoints(subject, topicStr) {
  const names = String(topicStr || "")
    .split(/[,、;；\/\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!names.length) return [];
  const subs = knowledgeSubjectsFor(subject);
  const kps = subs.length ? await prisma.knowledgePoint.findMany({ where: { subject: { in: subs } } }) : [];
  const hits = [];
  for (const n of names) {
    // 1) 名称匹配(相等/互相包含)
    let hit = kps.find((k) => k.name === n || k.name.includes(n) || n.includes(k.name));
    // 2) 中文关键词规则兜底(视觉模型 topic 常输出中文,如"三角"→Trigonometry)
    if (!hit) {
      for (const r of KNOWLEDGE_RULES) {
        if (!subs.includes(r.subject)) continue;
        if (r.re.test(n)) {
          hit = kps.find((k) => k.name === r.kp);
          if (hit) break;
        }
      }
    }
    if (hit && !hits.some((h) => h.id === hit.id)) hits.push(hit);
  }
  return hits;
}

// 把 topicIds(数组)解析成知识点名称数组;题目未归类返回空
async function resolveTopics(topicIds) {
  const ids = Array.isArray(topicIds) ? topicIds : parseJsonIds(topicIds);
  if (!ids.length) return [];
  const kps = await prisma.knowledgePoint.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } });
  const byId = new Map(kps.map((k) => [k.id, k.name]));
  return ids.map((id) => byId.get(id)).filter(Boolean);
}

// 归一化题目携带的知识点:支持 topicIds(数组) 或 topic(字符串,自动匹配)
// 返回 { topicIds, topic }
// 注意:topicIds 是前端按"题目学科映射的知识点学科"加载的(如 TMUA→数学),后端直接信任,
//       不要再用题目 subject 过滤(题目学科 TMUA 下没有知识点,会误清空)。
async function normalizeTopicInput({ subject, topic, topicIds }) {
  if (Array.isArray(topicIds) && topicIds.length) {
    const kps = await prisma.knowledgePoint.findMany({ where: { id: { in: topicIds } }, select: { id: true, name: true } });
    const ids = kps.map((k) => k.id);
    return { topicIds: ids, topic: kps[0]?.name || String(topic || "").trim() };
  }
  const matched = await matchKnowledgePoints(subject, topic);
  return { topicIds: matched.map((k) => k.id), topic: matched[0]?.name || String(topic || "").trim() };
}

// 解析 options(JSON 字符串或数组) → 字符串数组
function safeParseOptions(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try { const v = JSON.parse(raw); return Array.isArray(v) ? v : []; } catch { return []; }
  }
  return [];
}

// 清洗选项正文:去掉 PDF 视觉模型误带出的字母前缀(如 "A 1/25"、"A. 1/25"、"(A) 1/25"),
// 选项 A./B./C. 标签由系统自动添加。prompt 已禁止前缀,这里是兜底。
// 注意:`+` 要求字母后至少一个分隔符(空格/点/冒号/括号等),防止 "Covalent" 误删 "C"、"It has" 误删 "I"——
//     历史 bug:* 允许零个分隔符,等价于"删开头的单个字母",导致 72 个选项首字母被吞(参见 #17)
// 2026-08-09:把 I/i 排除在前缀字母外。"I" 同时是英文单词与罗马数字,常见选项如 "I only"、
//     "I and II only" 会被误当成选项前缀(如 "I. only")而吞掉 "I"。第九个选项标签极少出现,宁可不清洗。
function cleanOptionPrefix(o) {
  return String(o ?? "").replace(/^[\(\[【（]?[A-HJ-Za-hj-z][\.\s:、)）\]】」、\]】]+/, "").trimStart();
}

// 组装发给 LLM 的题目信息(解析统一用英文输出)
function buildSolutionPrompt({ stem, options, answer, topic }) {
  const optText = Array.isArray(options) && options.length
    ? options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")
    : "(no options / open question)";
  return [
    `[Subject / Topic] ${topic || "Mathematics"}`,
    `[Question] ${stem}`,
    `[Options]\n${optText}`,
    `[Answer] ${answer || "(see question or explanation)"}`,
    "",
    "Based on the above question, write a solution explanation **in English** covering three parts: Solution Steps, Knowledge Points Tested, and Common Pitfalls.",
  ].join("\n");
}

// 清理 LLM 可能返回的代码块包裹 / 多余前后缀
function cleanSolution(text) {
  let t = String(text || "").trim();
  const fence = t.match(/^```(?:markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  return t;
}

// 若题目缺解析且已配置 LLM,则生成结构化解析;否则返回 null
async function tryGenerateSolution(q) {
  if (!llmConfigured() || (q.solution && String(q.solution).trim())) return null;
  try {
    const raw = await chatComplete({
      system:
        "You are an experienced tutor for UK university admissions mathematics tests (TMUA, ESAT, etc.). Provide a clear, rigorous, student-friendly solution explanation for the given question. " +
        "Write the entire explanation **in English** as plain text with simple line breaks. Cover three parts: Solution Steps, Knowledge Points Tested, and Common Pitfalls. " +
        "Do NOT use Markdown syntax: no ## headings, no - bullet lists, no ** bold**, no # symbols. " +
        "Formula rules: use only $...$ for inline math and $$...$$ for display math; do NOT use \\(...\\), \\[...\\], \\text{...}, \\begin{...}, or \\\\ inside math. Keep formulas simple and valid LaTeX (e.g. $x^2 - 5x + 6 = 0$, $\\frac{1}{2}$). " +
        "Output only the solution content, no greetings.",
      user: buildSolutionPrompt({ stem: q.stem, options: safeParseOptions(q.options), answer: q.answer, topic: q.topic }),
      temperature: 0.2,
      maxTokens: 900,
    });
    return cleanSolution(raw) || null;
  } catch {
    return null;
  }
}

// 简单 CSV 解析(支持双引号包裹的字段)
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field.trim()); field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field.trim()); field = "";
      if (row.some((c) => c !== "")) rows.push(row);
      row = [];
    } else {
      field += ch;
    }
  }
  row.push(field.trim());
  if (row.some((c) => c !== "")) rows.push(row);
  return rows;
}

// 批量导入:兼容 JSON 数组 或 CSV 文本
// CSV 列顺序:subject,paper,topic,difficulty,type,stem,options(分号分隔),answer,solution,source,status
async function importRows(req, rows, onProgress) {
  const errors = [];
  const created = []; // 供套题自动组卷使用
  let imported = 0;
  // 预载知识点库(按 subject 分组),供导入自动归类复用
  const allKps = await prisma.knowledgePoint.findMany();
  const kpBySubject = new Map();
  for (const k of allKps) {
    if (!kpBySubject.has(k.subject)) kpBySubject.set(k.subject, []);
    kpBySubject.get(k.subject).push(k);
  }
  function matchKps(subject, topicStr) {
    const names = String(topicStr || "")
      .split(/[,、;；\/\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    // 题目学科映射到知识点学科池(TMUA→数学,ESAT→数学+物理),保证 TMUA 题也能自动归类
    const subs = knowledgeSubjectsFor(subject);
    const pool = subs.flatMap((s) => kpBySubject.get(s) || []);
    const hits = [];
    for (const n of names) {
      // 1) 名称匹配;2) 中文关键词规则兜底(视觉模型 topic 常输出中文)
      let hit = pool.find((k) => k.name === n || k.name.includes(n) || n.includes(k.name));
      if (!hit) {
        for (const r of KNOWLEDGE_RULES) {
          if (!subs.includes(r.subject)) continue;
          if (r.re.test(n)) {
            hit = pool.find((k) => k.name === r.kp);
            if (hit) break;
          }
        }
      }
      if (hit && !hits.some((h) => h.id === hit.id)) hits.push(hit);
    }
    return hits;
  }
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    try {
      const options = Array.isArray(r.options)
        ? r.options
        : String(r.options || "").split(/[;；]/).map((s) => s.trim()).filter(Boolean);
      // 学科归一化(视觉模型可能输出 Chemistry/Physics 等英文,映射到中文学科)
      r.subject = normalizeSubject(r.subject);
      // 题源词(如 Word/Excel 里 Subject: TMUA)归到 sourceType,科目落到中文学科(TMUA/ESAT→数学)
      if (/^(TMUA|ESAT|NSAA|BMAT|STEP|MAT|PAT|ENGAA|SMC)$/i.test(String(r.subject || ""))) {
        if (!r.sourceType) r.sourceType = String(r.subject).toUpperCase();
        r.subject = "数学";
      }
      // 兜底:sourceType 为纯数学类题源但视觉模型/原始数据未给学科(如 MAT 被并入题源词后学科为空)
      if (!r.subject && /^(TMUA|MAT|STEP|BMAT|PAT|ENGAA|SMC)$/i.test(String(r.sourceType || ""))) {
        r.subject = "数学";
      }
      // 题干/选项清洗单位 LaTeX(如 mol^{-1} → mol⁻¹,AgNO$_3$ → AgNO₃),避免 KaTeX 渲染报错
      const stem = cleanUnits(String(r.stem || ""));
      const cleanOpts = options.map((o) => normalizeNewlines(cleanOptionPrefix(cleanUnits(String(o)))));
      if ((!r.subject && !r.sourceType) || !r.topic || !stem || cleanOpts.length < 2) {
        throw new Error("字段不完整(需要 subject 或 sourceType、topic、stem、options≥2)");
      }
      r.stem = stem;
      options.length = 0;
      options.push(...cleanOpts);
      // 答案与选项用同一套清洗并对齐:字母→选项文本、LaTeX/单位差异→选项精确文本、无法对齐置空交审核
      // 保证 answer === 某个选项文本,判分(a===s 全等)才一致
      r.answer = alignAnswerToOptions(r.answer, cleanOpts);
      // PDF 导入若图片中无答案 key,允许 answer 为空,教师在审核页补充
      if (!r.answer && r.source !== "PDF 导入") {
        throw new Error("字段不完整:answer 必填");
      }
      // 知识点归类:显式 topicIds 优先;否则按 topic 字符串自动匹配(匹配不到留空)
      let topicIds = [];
      let topic = String(r.topic || "").trim();
      if (Array.isArray(r.topicIds) && r.topicIds.length) {
        const valid = allKps.filter((k) => r.topicIds.includes(k.id));
        topicIds = valid.map((k) => k.id);
        if (valid[0]) topic = valid[0].name;
      } else {
        const matched = matchKps(r.subject, r.topic);
        topicIds = matched.map((k) => k.id);
        if (matched[0]) topic = matched[0].name;
      }
      const q = await prisma.question.create({
        data: {
          subject: r.subject,
          sourceType: r.sourceType || null,
          paper: r.paper || null,
          topic,
          topicIds: JSON.stringify(topicIds),
          difficulty: Number(r.difficulty) || 3,
          type: r.type || "SINGLE_CHOICE",
          stem: normalizeNewlines(cleanUnits(r.stem)),
          options: JSON.stringify(options),
          answer: r.answer ? normalizeNewlines(String(r.answer)) : "",
          solution: r.solution ? normalizeNewlines(r.solution) : null,
          source: r.source || "批量导入",
          status: r.status || "PENDING_REVIEW",
          importedAt: new Date(),
          createdBy: req.user.id,
        },
      });
      created.push({ id: q.id, subject: q.subject, sourceType: q.sourceType, paper: q.paper, source: q.source });
      imported++;
    } catch (e) {
      errors.push({ row: i + 1, reason: e.message });
    }
    if (onProgress && (i + 1) % 5 === 0) {
      onProgress(Math.round(((i + 1) / rows.length) * 100), `已处理 ${i + 1}/${rows.length} 条`);
    }
  }
  if (onProgress) onProgress(100, `已处理 ${rows.length}/${rows.length} 条`);
  return { imported, errors, created };
}

// POST /api/questions/import — 批量导入题目(老师/管理员)
// 任务式:立即返回 { taskId },后台逐条导入,前端轮询 GET /questions/import-task/:taskId 看进度
router.post(
  "/import",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { items, csv } = req.body || {};
    let rows = [];
    if (Array.isArray(items)) rows = items;
    else if (typeof csv === "string" && csv.trim()) {
      const parsed = parseCsv(csv);
      if (parsed.length) parsed.shift(); // 跳过表头
      rows = parsed.map((cols) => ({
        subject: cols[0], paper: cols[1], topic: cols[2], difficulty: cols[3],
        type: cols[4], stem: cols[5], options: cols[6], answer: cols[7],
        solution: cols[8], source: cols[9], status: cols[10],
      }));
    } else {
      return fail(res, 400, "请提供 items(JSON 数组)或 csv(文本,含表头)");
    }
    if (rows.length === 0) return fail(res, 400, "没有可导入的数据");

    const task = createImportTask();
    updateImportTask(task.id, { message: `准备导入 ${rows.length} 条...` });
    // 后台执行,不阻塞响应
    runImportTask(task.id, async () => {
      const { imported, errors, created } = await importRows(req, rows, (p, m) =>        updateImportTask(task.id, { progress: Math.round(p * 0.9), message: m })
      );

      // 套题自动组卷
      let papers = [];
      const autoPaper = req.body?.autoPaper !== false;
      if (autoPaper && created.length) {
        updateImportTask(task.id, { progress: 92, message: "识别套题并自动组卷..." });
        papers = await syncAutoPaperSets(created, {
          title: req.body?.paperTitle,
          mode: req.body?.paperMode,
          durationMin: req.body?.paperDurationMin,
          kind: "CUSTOM", // JSON/CSV 粘贴导入 = 自编套题
        });
      }
      const paperMsg = papers.length
        ? `;识别到 ${papers.length} 套题并自动组卷(${papers.map((p) => `${p.title} ${p.total} 题`).join("、")}),需逐题审核通过后学生才可作答`
        : "";
      return {
        imported, failed: errors.length, errors: errors.slice(0, 20), papers, created,
        message: `导入完成:成功 ${imported} 条,失败 ${errors.length} 条${paperMsg}`,
      };
    });
    ok(res, { taskId: task.id });
  })
);

// POST /api/questions/import-file — 上传文件批量导入(Excel/Word/PDF)
// 接收 { filename, data }(data 为 base64,可带 data: 前缀),服务端解析后复用 importRows。
// 任务式:立即返回 { taskId },后台执行,前端轮询进度。
router.post(
  "/import-file",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { filename, data } = req.body || {};
    if (!filename || !data) return fail(res, 400, "请提供 filename 与 data(base64)");
    let buf;
    try {
      const b64 = String(data).includes(",") ? String(data).split(",")[1] : String(data);
      buf = Buffer.from(b64, "base64");
    } catch {
      return fail(res, 400, "data 不是合法的 base64");
    }
    if (buf.length === 0) return fail(res, 400, "文件内容为空");
    if (buf.length > 15 * 1024 * 1024) return fail(res, 400, "文件过大(上限 15MB)");

    const task = createImportTask();
    updateImportTask(task.id, { progress: 2, message: `正在解析文件 ${filename}...` });
    runImportTask(task.id, async () => {
      let rows;
      try {
        rows = await parseImportFile(filename, buf);
      // 老师显式指定的套题名称优先于文件内/视觉模型推断的 paper,作为分组与成卷依据,
      // 保证同一批次的题目归入同一卷、不同名称的批次各自成卷(防止不同套题被错误并卷)。
      if (req.body?.paperTitle) rows = rows.map((r) => ({ ...r, paper: String(req.body.paperTitle).trim() }));
      } catch (e) {
        if (e.message === "VISION_NOT_CONFIGURED") {
          throw new Error(
            "PDF 导入需要配置视觉模型:请在服务器 apps/api/.env 添加 VISION_API_KEY / VISION_BASE_URL / VISION_MODEL 并重启 API"
          );
        }
        throw new Error("解析失败:" + e.message);
      }
      if (!rows.length) throw new Error("未从文件中解析出任何题目(请检查模板/表头)");
      updateImportTask(task.id, { progress: 15, message: `解析出 ${rows.length} 条,开始入库...` });

      const { imported, errors, created } = await importRows(req, rows, (p, m) =>
        updateImportTask(task.id, { progress: 15 + Math.round(p * 0.75), message: m })
      );

      let papers = [];
      const autoPaper = req.body?.autoPaper !== false;
      if (autoPaper && created.length) {
        updateImportTask(task.id, { progress: 92, message: "识别套题并自动组卷..." });
        papers = await syncAutoPaperSets(created, {
          title: req.body?.paperTitle,
          mode: req.body?.paperMode,
          durationMin: req.body?.paperDurationMin,
        });
      }
      const paperMsg = papers.length
        ? `;识别到 ${papers.length} 套题并自动组卷(${papers.map((p) => `${p.title} ${p.total} 题`).join("、")}),需逐题审核通过后学生才可作答`
        : "";
      return {
        imported, failed: errors.length, errors: errors.slice(0, 20), papers, parsed: rows.length, created,
        message: `导入完成:成功 ${imported} 条,失败 ${errors.length} 条${paperMsg}`,
      };
    });
    ok(res, { taskId: task.id });
  })
);

// POST /api/questions/import-pdf — PDF 双文件导入(题目文件 + 可选答案文件)
// body: { filename, data, answerFilename?, answerData? } — base64 编码
//   题目文件:必填,走 parsePdf(视觉模型提取题目,答案页也读但不可靠时留空)
//   答案文件:可选,走 parseAnswerPdf(视觉模型识别答案表 Q21 A / 21. B / Q21 A PHYS → 忽略学科列取字母)
//   匹配规则:按「题号」匹配(优先题目 qno,无 qno 退回位置),并将答案字母映射为选项文本(可判分);
//   字母越界(超出选项数量)视为识别错误,清空交教师审核,避免写入明显错误答案。
router.post(
  "/import-pdf",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { filename, data, answerFilename, answerData } = req.body || {};
    if (!filename || !data) return fail(res, 400, "请提供题目文件 filename 与 data(base64)");
    const toBuf = (b64) => {
      const s = String(b64).includes(",") ? String(b64).split(",")[1] : String(b64);
      return Buffer.from(s, "base64");
    };
    let buf;
    try {
      buf = toBuf(data);
    } catch {
      return fail(res, 400, "题目文件 data 不是合法的 base64");
    }
    if (buf.length === 0) return fail(res, 400, "题目文件内容为空");
    if (buf.length > 15 * 1024 * 1024) return fail(res, 400, "题目文件过大(上限 15MB)");
    let ansBuf = null;
    if (answerData) {
      try {
        ansBuf = toBuf(answerData);
      } catch {
        return fail(res, 400, "答案文件 data 不是合法的 base64");
      }
      if (ansBuf.length === 0) ansBuf = null;
      if (ansBuf && ansBuf.length > 15 * 1024 * 1024) return fail(res, 400, "答案文件过大(上限 15MB)");
    }

    const task = createImportTask();
    updateImportTask(task.id, { progress: 2, message: "正在读取文件..." });
    runImportTask(task.id, async () => {
      // 题目文件解析(视觉模型提取题目)
      updateImportTask(task.id, { progress: 5, message: "正在栅格化 PDF 并识别题目(视觉模型)...这可能需要几十秒" });
      let rows = [];
      let pdfMeta = { corrupt: 0, questionPages: 0 };
      try {
        const parsed = await parsePdf(filename, buf);
        rows = parsed.rows || [];
        pdfMeta = parsed.meta || pdfMeta;
        // 套题名称优先:覆盖视觉模型/文件名推断的 paper,作为分组键(见 import-pdf.js paperFromFilename)
        if (req.body?.paperTitle) rows = rows.map((r) => ({ ...r, paper: String(req.body.paperTitle).trim() }));
      } catch (e) {
        if (e.message === "VISION_NOT_CONFIGURED") {
          throw new Error("PDF 导入需要配置视觉模型:请在服务器 apps/api/.env 添加 VISION_API_KEY / VISION_BASE_URL / VISION_MODEL 并重启 API");
        }
        throw new Error("题目文件解析失败:" + e.message);
      }
      if (!rows.length) throw new Error("未从题目文件解析出任何题目");

      // 答案文件:提取 {question, answer} 按题号升序;按「题号匹配」(优先 qno)赋值,避免位置错位
      let ansMatched = 0;
      let ansCleared = 0; // 越界字母清空计数
      let ansExpected = 0; // 答案文件题数(用于漏题交叉校验)
      if (ansBuf) {
        updateImportTask(task.id, { progress: 60, message: "正在识别答案文件..." });
        let answers = [];
        try {
          answers = await parseAnswerPdf(answerFilename || "answers.pdf", ansBuf);
        } catch (e) {
          throw new Error("答案文件解析失败:" + e.message);
        }
        ansExpected = answers.length;
        // 题号(1-based)→ 答案字母 映射
        const ansByQ = new Map();
        for (const a of answers) {
          const q = parseInt(String(a?.question ?? "").replace(/^0+/, ""), 10);
          const letter = String(a?.answer ?? "").trim();
          if (Number.isFinite(q) && q > 0 && letter) ansByQ.set(q, letter);
        }
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          // 优先按题目 qno 匹配;无 qno 时退回「第 i+1 题 ↔ 题号 i+1」位置匹配
          const qKey = r.qno != null ? Number(r.qno) : i + 1;
          const letter = ansByQ.get(qKey);
          if (!letter) continue;
          const opts = Array.isArray(r.options) ? r.options : [];
          // 越界防护:字母索引超出选项数量(如 5 个选项却给 G)→ 视为识别错误,清空交教师补
          if (/^[A-Ha-h]$/.test(letter) && letter.toUpperCase().charCodeAt(0) - 65 >= opts.length) {
            r.answer = "";
            ansCleared++;
            continue;
          }
          const mapped = mapAnswerToOptionText(letter, r.options);
          if (mapped) {
            r.answer = mapped; // 字母→选项文本(可判分),或本来就是选项文本
            ansMatched++;
          }
        }
      }

      const { imported, errors, created } = await importRows(req, rows, (p, m) =>
        updateImportTask(task.id, { progress: 65 + Math.round(p * 0.27), message: m })
      );

      let papers = [];
      const autoPaper = req.body?.autoPaper !== false;
      if (autoPaper && created.length) {
        updateImportTask(task.id, { progress: 94, message: "识别套题并自动组卷..." });
        papers = await syncAutoPaperSets(created, {
          title: req.body?.paperTitle,
          mode: req.body?.paperMode,
          durationMin: req.body?.paperDurationMin,
          kind: "OFFICIAL", // PDF 双文件导入 = 官方原版套题
        });
      }
      const ansMsg = ansBuf
        ? `;答案文件匹配 ${ansMatched} 题${ansCleared ? `,${ansCleared} 题答案字母越界已清空待审` : ""}${ansMatched + ansCleared < rows.length ? `(${rows.length - ansMatched - ansCleared} 题未匹配,需审核页补充)` : ""}`
        : ";未提供答案文件,答案留空,需在审核页手动补充";
      // 漏题/并题预警:把"疑似丢题"直接暴露给教师,避免静默导入不完整题库
      let lostMsg = "";
      if (pdfMeta.corrupt) lostMsg += `;${pdfMeta.corrupt} 题选项异常(疑似多题合并)已跳过`;
      if (pdfMeta.questionPages && pdfMeta.questionPages > rows.length + 2) {
        lostMsg += `;题目页 ${pdfMeta.questionPages} 页但仅识别 ${rows.length} 题,可能漏题(建议核对原卷后重新导入)`;
      }
      if (ansExpected > rows.length) {
        lostMsg += `;答案文件有 ${ansExpected} 题,但仅识别出 ${rows.length} 题,疑似漏题`;
      }
      const paperMsg = papers.length
        ? `;识别到 ${papers.length} 套题并自动组卷(${papers.map((p) => `${p.title} ${p.total} 题`).join("、")}),需逐题审核通过后学生才可作答`
        : "";
      return {
        imported, failed: errors.length, errors: errors.slice(0, 20), papers, parsed: rows.length, created, answerMatched: ansMatched, corrupt: pdfMeta.corrupt,
        message: `导入完成:成功 ${imported} 条,失败 ${errors.length} 条${ansMsg}${lostMsg}${paperMsg}`,
      };
    });
    ok(res, { taskId: task.id });
  })
);

// POST /api/questions/import-image — 图片识别单题录入(老师/管理员)
// body: { data: 图片 base64(可带 data: 前缀), subject?: 科目提示, paperTitle?: 套题名 }
// 视觉模型识别 → 归一化(科目、选项清洗、答案字母→选项文本对齐)→ 返回题目字段,前端核对后保存
router.post(
  "/import-image",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { data, subject, paperTitle } = req.body || {};
    if (!data || typeof data !== "string") return fail(res, 400, "请提供图片 data(base64)");
    const b64 = String(data).includes(",") ? String(data).split(",")[1] : String(data);
    const buf = Buffer.from(b64, "base64");
    if (!buf.length) return fail(res, 400, "图片内容为空");
    if (buf.length > 6 * 1024 * 1024) return fail(res, 400, "图片过大(上限 6MB)");

    let raw;
    try {
      raw = await extractQuestionFromImage(String(data));
    } catch (e) {
      if (e.message === "VISION_NOT_CONFIGURED") {
        return fail(res, 400, "图片识别需要配置视觉模型:请在服务器 apps/api/.env 添加 VISION_API_KEY / VISION_BASE_URL / VISION_MODEL 并重启 API");
      }
      return fail(res, 500, "图片识别失败:" + e.message);
    }

    // 归一化:科目(题源词→sourceType,TMUA/ESAT→数学)、选项清洗、答案对齐(字母→选项文本)
    const rawSubj = String(raw.subject || "").trim();
    const isSource = /^(TMUA|ESAT|NSAA|BMAT|STEP|MAT|PAT|ENGAA|SMC)$/i.test(rawSubj);
    const sourceType = isSource ? rawSubj.toUpperCase() : null;
    const normSubject =
      String(subject || "").trim() ||
      (isSource ? "数学" : normalizeSubject(rawSubj)) ||
      "数学";
    const options = Array.isArray(raw.options)
      ? raw.options.map((o) => normalizeNewlines(cleanOptionPrefix(cleanUnits(String(o))))).filter(Boolean)
      : [];
    const result = {
      subject: normSubject,
      sourceType,
      paper: paperTitle || raw.paper || null,
      topic: String(raw.topic || "").trim(),
      difficulty: Number(raw.difficulty) || 3,
      type: String(raw.type || "SINGLE_CHOICE"),
      stem: normalizeNewlines(cleanUnits(String(raw.stem || ""))).trim(),
      options,
      answer: alignAnswerToOptions(raw.answer, options),
      solution: raw.solution ? normalizeNewlines(String(raw.solution)).trim() : null,
      status: "PENDING_REVIEW",
    };
    if (!result.stem || options.length < 2) {
      return fail(res, 422, "未能从图片中识别出完整题目(题干或选项不足),请换更清晰的图片重试");
    }
    ok(res, result, "识别成功,请核对后保存");
  })
);

// GET /api/questions/import-task/:taskId — 轮询导入任务进度(任务式导入用)
// 返回题库中所有已出现的题源(去重),供前端下拉提示;缺失时返回空数组
router.get(
  "/source-types",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const rows = await prisma.question.groupBy({ by: ["sourceType"], where: { sourceType: { not: null } } });
    const list = rows.map((r) => r.sourceType).filter(Boolean).sort();
    ok(res, { list });
  })
);

router.get(
  "/import-task/:taskId",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const t = getImportTask(req.params.taskId);
    if (!t) return fail(res, 404, "导入任务不存在或已过期");
    ok(res, { id: t.id, status: t.status, progress: t.progress, message: t.message, result: t.result, error: t.error });
  })
);

// 列表查询公共逻辑
function buildWhere(query, user) {
  const where = {};
  Object.assign(where, buildSubjectFilter(query.subject));
  // 多学科过滤(subjects=a,b,c),用于学科 Tab(如数学 tab 包含 TMUA)
  if (query.subjects) {
    const subs = String(query.subjects).split(",").map((s) => s.trim()).filter(Boolean);
    if (subs.length) where.subject = { in: subs };
  }
  if (query.topic) where.topic = { contains: query.topic };
  // 题源/试卷类型过滤(TMUA/ESAT/NSAA...)
  // ESAT 家族展开:筛选 ESAT 时同时命中 ENGAA / NSAA 的题(不改数据库原始值)
  if (query.sourceType) {
    const t = String(query.sourceType).trim();
    where.sourceType = { in: expandSourceType(t).length ? expandSourceType(t) : [t] };
  }
  // 搜题:按题干关键词搜索(含公式/LaTeX 原文片段)
  const q = String(query.q || "").trim();
  if (q) where.stem = { contains: q };
  if (query.difficulty) where.difficulty = Number(query.difficulty);
  if (query.paper) where.paper = query.paper;
  if (query.knowledgePointId) where.topicIds = { contains: String(query.knowledgePointId) };
  // 学生只能看到已发布题目;老师/管理员不带 status 时默认显示全部状态(含待审核/草稿/已退回)
  if (user.role === "STUDENT") {
    where.status = "PUBLISHED";
  } else if (query.status) {
    where.status = query.status;
  }
  // 教师可见范围权限:仅当 role=TEACHER 且配置了白名单时,将列表限制为白名单内
  applyTeacherPerms(where, user);
  return where;
}

// GET /api/questions — 题目列表(筛选 + 分页)
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.min(50, Math.max(1, Number(req.query.pageSize) || 20));
    const where = buildWhere(req.query, req.user);
    // paperId:只看某张试卷内的题目(老师从试卷管理跳转到审核队列时使用)
    if (req.query.paperId) {
      const p = await prisma.paper.findUnique({ where: { id: String(req.query.paperId) } });
      if (!p) return fail(res, 404, "试卷不存在");
      where.id = { in: parseIds(p) };
      // 老师查看整卷时默认要看到各种状态(否则默认只回 PUBLISHED,审核进度就看不见了)
      if (req.user.role !== "STUDENT" && !req.query.status) delete where.status;
    }
    // 老师/管理员要在列表上直接审核与一键修正,需要答案、解析和退回意见;学生仍只拿公共字段
    const isTeacher = ["TEACHER", "ADMIN"].includes(req.user.role);
    const select = isTeacher
      ? { ...PUBLIC_FIELDS, answer: true, solution: true, reviewNote: true, reviewedAt: true, autoFixLog: true }
      : PUBLIC_FIELDS;
    // 排序:?sort=difficulty|createdAt + ?order=asc|desc;默认最新在前(按试卷审核时按录入顺序)
    let orderBy;
    const dir = req.query.order === "asc" ? "asc" : "desc";
    if (req.query.sort === "difficulty") orderBy = [{ difficulty: dir }, { createdAt: "desc" }];
    else if (req.query.sort === "createdAt") orderBy = { createdAt: dir };
    else orderBy = req.query.paperId ? { createdAt: "asc" } : { createdAt: "desc" };
    const [list, total] = await Promise.all([
      prisma.question.findMany({
        where,
        select,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.question.count({ where }),
    ]);
    // 附带各题知识点名称(按 topicIds 解析)
    const allIds = [...new Set(list.flatMap((q) => parseJsonIds(q.topicIds)))];
    const kps = allIds.length ? await prisma.knowledgePoint.findMany({ where: { id: { in: allIds } }, select: { id: true, name: true } }) : [];
    const kpNameById = new Map(kps.map((k) => [k.id, k.name]));
    const enriched = list.map((q) => ({ ...q, topicIds: parseJsonIds(q.topicIds), topics: parseJsonIds(q.topicIds).map((id) => kpNameById.get(id)).filter(Boolean) }));
    ok(res, { list: enriched, total, page, pageSize });
  })
);

// GET /api/questions/:id — 题目详情
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!q) return fail(res, 404, "题目不存在");
    if (q.status !== "PUBLISHED" && req.user.role === "STUDENT") return fail(res, 404, "题目不存在");
    ok(res, { ...q, topicIds: parseJsonIds(q.topicIds), topics: await resolveTopics(q.topicIds) });
  })
);

// POST /api/questions — 创建题目(老师/管理员)
router.post(
  "/",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { subject, sourceType, paper, topic, topicIds, difficulty, type, stem, options, answer, solution, source, status } = req.body || {};
    if ((!subject && !sourceType) || !topic || !stem || !options || !answer) {
      return fail(res, 400, "subject(或 sourceType)、topic、stem、options、answer 必填");
    }
    if (!Array.isArray(options) || options.length < 2) return fail(res, 400, "options 至少 2 个选项");
    const kp = await normalizeTopicInput({ subject: subject || "", topic, topicIds });
    const q = await prisma.question.create({
      data: {
        subject,
        sourceType: sourceType || null,
        paper: paper || null,
        topic: kp.topic,
        topicIds: JSON.stringify(kp.topicIds),
        difficulty: difficulty || 3,
        type: type || "SINGLE_CHOICE",
        stem: normalizeNewlines(cleanUnits(stem)),
        options: JSON.stringify(options.map((o) => normalizeNewlines(cleanOptionPrefix(cleanUnits(String(o)))))),
        answer: normalizeNewlines(String(answer)),
        solution: solution ? normalizeNewlines(solution) : null,
        source: source || null,
        status: status || "PENDING_REVIEW",
        createdBy: req.user.id,
      },
    });
    // 单题录入也参与套题归并:同 subject+paper+source 的题攒够 2 道就自动成卷
    let papers = [];
    if (q.paper && req.body?.autoPaper !== false) {
      papers = await syncAutoPaperSets([{ id: q.id, subject: q.subject, sourceType: q.sourceType, paper: q.paper, source: q.source }]);
    }
    const msg = papers.length ? `创建成功;已归入套题试卷「${papers[0].title}」(共 ${papers[0].total} 题)` : "创建成功";
    ok(res, { ...q, papers, topicIds: parseJsonIds(q.topicIds), topics: await resolveTopics(q.topicIds) }, msg);
  })
);

// PUT /api/questions/:id — 更新题目(老师/管理员)
router.put(
  "/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    const b = req.body || {};
    const data = {};
    for (const key of ["subject", "paper", "topic", "difficulty", "type", "stem", "answer", "solution", "source", "status"]) {
      if (b[key] === undefined) continue;
      if (key === "options") continue;
      if (key === "stem" || key === "answer") data[key] = normalizeNewlines(String(b[key]));
      else if (key === "solution") data[key] = b[key] ? normalizeNewlines(String(b[key])) : b[key];
      else data[key] = b[key];
    }
    // 题源类型:独立字段,可设 null 清空
    if (b.sourceType !== undefined) data.sourceType = b.sourceType ? String(b.sourceType).trim() : null;
    if (b.options !== undefined) {
      if (!Array.isArray(b.options) || b.options.length < 2) return fail(res, 400, "options 至少 2 个选项");
      data.options = JSON.stringify(b.options.map((o) => normalizeNewlines(cleanOptionPrefix(o))));
    }
    // 知识点:传了 topicIds 数组则按库归类并同步 topic;只传 topic 则自动匹配(可清空:传空数组)
    if (b.topicIds !== undefined) {
      if (!Array.isArray(b.topicIds)) return fail(res, 400, "topicIds 必须是数组");
      const kp = await normalizeTopicInput({ subject: b.subject ?? existed.subject, topic: b.topic ?? existed.topic, topicIds: b.topicIds });
      data.topicIds = JSON.stringify(kp.topicIds);
      data.topic = kp.topic;
    } else if (b.topic !== undefined && b.topicIds === undefined) {
      const kp = await normalizeTopicInput({ subject: b.subject ?? existed.subject, topic: b.topic, topicIds: undefined });
      data.topicIds = JSON.stringify(kp.topicIds);
      data.topic = kp.topic;
    }
    // 铁律:缺答案的题不能发布——编辑时清空答案且题处于(或将被置为)发布状态,一律拒绝
    const finalAnswer = b.answer !== undefined ? String(b.answer).trim() : String(existed.answer || "").trim();
    const finalStatus = b.status || existed.status;
    if (finalStatus === "PUBLISHED" && !finalAnswer) {
      return fail(res, 400, "缺答案的题目不能发布。请补充答案,或先把状态改为非发布状态(如草稿/待审核)。");
    }
    const q = await prisma.question.update({ where: { id: req.params.id }, data });
    // 状态可能被手动改动,同步刷新所在试卷的就绪度
    if (data.status !== undefined) await recalcPapersOfQuestion(q.id);
    ok(res, { ...q, topicIds: parseJsonIds(q.topicIds), topics: await resolveTopics(q.topicIds) }, "更新成功");
  })
);

// POST /api/questions/:id/review — 老师审核(通过/驳回)
// body: { action: "approve" | "reject", note?: string }
//   approve → PUBLISHED(学生可见)
//   reject  → REJECTED(退回修改)
router.post(
  "/:id/review",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    const { action, note } = req.body || {};
    if (action !== "approve" && action !== "reject") {
      return fail(res, 400, "action 必须是 approve 或 reject");
    }
    // 铁律:缺答案的题一定不能发布(学生答题依赖 answer 判分)。PDF 导入允许 answer 暂缺,老师补全前不可通过审核。
    if (action === "approve" && !String(existed.answer || "").trim()) {
      return fail(res, 400, "该题缺少答案,不能发布。请先点「编辑」补充答案后再审核通过。");
    }
    const data = {
      status: action === "approve" ? "PUBLISHED" : "REJECTED",
      reviewNote: note ?? null,
      reviewedBy: req.user.id,
      reviewedAt: new Date(),
    };
    const q = await prisma.question.update({ where: { id: req.params.id }, data });
    // 该题所在的套题卷可能因此从「有未审核题」变为「全部通过」,重算就绪度
    const papers = await recalcPapersOfQuestion(q.id);
    const becameReady = papers.filter((p) => p.status === "READY");
    let msg = action === "approve" ? "已通过审核,题目已发布" : "已驳回,题目退回修改";
    if (becameReady.length) msg += `;所在试卷已全部审核完毕,学生现在可以作答`;
    ok(res, { ...q, papers }, msg);
  })
);

// POST /api/questions/:id/autofix — 一键按退回原因自动修正
// body: { apply?: boolean, resubmit?: boolean }
//   apply=false(默认) → 只返回修正方案与前后对比,不落库,供老师确认
//   apply=true        → 落库;resubmit=true 时同时重新提交审核(REJECTED → PENDING_REVIEW)
router.post(
  "/:id/autofix",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const q = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!q) return fail(res, 404, "题目不存在");
    const plan = planAutoFix(q);
    const apply = req.body?.apply === true;
    const resubmit = req.body?.resubmit !== false; // 落库时默认重新提交审核

    if (!apply) {
      return ok(res, { id: q.id, reviewNote: q.reviewNote, applied: false, ...plan }, describePlan(plan));
    }
    if (Object.keys(plan.patch).length === 0 && !resubmit) {
      return ok(res, { id: q.id, applied: false, ...plan }, "没有可自动修正的内容");
    }

    const data = { ...plan.patch };
    let solutionGenerated = false;
    const missingSol = !q.solution || !String(q.solution).trim();
    if (missingSol) {
      const sol = await tryGenerateSolution(q);
      if (sol) { data.solution = sol; solutionGenerated = true; }
    }
    if (resubmit) {
      // 修正后重新排队审核;保留原退回意见到修正日志里,便于复核时对照
      data.status = "PENDING_REVIEW";
      data.reviewNote = null;
      data.reviewedAt = null;
      data.reviewedBy = null;
    }
    const manual = solutionGenerated
      ? plan.manual.filter((m) => m.code !== "missing_solution")
      : plan.manual;
    data.autoFixLog = JSON.stringify({
      at: new Date().toISOString(),
      by: req.user.id,
      fromNote: q.reviewNote || null,
      fixes: plan.fixes.map((f) => ({ code: f.code, field: f.field, targeted: !!f.targeted })),
      manual,
      remaining: plan.remaining,
      solutionGenerated: solutionGenerated || undefined,
    });
    const updated = await prisma.question.update({ where: { id: q.id }, data });
    await recalcPapersOfQuestion(q.id);
    return ok(
      res,
      { id: updated.id, applied: true, status: updated.status, ...plan, manual },
      `${describePlan(plan)}${solutionGenerated ? ",已自动生成解析" : ""}${resubmit ? ",已重新提交审核" : ""}`
    );
  })
);

// POST /api/questions/autofix/batch — 批量一键修正(默认处理全部已退回题目)
// body: { ids?: string[], status?: string, apply?: boolean, resubmit?: boolean, onlyClean?: boolean }
//   onlyClean=true(默认):只有修完能通过体检的题才重新提交审核,仍有问题的留在退回列表等人工处理
router.post(
  "/autofix/batch",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { ids, status = "REJECTED", apply = false, resubmit = true, onlyClean = true } = req.body || {};
    const where = Array.isArray(ids) && ids.length ? { id: { in: ids } } : { status };
    const rows = await prisma.question.findMany({ where, take: 200 });
    if (rows.length === 0) return fail(res, 400, "没有符合条件的题目");

    const items = [];
    let fixedCount = 0;
    let resubmitted = 0;
    for (const q of rows) {
      const plan = planAutoFix(q);
      const hasPatch = Object.keys(plan.patch).length > 0;
      const willResubmit = resubmit && (plan.clean || !onlyClean);
        if (apply && (hasPatch || willResubmit || ((!q.solution || !String(q.solution).trim()) && llmConfigured()))) {
          const data = { ...plan.patch };
          let solutionGenerated = false;
          if (!q.solution || !String(q.solution).trim()) {
            const sol = await tryGenerateSolution(q);
            if (sol) { data.solution = sol; solutionGenerated = true; }
          }
          if (willResubmit) {
            data.status = "PENDING_REVIEW";
            data.reviewNote = null;
            data.reviewedAt = null;
            data.reviewedBy = null;
          }
          const manual = solutionGenerated
            ? plan.manual.filter((m) => m.code !== "missing_solution")
            : plan.manual;
          data.autoFixLog = JSON.stringify({
            at: new Date().toISOString(),
            by: req.user.id,
            fromNote: q.reviewNote || null,
            fixes: plan.fixes.map((f) => ({ code: f.code, field: f.field, targeted: !!f.targeted })),
            manual,
            remaining: plan.remaining,
            solutionGenerated: solutionGenerated || undefined,
          });
        await prisma.question.update({ where: { id: q.id }, data });
        await recalcPapersOfQuestion(q.id);
        if (hasPatch) fixedCount++;
        if (willResubmit) resubmitted++;
      } else if (hasPatch) {
        fixedCount++;
      }
      items.push({
        id: q.id,
        stem: String(q.stem || "").slice(0, 60),
        reviewNote: q.reviewNote,
        fixCount: plan.fixes.length,
        fixes: plan.fixes.map((f) => ({ code: f.code, label: f.label, field: f.field, targeted: !!f.targeted })),
        manual: plan.manual,
        remaining: plan.remaining,
        clean: plan.clean,
        willResubmit,
      });
    }
    const stuck = items.filter((i) => !i.clean).length;
    ok(
      res,
      { total: rows.length, fixedCount, resubmitted, stuck, applied: apply, items },
      apply
        ? `已修正 ${fixedCount} 道,重新提交审核 ${resubmitted} 道${stuck ? `,${stuck} 道仍需人工处理` : ""}`
        : `体检完成:${fixedCount} 道可自动修正${stuck ? `,${stuck} 道存在需人工处理的问题` : ""}`
    );
  })
);

// POST /api/questions/:id/generate-solution — AI 生成结构化解析草稿
router.post(
  "/:id/generate-solution",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    if (!llmConfigured()) {
      return fail(res, 400, "服务端未配置 LLM_API_KEY,无法生成解析。请在 .env 配置 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL。");
    }
    const q = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!q) return fail(res, 404, "题目不存在");

    const prompt = buildSolutionPrompt({
      stem: q.stem,
      options: safeParseOptions(q.options),
      answer: q.answer,
      topic: q.topic,
    });

    let raw;
    try {
      raw = await chatComplete({
        system:
          "You are an experienced tutor for UK university admissions mathematics tests (TMUA, ESAT, etc.). Provide a clear, rigorous, student-friendly solution explanation for the given question. " +
          "Write the entire explanation **in English** as plain text with simple line breaks. Cover three parts: Solution Steps, Knowledge Points Tested, and Common Pitfalls. " +
          "Do NOT use Markdown syntax: no ## headings, no - bullet lists, no ** bold**, no # symbols. " +
          "Formula rules: use only $...$ for inline math and $$...$$ for display math; do NOT use \\(...\\), \\[...\\], \\text{...}, \\begin{...}, or \\\\ inside math. Keep formulas simple and valid LaTeX (e.g. $x^2 - 5x + 6 = 0$, $\\frac{1}{2}$). " +
          "Output only the solution content, no greetings.",
        user: prompt,
        temperature: 0.2,
        maxTokens: 900,
      });
    } catch (e) {
      return fail(res, e.code === "LLM_NOT_CONFIGURED" ? 400 : 502, e.message || "LLM 调用失败");
    }

    const solution = cleanSolution(raw);
    if (!solution) return fail(res, 502, "LLM 返回内容为空,请重试");

    // 写入 solution;若题目当前不在审核态,则置为 PENDING_REVIEW 进入审核队列由老师确认
    const data = { solution };
    if (q.status !== "PENDING_REVIEW" && q.status !== "REJECTED") {
      data.status = "PENDING_REVIEW";
      data.reviewNote = null;
      data.reviewedAt = null;
      data.reviewedBy = null;
    }
    data.autoFixLog = JSON.stringify({
      at: new Date().toISOString(),
      by: req.user.id,
      action: "generate-solution",
      model: llmInfo().model,
      previousSolution: q.solution || null,
    });
    const updated = await prisma.question.update({ where: { id: q.id }, data });
    await recalcPapersOfQuestion(q.id);
    ok(res, { id: q.id, solution: updated.solution, status: updated.status }, "已生成解析,请老师在审核中确认后发布");
  })
);

// POST /api/questions/:id/fix — 用 question-fixer skill(LLM)按退回原因语义重调
// body: { apply?: boolean, resubmit?: boolean }
//   apply=false(默认) → 只返回 AI 修正预览(前后对比 + changes + 体检结果),不落库
//   apply=true        → 落库;resubmit=true(默认)时置 PENDING_REVIEW 重新提交审核,写 autoFixLog
// 未配置 LLM 时返回 400(由前端 AI 按钮禁用兜底)
router.post(
  "/:id/fix",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const q = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!q) return fail(res, 404, "题目不存在");
    const apply = req.body?.apply === true;
    const resubmit = req.body?.resubmit !== false;

    let result;
    try {
      result = await planSkillFix(q);
    } catch (e) {
      return fail(res, e.code === "LLM_NOT_CONFIGURED" ? 400 : 502, e.message || "AI 修正失败");
    }

    if (!apply) {
      return ok(res, { id: q.id, reviewNote: q.reviewNote, applied: false, ...result }, "AI 修正预览,请核对后应用");
    }

    const data = {
      stem: result.fixed.stem,
      options: JSON.stringify(result.fixed.options),
      answer: result.fixed.answer,
      solution: result.fixed.solution,
    };
    if (resubmit) {
      data.status = "PENDING_REVIEW";
      data.reviewNote = null;
      data.reviewedAt = null;
      data.reviewedBy = null;
    }
    data.autoFixLog = JSON.stringify({
      at: new Date().toISOString(),
      by: req.user.id,
      action: "ai-fix",
      fromNote: q.reviewNote || null,
      changes: result.changes,
      remaining: result.remaining,
      model: result.model,
    });
    const updated = await prisma.question.update({ where: { id: q.id }, data });
    await recalcPapersOfQuestion(q.id);
    const tail = result.remaining.length ? `,但仍有 ${result.remaining.length} 处需人工复核` : "";
    ok(
      res,
      { id: updated.id, applied: true, status: updated.status, ...result },
      `已应用 AI 修正${resubmit ? ",已重新提交审核" : ""}${tail}`
    );
  })
);

function describePlan(plan) {
  if (plan.fixes.length === 0 && plan.manual.length === 0) return "该题未检出可修正的问题";
  const parts = [];
  if (plan.fixes.length) parts.push(`可自动修正 ${plan.fixes.length} 处`);
  if (plan.manual.length) parts.push(`${plan.manual.length} 处需人工处理`);
  return parts.join(",");
}

// DELETE /api/questions/:id — 删除题目(教师/管理员)
// 联动清理:该题的作答记录、错题本条目、各试卷 questionIds 中的引用,再物理删除,
// 避免 FK 约束报错与试卷内悬空引用。
router.delete(
  "/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    const qid = req.params.id;
    // FK 限制:先删该题的作答记录与错题本条目
    await prisma.answerRecord.deleteMany({ where: { questionId: qid } });
    await prisma.wrongBook.deleteMany({ where: { questionId: qid } });
    // 从所有试卷的 questionIds 中移除该题引用
    const papers = await prisma.paper.findMany({ where: { questionIds: { contains: qid } }, select: { id: true, questionIds: true } });
    for (const p of papers) {
      const next = parseIds(p).filter((id) => id !== qid);
      await prisma.paper.update({ where: { id: p.id }, data: { questionIds: JSON.stringify(next) } });
    }
    await prisma.question.delete({ where: { id: qid } });
    // 重算受影响的试卷状态(可能因此退回 DRAFT)
    await recalcPapersOfQuestion(qid);
    ok(res, null, "删除成功");
  })
);

export default router;
