// 语言学习模块路由(雅思/其他语言)——完全独立于学科题库
// 所有数据表均带 Language 前缀,不与 Question/Paper/Session 冲突
import { Router } from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { rasterize } from "../lib/import-pdf.js";
import { extractReadingPassagesFromPdfPages } from "../lib/vision.js";
import { createImportTask, updateImportTask, finishImportTask, failImportTask, getImportTask } from "../lib/import-task.js";
import { getUploadDir } from "../lib/upload-dir.js";

const router = Router();

// —— 工具 ——

// 雅思听/读客观题 原始分(40 题) → Band 官方换算表(学术类通用近似表)
// 映射:题数 -> Band(0.5 进制)。正式机考每套卷微调,此处用官方主流换算
const LISTENING_BAND = [
  40, 39, 37, 35, 32, 30, 26, 23, 18, 16, 13, 10,
].map((raw, idx) => ({ raw, band: 9 - idx * 0.5 }));
function bandOf(rawScore, maxScore) {
  if (!maxScore || maxScore <= 0) return null;
  const rate = rawScore / maxScore;
  // 按比例折算到 40 题量纲,再查表
  const raw40 = Math.round(rate * 40);
  const table = LISTENING_BAND;
  for (const row of table) {
    if (raw40 >= row.raw) return row.band;
  }
  return 1.0;
}

// 雅思客观题判分(填空/单选/多选/判断/配对/标题)
// 填空:答案可多写用 | 分隔,忽略大小写与首尾空格,容错复数(±s)与连字符
function isAnswerCorrect(question, selected) {
  if (selected === undefined || selected === null || String(selected).trim() === "") return false;
  const q = question.qType;
  const sel = String(selected).trim();
  const expect = String(question.answer || "").trim();
  if (!expect) return false;

  if (q === "FILL_BLANK") {
    const accepted = expect.split("|").map((s) => s.trim().toLowerCase()).filter(Boolean);
    const variants = (s) => {
      const out = new Set([s]);
      if (s.endsWith("s")) out.add(s.slice(0, -1));
      else out.add(s + "s");
      return [...out];
    };
    const selVar = variants(sel.replace(/[-–—]/g, "").toLowerCase());
    for (const acc of accepted) {
      const accNorm = acc.replace(/[-–—]/g, "");
      if (selVar.includes(accNorm)) return true;
      for (const v of selVar) {
        if (accNorm === v) return true;
      }
    }
    return false;
  }
  // 判断 T/F/NG、单选、多选、配对、标题:直接比对字母(大写归一)
  return expect.toLowerCase() === sel.toLowerCase();
}

function parseOptions(options) {
  if (!options) return [];
  try {
    const v = JSON.parse(options);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function parseIds(s) {
  try {
    const v = JSON.parse(s || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

const Q_FIELDS = {
  id: true, examType: true, skill: true, qType: true, part: true, groupTitle: true,
  stem: true, options: true, answer: true, solution: true, audioUrl: true,
  materialId: true, wordLimit: true, difficulty: true, status: true, reviewNote: true,
  createdAt: true, updatedAt: true,
};

function fmtQ(q) {
  return { ...q, options: parseOptions(q.options) };
}

// 音频上传目录:本地默认 apps/web/public/uploads;生产可用环境变量 UPLOAD_DIR 指向 Nginx 托管目录

// POST /api/language/upload-audio — 教师上传听力/口语音频(仅教师/管理员)
router.post(
  "/upload-audio",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { filename, data } = req.body || {};
    if (!data || typeof data !== "string") return fail(res, 400, "缺少音频数据");
    const m = /^data:audio\/([a-zA-Z0-9+.-]+);base64,(.+)$/s.exec(data);
    let b64 = data;
    let ext = "mp3";
    if (m) {
      const mime = m[1].toLowerCase();
      if (mime === "mpeg" || mime === "mp3") ext = "mp3";
      else if (mime === "wav") ext = "wav";
      else if (mime === "ogg" || mime === "oga") ext = "ogg";
      else if (mime === "webm") ext = "webm";
      else if (mime === "mp4") ext = "m4a";
      else return fail(res, 400, "不支持的音频格式(仅 mp3 / wav / ogg / webm / m4a)");
      b64 = m[2];
    } else {
      const fe = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
      if (!fe || !["mp3", "wav", "ogg", "oga", "webm", "m4a", "mp4"].includes(fe[1])) {
        return fail(res, 400, "不支持的音频格式(仅 mp3 / wav / ogg / webm / m4a)");
      }
      ext = fe[1] === "oga" ? "ogg" : fe[1] === "mp4" ? "m4a" : fe[1];
    }
    let buf;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      return fail(res, 400, "音频解码失败");
    }
    if (!buf.length) return fail(res, 400, "音频内容为空");
    if (buf.length > 20 * 1024 * 1024) return fail(res, 400, "音频过大,上限 20MB");

    const name = crypto.randomBytes(12).toString("hex") + "." + ext;
    fs.writeFileSync(path.join(getUploadDir(), name), buf);
    ok(res, { url: "/uploads/" + name, filename: name });
  })
);

// POST /api/language/upload-recording — 学生口语音频上传(所有登录用户)
router.post(
  "/upload-recording",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { filename, data } = req.body || {};
    if (!data || typeof data !== "string") return fail(res, 400, "缺少音频数据");
    const m = /^data:audio\/([a-zA-Z0-9+.-]+);base64,(.+)$/s.exec(data);
    let b64 = data;
    let ext = "webm";
    if (m) {
      const mime = m[1].toLowerCase();
      if (mime === "mpeg" || mime === "mp3") ext = "mp3";
      else if (mime === "wav") ext = "wav";
      else if (mime === "ogg" || mime === "oga") ext = "ogg";
      else if (mime === "webm") ext = "webm";
      else if (mime === "mp4") ext = "m4a";
      else return fail(res, 400, "不支持的音频格式");
      b64 = m[2];
    } else {
      const fe = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
      if (!fe || !["mp3", "wav", "ogg", "webm", "m4a", "mp4"].includes(fe[1])) {
        return fail(res, 400, "不支持的音频格式");
      }
      ext = fe[1] === "oga" ? "ogg" : fe[1] === "mp4" ? "m4a" : fe[1];
    }
    let buf;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      return fail(res, 400, "音频解码失败");
    }
    if (!buf.length) return fail(res, 400, "音频内容为空");
    if (buf.length > 20 * 1024 * 1024) return fail(res, 400, "音频过大,上限 20MB");

    const name = crypto.randomBytes(12).toString("hex") + "." + ext;
    fs.writeFileSync(path.join(getUploadDir(), name), buf);
    ok(res, { url: "/uploads/" + name, filename: name });
  })
);

// —— 语言题库 ——

// GET /api/language/questions?examType=&skill=&status=&q=
// 学生只读已发布;教师可按状态/搜索
router.get(
  "/questions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { examType, skill, status, q } = req.query;
    const where = {};
    if (examType) where.examType = String(examType);
    if (skill) where.skill = String(skill);
    if (req.user.role === "STUDENT") {
      where.status = "PUBLISHED";
    } else if (status) {
      where.status = String(status);
    }
    if (q) {
      const kw = String(q).trim();
      where.OR = [{ stem: { contains: kw } }, { groupTitle: { contains: kw } }];
    }
    const list = await prisma.languageQuestion.findMany({
      where,
      select: Q_FIELDS,
      orderBy: [{ part: "asc" }, { createdAt: "asc" }],
    });
    ok(res, { list: list.map(fmtQ), total: list.length });
  })
);

// POST /api/language/questions — 新增语言题(教师/管理员)
router.post(
  "/questions",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!b.examType || !b.skill || !b.qType || !b.stem) return fail(res, 400, "examType、skill、qType、stem 必填");
    if (b.skill === "WRITING" && b.qType !== "TASK1" && b.qType !== "TASK2") return fail(res, 400, "写作题 qType 仅支持 TASK1/TASK2");
    const q = await prisma.languageQuestion.create({
      data: {
        examType: b.examType,
        skill: b.skill,
        qType: b.qType,
        part: b.part ? Number(b.part) : null,
        groupTitle: b.groupTitle ? String(b.groupTitle) : null,
        stem: String(b.stem),
        options: Array.isArray(b.options) ? JSON.stringify(b.options) : null,
        answer: b.answer !== undefined && b.answer !== null && b.answer !== "" ? String(b.answer) : null,
        solution: b.solution ? String(b.solution) : null,
        audioUrl: b.audioUrl ? String(b.audioUrl) : null,
        materialId: b.materialId || null,
        wordLimit: b.wordLimit ? Number(b.wordLimit) : null,
        difficulty: Number(b.difficulty) || 3,
        status: b.status || "PENDING_REVIEW",
        createdBy: req.user.id,
      },
    });
    ok(res, fmtQ(q), "创建成功");
  })
);

// PUT /api/language/questions/:id — 更新语言题(教师/管理员)
router.put(
  "/questions/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageQuestion.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    const b = req.body || {};
    const data = {};
    for (const key of ["examType", "skill", "qType", "part", "groupTitle", "stem", "answer", "solution", "audioUrl", "materialId", "wordLimit", "difficulty", "status", "reviewNote"]) {
      if (b[key] !== undefined) {
        if (key === "part" || key === "wordLimit" || key === "difficulty") data[key] = Number(b[key]) || null;
        else if (key === "answer") data[key] = b[key] === "" || b[key] === null ? null : String(b[key]);
        else data[key] = b[key];
      }
    }
    if (b.options !== undefined) data.options = Array.isArray(b.options) ? JSON.stringify(b.options) : b.options;
    const q = await prisma.languageQuestion.update({ where: { id: req.params.id }, data });
    ok(res, fmtQ(q), "更新成功");
  })
);

// 语言题审核通过/退回(复用学科题审核语义:status=PUBLISHED / REJECTED)
router.post(
  "/questions/:id/review",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageQuestion.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    const { pass, note } = req.body || {};
    const q = await prisma.languageQuestion.update({
      where: { id: req.params.id },
      data: {
        status: pass ? "PUBLISHED" : "REJECTED",
        reviewNote: note ? String(note) : null,
      },
    });
    ok(res, { id: q.id, status: q.status }, pass ? "审核通过" : "已退回");
  })
);

// DELETE /api/language/questions/:id — 删除语言题(教师/管理员)
router.delete(
  "/questions/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageQuestion.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    await prisma.languageAnswerRecord.deleteMany({ where: { questionId: existed.id } });
    await prisma.languageWrongBook.deleteMany({ where: { questionId: existed.id } });
    await prisma.languageQuestion.delete({ where: { id: existed.id } });
    ok(res, { id: existed.id }, "删除成功");
  })
);

// —— 语言材料(阅读文章/写作任务/口语提示) ——

// GET /api/language/materials?examType=&skill=&q=
router.get(
  "/materials",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { examType, skill, q } = req.query;
    const where = {};
    if (examType) where.examType = String(examType);
    if (skill) where.skill = String(skill);
    if (q) where.title = { contains: String(q).trim() };
    const list = await prisma.languageMaterial.findMany({
      where,
      orderBy: { createdAt: "desc" },
      select: { id: true, examType: true, skill: true, title: true, createdAt: true, updatedAt: true },
    });
    ok(res, { list, total: list.length });
  })
);

// GET /api/language/materials/:id — 材料详情(含正文与关联题目)
router.get(
  "/materials/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const m = await prisma.languageMaterial.findUnique({
      where: { id: req.params.id },
      include: { questions: { select: Q_FIELDS, orderBy: { createdAt: "asc" } } },
    });
    if (!m) return fail(res, 404, "材料不存在");
    ok(res, { ...m, questions: m.questions.map(fmtQ) });
  })
);

// POST /api/language/materials — 新增材料(教师/管理员)
router.post(
  "/materials",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!b.content) return fail(res, 400, "材料内容必填");
    const m = await prisma.languageMaterial.create({
      data: {
        examType: b.examType || "IELTS",
        skill: b.skill || "READING",
        title: b.title ? String(b.title) : null,
        content: String(b.content),
      },
    });
    ok(res, m, "创建成功");
  })
);

// PUT /api/language/materials/:id — 更新材料
router.put(
  "/materials/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageMaterial.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "材料不存在");
    const b = req.body || {};
    const data = {};
    for (const key of ["examType", "skill", "title", "content"]) {
      if (b[key] !== undefined) data[key] = b[key];
    }
    const m = await prisma.languageMaterial.update({ where: { id: req.params.id }, data });
    ok(res, m, "更新成功");
  })
);

// DELETE /api/language/materials/:id — 删除材料(同时解除题目关联)
router.delete(
  "/materials/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageMaterial.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "材料不存在");
    await prisma.languageQuestion.updateMany({ where: { materialId: existed.id }, data: { materialId: null } });
    await prisma.languageMaterial.delete({ where: { id: existed.id } });
    ok(res, { id: existed.id }, "删除成功");
  })
);

// —— 阅读篇章(一篇文章 + 绑定它的若干题目,作为一个整体单元) ——
// 数据仍复用 LanguageMaterial(文章) + LanguageQuestion.materialId(绑定),不改 schema

const PASSAGE_QTYPES = ["TRUE_FALSE_NG", "FILL_BLANK", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING"];

function fmtPassage(m) {
  const qs = (m.questions || []).map(fmtQ);
  const statusCount = {};
  for (const q of qs) statusCount[q.status] = (statusCount[q.status] || 0) + 1;
  const typeCount = {};
  for (const q of qs) typeCount[q.qType] = (typeCount[q.qType] || 0) + 1;
  return {
    id: m.id,
    examType: m.examType,
    skill: m.skill,
    title: m.title,
    content: m.content,
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    questionCount: qs.length,
    statusCount,
    typeCount,
    questions: qs,
  };
}

// 校验并归一化一道篇章内题目
function normPassageQuestion(raw, idx) {
  const qType = String(raw.qType || "").trim();
  if (!PASSAGE_QTYPES.includes(qType)) throw new Error(`第 ${idx + 1} 题:题型不合法`);
  const stem = String(raw.stem || "").trim();
  if (!stem) throw new Error(`第 ${idx + 1} 题:题干必填`);
  const isChoice = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING"].includes(qType);
  let options = null;
  if (isChoice) {
    const arr = (Array.isArray(raw.options) ? raw.options : []).map((s) => String(s || "").trim()).filter(Boolean);
    if (arr.length < 2) throw new Error(`第 ${idx + 1} 题:选择/配对/标题题至少需要 2 个选项`);
    options = JSON.stringify(arr);
  }
  const answer = raw.answer === undefined || raw.answer === null || String(raw.answer).trim() === "" ? null : String(raw.answer).trim();
  if (!answer) throw new Error(`第 ${idx + 1} 题:客观题必须填写答案`);
  return {
    qType,
    stem,
    options,
    answer,
    solution: raw.solution ? String(raw.solution) : null,
    difficulty: Number(raw.difficulty) || 3,
  };
}

// GET /api/language/passages?examType=&skill=&status=&q=
// 返回「一篇文章 + 其绑定题目」的整体单元列表(教师/管理员)
router.get(
  "/passages",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { examType, skill, status, q } = req.query;
    const where = { skill: skill ? String(skill) : "READING" };
    if (examType) where.examType = String(examType);
    if (q) {
      const kw = String(q).trim();
      where.OR = [{ title: { contains: kw } }, { content: { contains: kw } }];
    }
    const list = await prisma.languageMaterial.findMany({
      where,
      orderBy: { createdAt: "desc" },
      include: { questions: { select: Q_FIELDS, orderBy: [{ part: "asc" }, { createdAt: "asc" }] } },
    });
    let rows = list.map(fmtPassage);
    if (status) rows = rows.filter((p) => (p.statusCount[String(status)] || 0) > 0);
    ok(res, { list: rows, total: rows.length });
  })
);

// GET /api/language/passages/:id — 单篇详情
router.get(
  "/passages/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const m = await prisma.languageMaterial.findUnique({
      where: { id: req.params.id },
      include: { questions: { select: Q_FIELDS, orderBy: [{ part: "asc" }, { createdAt: "asc" }] } },
    });
    if (!m) return fail(res, 404, "篇章不存在");
    ok(res, fmtPassage(m));
  })
);

// POST /api/language/passages — 一次创建「一篇文章 + 其题目」
// body: { examType, skill, title, content, part?, groupTitle?, status?, questions: [...] }
router.post(
  "/passages",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    const content = String(b.content || "").trim();
    if (!content) return fail(res, 400, "文章正文必填");
    if (!Array.isArray(b.questions) || b.questions.length === 0) return fail(res, 400, "请至少录入一道题目");
    let normed;
    try {
      normed = b.questions.map((raw, i) => normPassageQuestion(raw, i));
    } catch (e) {
      return fail(res, 400, e.message);
    }
    const examType = b.examType || "IELTS";
    const skill = b.skill || "READING";
    const status = ["DRAFT", "PENDING_REVIEW", "PUBLISHED"].includes(b.status) ? b.status : "PENDING_REVIEW";
    const part = b.part ? Number(b.part) : null;
    const groupTitle = b.groupTitle ? String(b.groupTitle) : b.title ? String(b.title) : null;

    const created = await prisma.$transaction(async (tx) => {
      const m = await tx.languageMaterial.create({
        data: { examType, skill, title: b.title ? String(b.title) : null, content },
      });
      for (const nq of normed) {
        await tx.languageQuestion.create({
          data: {
            examType, skill, qType: nq.qType, part, groupTitle,
            stem: nq.stem, options: nq.options, answer: nq.answer, solution: nq.solution,
            materialId: m.id, difficulty: nq.difficulty, status,
            createdBy: req.user.id,
          },
        });
      }
      return m;
    });
    ok(res, { id: created.id, questionCount: normed.length }, "篇章创建成功");
  })
);

// PUT /api/language/passages/:id — 更新整篇(文章正文 + 题目增删改)
// questions 中带 id 的更新,不带 id 的新增,原有但未出现在列表中的删除
router.put(
  "/passages/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageMaterial.findUnique({
      where: { id: req.params.id },
      include: { questions: { select: { id: true, status: true, part: true }, orderBy: { createdAt: "asc" } } },
    });
    if (!existed) return fail(res, 404, "篇章不存在");
    const b = req.body || {};
    const examType = b.examType || existed.examType;
    const skill = b.skill || existed.skill;
    const part = b.part !== undefined ? (b.part ? Number(b.part) : null) : undefined;
    // 未显式传 part 时,新增题目继承篇内已有题目的 Passage 序号,避免排序错乱
    const inheritPart = existed.questions.find((x) => x.part !== null && x.part !== undefined)?.part ?? null;
    const groupTitle = b.title !== undefined ? (b.title ? String(b.title) : null) : undefined;

    let normed = null;
    if (b.questions !== undefined) {
      if (!Array.isArray(b.questions) || b.questions.length === 0) return fail(res, 400, "请至少保留一道题目");
      try {
        normed = b.questions.map((raw, i) => ({ ...normPassageQuestion(raw, i), id: raw.id ? String(raw.id) : null }));
      } catch (e) {
        return fail(res, 400, e.message);
      }
      const keep = new Set(normed.filter((x) => x.id).map((x) => x.id));
      for (const id of keep) {
        if (!existed.questions.some((q) => q.id === id)) return fail(res, 400, "存在不属于本篇章的题目 id");
      }
    }

    await prisma.$transaction(async (tx) => {
      const mData = {};
      if (b.title !== undefined) mData.title = b.title ? String(b.title) : null;
      if (b.content !== undefined) mData.content = String(b.content);
      if (b.examType !== undefined) mData.examType = examType;
      if (b.skill !== undefined) mData.skill = skill;
      if (Object.keys(mData).length) await tx.languageMaterial.update({ where: { id: existed.id }, data: mData });

      if (!normed) return;
      const keep = new Set(normed.filter((x) => x.id).map((x) => x.id));
      const removed = existed.questions.filter((q) => !keep.has(q.id)).map((q) => q.id);
      if (removed.length) {
        await tx.languageAnswerRecord.deleteMany({ where: { questionId: { in: removed } } });
        await tx.languageWrongBook.deleteMany({ where: { questionId: { in: removed } } });
        await tx.languageQuestion.deleteMany({ where: { id: { in: removed } } });
      }
      for (const nq of normed) {
        const data = {
          examType, skill, qType: nq.qType, stem: nq.stem, options: nq.options,
          answer: nq.answer, solution: nq.solution, difficulty: nq.difficulty,
        };
        if (part !== undefined) data.part = part;
        if (groupTitle !== undefined) data.groupTitle = groupTitle;
        if (nq.id) {
          await tx.languageQuestion.update({ where: { id: nq.id }, data });
        } else {
          await tx.languageQuestion.create({
            data: { ...data, part: part !== undefined ? part : inheritPart, groupTitle: groupTitle ?? null, materialId: existed.id, status: "PENDING_REVIEW", createdBy: req.user.id },
          });
        }
      }
    });
    ok(res, { id: existed.id }, "篇章已更新");
  })
);

// POST /api/language/passages/:id/review — 整篇审核(通过/退回,批量作用于篇内所有题目)
router.post(
  "/passages/:id/review",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageMaterial.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "篇章不存在");
    const { pass, note } = req.body || {};
    const r = await prisma.languageQuestion.updateMany({
      where: { materialId: existed.id },
      data: { status: pass ? "PUBLISHED" : "REJECTED", reviewNote: note ? String(note) : null },
    });
    ok(res, { id: existed.id, count: r.count }, pass ? `整篇审核通过(${r.count} 题)` : `整篇已退回(${r.count} 题)`);
  })
);

// DELETE /api/language/passages/:id — 删除整篇(文章 + 其题目 + 作答/错题记录)
router.delete(
  "/passages/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languageMaterial.findUnique({
      where: { id: req.params.id },
      include: { questions: { select: { id: true } } },
    });
    if (!existed) return fail(res, 404, "篇章不存在");
    const qids = existed.questions.map((q) => q.id);
    await prisma.$transaction(async (tx) => {
      if (qids.length) {
        await tx.languageAnswerRecord.deleteMany({ where: { questionId: { in: qids } } });
        await tx.languageWrongBook.deleteMany({ where: { questionId: { in: qids } } });
        await tx.languageQuestion.deleteMany({ where: { id: { in: qids } } });
      }
      await tx.languageMaterial.delete({ where: { id: existed.id } });
    });
    ok(res, { id: existed.id, questionCount: qids.length }, "整篇已删除");
  })
);

// —— 阅读篇章 PDF 导入(视觉模型抽取,返回草稿供教师确认后再保存) ——

// 视觉模型返回的原始篇章 → 前端可直接填表的草稿
function draftFromRaw(raw) {
  const qs = Array.isArray(raw?.questions) ? raw.questions : [];
  const questions = [];
  for (const r of qs) {
    let qType = String(r?.qType || "").trim().toUpperCase();
    const options = (Array.isArray(r?.options) ? r.options : [])
      .map((s) => String(s || "").replace(/^[A-Ha-h][.、)]\s*/, "").trim())
      .filter(Boolean);
    if (!PASSAGE_QTYPES.includes(qType)) qType = options.length >= 2 ? "SINGLE_CHOICE" : "FILL_BLANK";
    let answer = r?.answer === undefined || r?.answer === null ? "" : String(r.answer).trim();
    // 选择类题:答案给的是选项正文时换算成字母
    if (["SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING"].includes(qType) && answer.length > 1) {
      const hit = options.findIndex((o) => o.toLowerCase() === answer.toLowerCase());
      if (hit >= 0) answer = String.fromCharCode(65 + hit);
    }
    const stem = String(r?.stem || "").trim();
    if (!stem) continue;
    questions.push({
      qType,
      stem,
      options: ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING"].includes(qType) ? options : [],
      answer,
      solution: r?.solution ? String(r.solution) : "",
      difficulty: 3,
    });
  }
  return {
    title: String(raw?.title || "").trim(),
    content: String(raw?.content || "").trim(),
    questions,
  };
}

// POST /api/language/passages/import — 上传阅读 PDF(base64),异步抽取篇章草稿
// body: { filename, data, examType?, skill? } → { taskId }
router.post(
  "/passages/import",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { filename, data } = req.body || {};
    if (!data) return fail(res, 400, "请提供 PDF 文件 data(base64)");
    let buf;
    try {
      const s = String(data).includes(",") ? String(data).split(",")[1] : String(data);
      buf = Buffer.from(s, "base64");
    } catch {
      return fail(res, 400, "data 不是合法的 base64");
    }
    if (!buf.length) return fail(res, 400, "文件内容为空");
    if (buf.length > 15 * 1024 * 1024) return fail(res, 400, "文件过大(上限 15MB)");

    const task = createImportTask();
    updateImportTask(task.id, { progress: 3, message: "正在读取 PDF..." });
    (async () => {
      try {
        updateImportTask(task.id, { progress: 10, message: "正在栅格化 PDF..." });
        const pages = await rasterize(buf);
        updateImportTask(task.id, { progress: 30, message: `共 ${pages.length} 页,正在用视觉模型抽取文章与题目...这可能需要几十秒` });
        const raws = await extractReadingPassagesFromPdfPages(pages);
        const drafts = raws.map(draftFromRaw).filter((d) => d.content && d.questions.length);
        if (!drafts.length) throw new Error("未从该 PDF 抽取到任何「文章+题目」篇章,请确认这是阅读试卷");
        finishImportTask(task.id, { drafts, filename: filename || "", pageCount: pages.length });
      } catch (e) {
        const msg = e?.message === "VISION_NOT_CONFIGURED"
          ? "PDF 导入需要配置视觉模型:请在服务器 apps/api/.env 配置 VISION_API_KEY 后重启 API"
          : "阅读篇章解析失败:" + (e?.message || "未知错误");
        failImportTask(task.id, msg);
      }
    })();
    ok(res, { taskId: task.id }, "已开始解析");
  })
);

// GET /api/language/passages/import/:taskId — 轮询导入进度与结果
router.get(
  "/passages/import/:taskId",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const t = getImportTask(req.params.taskId);
    if (!t) return fail(res, 404, "任务不存在或已过期");
    ok(res, { id: t.id, status: t.status, progress: t.progress, message: t.message, result: t.result, error: t.error });
  })
);

// —— 语言试卷 ——

// GET /api/language/papers?examType=&skill=&kind=&status=
// 学生只读 READY 卷(卷内题目全部已发布)
router.get(
  "/papers",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { examType, skill, kind, status } = req.query;
    const where = {};
    if (examType) where.examType = String(examType);
    if (skill) where.skill = String(skill);
    if (kind) where.kind = String(kind);
    const isTeacher = ["TEACHER", "ADMIN"].includes(req.user.role);
    if (isTeacher && status) where.status = String(status);
    if (!isTeacher) where.status = "READY";
    const list = await prisma.languagePaper.findMany({
      where,
      orderBy: { createdAt: "desc" },
    });
    const rows = [];
    for (const p of list) {
      const ids = parseIds(p.questionIds);
      let questionCount = ids.length;
      if (!isTeacher) {
        const cnt = await prisma.languageQuestion.count({ where: { id: { in: ids }, status: "PUBLISHED" } });
        questionCount = cnt;
      }
      rows.push({
        id: p.id, examType: p.examType, skill: p.skill, title: p.title,
        segments: parseIds(p.segments), mode: p.mode, durationMin: p.durationMin,
        source: p.source, kind: p.kind, status: p.status, questionCount,
        createdAt: p.createdAt,
      });
    }
    ok(res, { list: rows, total: rows.length });
  })
);

// GET /api/language/papers/:id — 卷详情(题目含材料/音频)
router.get(
  "/papers/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const p = await prisma.languagePaper.findUnique({ where: { id: req.params.id } });
    if (!p) return fail(res, 404, "试卷不存在");
    const isTeacher = ["TEACHER", "ADMIN"].includes(req.user.role);
    const ids = parseIds(p.questionIds);
    const questions = await prisma.languageQuestion.findMany({
      where: { id: { in: ids }, ...(isTeacher ? {} : { status: "PUBLISHED" }) },
      select: { ...Q_FIELDS, material: { select: { id: true, title: true, content: true } } },
    });
    // 保持卷内顺序
    const orderMap = new Map(questions.map((q) => [q.id, q]));
    const ordered = ids.map((id) => orderMap.get(id)).filter(Boolean);
    ok(res, {
      id: p.id, examType: p.examType, skill: p.skill, title: p.title,
      segments: parseIds(p.segments), mode: p.mode, durationMin: p.durationMin,
      source: p.source, kind: p.kind, status: p.status,
      questionCount: ordered.length,
      questions: ordered.map((q) => ({
        ...fmtQ(q),
        options: parseOptions(q.options),
        material: q.material ? { id: q.material.id, title: q.material.title, content: q.material.content } : null,
      })),
    });
  })
);

// POST /api/language/papers — 创建语言卷(教师/管理员)
// body: { examType, skill, title, questionIds, segments?, mode, durationMin?, kind }
router.post(
  "/papers",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const b = req.body || {};
    if (!b.examType || !b.title) return fail(res, 400, "examType、title 必填");
    if (!Array.isArray(b.questionIds) || b.questionIds.length === 0) return fail(res, 400, "请选择至少一道题");
    const ids = b.questionIds.map(String);
    const cnt = await prisma.languageQuestion.count({ where: { id: { in: ids } } });
    if (cnt !== ids.length) return fail(res, 400, "存在无效的题目 id");
    const p = await prisma.languagePaper.create({
      data: {
        examType: b.examType,
        skill: b.skill || "READING",
        title: String(b.title),
        questionIds: JSON.stringify(ids),
        segments: Array.isArray(b.segments) && b.segments.length ? JSON.stringify(b.segments) : null,
        mode: b.mode === "EXAM" ? "EXAM" : "PRACTICE",
        durationMin: b.durationMin ? Number(b.durationMin) : null,
        source: b.source ? String(b.source) : null,
        kind: b.kind || "CUSTOM",
        status: "READY",
      },
    });
    ok(res, { id: p.id, title: p.title }, "组卷成功");
  })
);

// PUT /api/language/papers/:id — 更新语言卷
router.put(
  "/papers/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languagePaper.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "试卷不存在");
    const b = req.body || {};
    const data = {};
    for (const key of ["examType", "skill", "title", "source", "kind", "mode", "durationMin", "status"]) {
      if (b[key] !== undefined) data[key] = b[key];
    }
    if (b.questionIds !== undefined) {
      if (!Array.isArray(b.questionIds) || !b.questionIds.length) return fail(res, 400, "请选择至少一道题");
      data.questionIds = JSON.stringify(b.questionIds.map(String));
    }
    if (b.segments !== undefined) data.segments = Array.isArray(b.segments) ? JSON.stringify(b.segments) : null;
    const p = await prisma.languagePaper.update({ where: { id: req.params.id }, data });
    ok(res, { id: p.id }, "更新成功");
  })
);

// DELETE /api/language/papers/:id — 删除语言卷
router.delete(
  "/papers/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.languagePaper.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "试卷不存在");
    // 保护:若仍有作业/考试分发引用该卷,禁止删除(否则会让学生端点开作业报"试卷不存在")
    const refCount = await prisma.assignment.count({ where: { languagePaperId: existed.id } });
    if (refCount > 0) {
      return fail(res, 400, "该试卷已布置给学生的作业/考试,无法删除。请先在「作业分发」中撤回相关作业后再删除。");
    }
    await prisma.languageSession.updateMany({ where: { paperId: existed.id }, data: { paperId: null } });
    await prisma.languagePaper.delete({ where: { id: existed.id } });
    ok(res, { id: existed.id }, "删除成功");
  })
);

// —— 语言会话(学生开卷) ——

// POST /api/language/sessions — 创建语言会话
// body: { paperId, mode?, assignmentId? }
// 支持作业:assignment 关联 languagePaper 时,paperId 由作业决定
router.post(
  "/sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { paperId, mode, assignmentId } = req.body || {};
    let paper = null;
    let assignment = null;

    if (assignmentId) {
      assignment = await prisma.assignment.findUnique({
        where: { id: String(assignmentId) },
        include: { targets: { where: { studentId: req.user.id } } },
      });
      if (!assignment || !assignment.languagePaperId) return fail(res, 403, "您没有被布置这份作业");
      if (assignment.status !== "ACTIVE") return fail(res, 400, "该作业已停止");
      // 注意:过期语言作业仍允许作答补交(会打「逾期补交」标签),此处不再拦截 dueAt
      const target = assignment.targets[0];
      if (!target) return fail(res, 403, "您没有被布置这份作业");
      if (target.status === "SUBMITTED") return fail(res, 400, "这份作业已提交,请勿重复作答");
      paper = await prisma.languagePaper.findUnique({ where: { id: assignment.languagePaperId } });
      if (!paper) return fail(res, 404, "作业对应的试卷不存在");
    } else if (paperId) {
      paper = await prisma.languagePaper.findUnique({ where: { id: String(paperId) } });
      if (!paper) return fail(res, 404, "试卷不存在");
      if (paper.status !== "READY") return fail(res, 400, "该试卷尚未开放");
    } else {
      return fail(res, 400, "请指定试卷");
    }

    const aMode = mode === "EXAM" ? "EXAM" : paper.mode === "EXAM" ? "EXAM" : "PRACTICE";
    let durationMin = paper.durationMin;
    if (aMode === "EXAM" && !durationMin) {
      // 全真连考卷:由分段求和
      const segs = parseIds(paper.segments);
      if (segs.length) durationMin = segs.reduce((a, s) => a + (Number(s.durationMin) || 0), 0);
      if (!durationMin) return fail(res, 400, "模拟考必须配置时长");
    }

    const session = await prisma.languageSession.create({
      data: {
        studentId: req.user.id,
        paperId: paper.id,
        assignmentId: assignment?.id || null,
        examType: paper.examType,
        skill: paper.skill,
        mode: aMode,
        durationMin,
        total: parseIds(paper.questionIds).length,
      },
    });

    // 作业目标回写进行中
    if (assignment) {
      await prisma.assignmentStudent.updateMany({
        where: { assignmentId: assignment.id, studentId: req.user.id, status: "PENDING" },
        data: { status: "IN_PROGRESS", sessionId: session.id },
      });
    }

    // 返回卷详情(学生可见题目,不含答案)
    const ids = parseIds(paper.questionIds);
    const questions = await prisma.languageQuestion.findMany({
      where: { id: { in: ids }, status: "PUBLISHED" },
      select: { ...Q_FIELDS, material: { select: { id: true, title: true, content: true } } },
    });
    const orderMap = new Map(questions.map((q) => [q.id, q]));
    const ordered = ids.map((id) => orderMap.get(id)).filter(Boolean);
    ok(res, {
      sessionId: session.id,
      mode: aMode,
      durationMin,
      segments: parseIds(paper.segments),
      questions: ordered.map((q) => {
        const { answer, reviewNote, status, ...safe } = q;
        return { ...fmtQ(safe), options: parseOptions(q.options), answer: undefined, material: q.material };
      }),
    }, "会话已创建");
  })
);

// 保存单个作答(客观题实时判分并写入)
router.post(
  "/sessions/:id/answer",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.languageSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.studentId !== req.user.id) return fail(res, 404, "会话不存在");
    if (session.submittedAt) return fail(res, 400, "会话已提交,无法作答");
    const { questionId, selected, timeSpent } = req.body || {};
    if (!questionId) return fail(res, 400, "缺少题目 id");
    const question = await prisma.languageQuestion.findUnique({ where: { id: String(questionId) } });
    if (!question) return fail(res, 404, "题目不存在");
    const isObjective = ["FILL_BLANK", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING", "TRUE_FALSE_NG", "YES_NO_NG"].includes(question.qType);
    const isCorrect = isObjective ? isAnswerCorrect(question, selected) : null;
    await prisma.languageAnswerRecord.upsert({
      where: { sessionId_questionId: { sessionId: session.id, questionId: question.id } },
      create: {
        sessionId: session.id, questionId: question.id,
        selected: selected !== undefined ? String(selected) : null,
        isCorrect, timeSpent: timeSpent ? Number(timeSpent) : null,
      },
      update: {
        selected: selected !== undefined ? String(selected) : null,
        isCorrect, timeSpent: timeSpent ? Number(timeSpent) : null,
      },
    });
    ok(res, { questionId: question.id, isCorrect });
  })
);

// 保存写作/口语主观作答(selected 文本 / audioUrl 录音)
router.post(
  "/sessions/:id/answer/text",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.languageSession.findUnique({ where: { id: req.params.id } });
    if (!session || session.studentId !== req.user.id) return fail(res, 404, "会话不存在");
    if (session.submittedAt) return fail(res, 400, "会话已提交,无法作答");
    const { questionId, text, audioUrl } = req.body || {};
    if (!questionId) return fail(res, 400, "缺少题目 id");
    const question = await prisma.languageQuestion.findUnique({ where: { id: String(questionId) } });
    if (!question) return fail(res, 404, "题目不存在");
    await prisma.languageAnswerRecord.upsert({
      where: { sessionId_questionId: { sessionId: session.id, questionId: question.id } },
      create: {
        sessionId: session.id, questionId: question.id,
        selected: text ? String(text) : null,
        audioUrl: audioUrl ? String(audioUrl) : null,
        isCorrect: null,
      },
      update: {
        selected: text !== undefined ? String(text) : undefined,
        audioUrl: audioUrl !== undefined ? String(audioUrl) : undefined,
        isCorrect: null,
      },
    });
    ok(res, { questionId: question.id }, "已保存");
  })
);

// POST /api/language/sessions/:id/submit — 交卷并判分
router.post(
  "/sessions/:id/submit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.languageSession.findUnique({
      where: { id: req.params.id },
      include: { assignment: { select: { dueAt: true } } },
    });
    if (!session || session.studentId !== req.user.id) return fail(res, 404, "会话不存在");
    if (session.submittedAt) return fail(res, 400, "会话已提交");

    const records = await prisma.languageAnswerRecord.findMany({
      where: { sessionId: session.id },
      include: { question: { select: { id: true, qType: true, answer: true } } },
    });
    const objective = records.filter((r) => ["FILL_BLANK", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING", "TRUE_FALSE_NG", "YES_NO_NG"].includes(r.question.qType));
    const subjective = records.filter((r) => !["FILL_BLANK", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING", "TRUE_FALSE_NG", "YES_NO_NG"].includes(r.question.qType));
    const correct = objective.filter((r) => r.isCorrect).length;
    const total = records.length;
    const score = correct;

    // 客观题 → 自动折算 Band;主观题存在且未批改 → band 置空,待教师批改
    let band = null;
    if (objective.length && subjective.length === 0) {
      band = bandOf(correct, objective.length);
    } else if (objective.length && subjective.length) {
      // 混合卷:客观部分折算(主观部分教师批改后合成,此处不覆盖)
      band = null;
    }

    const updated = await prisma.languageSession.update({
      where: { id: session.id },
      data: { score, correctCount: correct, total, band, submittedAt: new Date() },
    });

    // 作业回写已交(逾期则标记补交)
    if (session.assignmentId) {
      const isLateSubmit = !!(
        session.assignment?.dueAt && new Date() > new Date(session.assignment.dueAt)
      );
      await prisma.assignmentStudent.updateMany({
        where: { assignmentId: session.assignmentId, studentId: req.user.id },
        data: { status: "SUBMITTED", submittedAt: new Date(), lateSubmit: isLateSubmit },
      });
    }

    // 错题本:客观错题写入
    const wrong = objective.filter((r) => !r.isCorrect);
    for (const w of wrong) {
      await prisma.languageWrongBook.upsert({
        where: { studentId_questionId: { studentId: req.user.id, questionId: w.questionId } },
        create: { studentId: req.user.id, questionId: w.questionId, wrongCount: 1 },
        update: { wrongCount: { increment: 1 }, mastered: false },
      });
    }

    ok(res, {
      score, total, correctCount: correct,
      band,
      needsReview: subjective.length > 0,
      timedOut: false,
      details: (() => {
        const seen = new Set();
        return records
          .filter((r) => {
            if (seen.has(r.questionId)) return false;
            seen.add(r.questionId);
            return true;
          })
          .map((r) => ({ questionId: r.questionId, selected: r.selected, isCorrect: r.isCorrect }));
      })(),
    }, "判分完成");
  })
);

// GET /api/language/sessions/:id — 会话详情(作答后查看成绩/批改)
router.get(
  "/sessions/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const session = await prisma.languageSession.findUnique({
      where: { id: req.params.id },
      include: {
        records: { include: { question: { select: { ...Q_FIELDS, material: { select: { id: true, title: true, content: true } } } } } },
      },
    });
    if (!session || (session.studentId !== req.user.id && !["TEACHER", "ADMIN"].includes(req.user.role))) {
      return fail(res, 404, "会话不存在");
    }
    ok(res, {
      id: session.id, examType: session.examType, skill: session.skill, mode: session.mode,
      allowReplay: session.mode !== "EXAM",
      durationMin: session.durationMin, score: session.score, total: session.total,
      correctCount: session.correctCount, band: session.band,
      startedAt: session.startedAt, submittedAt: session.submittedAt,
      paper: session.paper ? { id: session.paper.id, title: session.paper.title } : null,
      details: (() => {
        const seen = new Set();
        return session.records
          .filter((r) => {
            if (seen.has(r.questionId)) return false;
            seen.add(r.questionId);
            return true;
          })
          .map((r) => ({
            questionId: r.questionId,
            stem: r.question.stem,
            options: parseOptions(r.question.options),
            answer: r.question.answer,
            solution: r.question.solution,
            audioUrl: r.question.audioUrl,
            material: r.question.material ? { id: r.question.material.id, title: r.question.material.title, content: r.question.material.content } : null,
            selected: r.selected,
            isCorrect: r.isCorrect,
            band: r.band,
            feedback: r.feedback,
            recordAudioUrl: r.audioUrl,
            qType: r.question.qType,
          }));
      })(),
    });
  })
);

// GET /api/language/sessions — 我的语言会话历史
router.get(
  "/sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const where = { studentId: req.user.id };
    if (req.query.skill) where.skill = String(req.query.skill);
    const list = await prisma.languageSession.findMany({
      where,
      orderBy: { startedAt: "desc" },
      take: 50,
      select: {
        id: true, examType: true, skill: true, mode: true, score: true, total: true,
        correctCount: true, band: true, startedAt: true, submittedAt: true,
        paper: { select: { title: true } },
      },
    });
    ok(res, { list });
  })
);

// —— 学生端:我的语言作业 ——
// GET /api/language/my-assignments — 教师布置给我的语言作业(未完成优先)
router.get(
  "/my-assignments",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== "STUDENT") return fail(res, 403, "仅学生可查看");
    const targets = await prisma.assignmentStudent.findMany({
      where: { studentId: req.user.id, assignment: { languagePaperId: { not: null } } },
      include: {
        assignment: {
          include: { languagePaper: { select: { id: true, title: true, examType: true, skill: true, mode: true, durationMin: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    ok(res, {
      list: targets.map((t) => {
        const a = t.assignment;
        const paper = a.languagePaper;
        let effective = t.status;
        if (effective === "PENDING" && a.dueAt && new Date() > a.dueAt) effective = "EXPIRED";
        return {
          id: a.id, title: a.title, note: a.note, mode: a.mode, dueAt: a.dueAt,
          status: effective, submittedAt: t.submittedAt, sessionId: t.sessionId,
          lateSubmit: t.lateSubmit,
          paper: paper ? { id: paper.id, title: paper.title, examType: paper.examType, skill: paper.skill, mode: paper.mode, durationMin: paper.durationMin } : null,
        };
      }),
    });
  })
);

// —— 教师端:写作/口语批改台 ——

// GET /api/language/review-pool?examType=&skill= — 待批改会话(写作/口语)
router.get(
  "/review-pool",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { examType, skill } = req.query;
    const where = { submittedAt: { not: null } };
    if (examType) where.examType = String(examType);
    if (skill) where.skill = String(skill);
    // 只含写作/口语的会话(存在未批改的主观作答)
    const sessions = await prisma.languageSession.findMany({
      where,
      include: {
        student: { select: { id: true, name: true, email: true } },
        records: { include: { question: { select: { id: true, qType: true, skill: true } } } },
      },
      orderBy: { submittedAt: "desc" },
      take: 200,
    });
    const list = [];
    for (const s of sessions) {
      const subs = s.records.filter((r) => ["TASK1", "TASK2", "PART1", "PART2", "PART3"].includes(r.question.qType));
      const pending = subs.filter((r) => r.band === null || r.band === undefined);
      if (subs.length === 0) continue;
      list.push({
        id: s.id,
        student: s.student,
        examType: s.examType,
        skill: s.skill,
        mode: s.mode,
        submittedAt: s.submittedAt,
        totalSub: subs.length,
        pendingSub: pending.length,
      });
    }
    ok(res, { list });
  })
);

// GET /api/language/review-pool/:sessionId — 批改详情(学生作答 + 参考)
router.get(
  "/review-pool/:sessionId",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const session = await prisma.languageSession.findUnique({
      where: { id: req.params.sessionId },
      include: {
        student: { select: { id: true, name: true, email: true } },
        paper: { select: { title: true } },
        records: { include: { question: { select: { ...Q_FIELDS, material: { select: { id: true, title: true, content: true } } } } } },
      },
    });
    if (!session) return fail(res, 404, "会话不存在");
    const subs = session.records.filter((r) => ["TASK1", "TASK2", "PART1", "PART2", "PART3"].includes(r.question.qType));
    ok(res, {
      id: session.id,
      student: session.student,
      paperTitle: session.paper?.title,
      examType: session.examType,
      skill: session.skill,
      mode: session.mode,
      startedAt: session.startedAt,
      submittedAt: session.submittedAt,
      objectiveSummary: {
        score: session.score, total: session.total, correctCount: session.correctCount,
      },
      items: subs.map((r) => ({
        recordId: r.id,
        questionId: r.questionId,
        qType: r.question.qType,
        skill: r.question.skill,
        stem: r.question.stem,
        groupTitle: r.question.groupTitle,
        wordLimit: r.question.wordLimit,
        solution: r.question.solution,
        audioUrl: r.question.audioUrl,
        material: r.question.material ? { id: r.question.material.id, title: r.question.material.title, content: r.question.material.content } : null,
        selected: r.selected,
        recordAudioUrl: r.audioUrl,
        band: r.band,
        feedback: r.feedback,
      })),
    });
  })
);

// POST /api/language/review-pool/:sessionId/grade — 批改单个作答(打 Band + 评语)
// body: { recordId, band, feedback }
router.post(
  "/review-pool/:sessionId/grade",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const session = await prisma.languageSession.findUnique({ where: { id: req.params.sessionId } });
    if (!session) return fail(res, 404, "会话不存在");
    const { recordId, band, feedback } = req.body || {};
    if (!recordId) return fail(res, 400, "缺少作答记录 id");
    const rec = await prisma.languageAnswerRecord.findUnique({ where: { id: String(recordId) } });
    if (!rec || rec.sessionId !== session.id) return fail(res, 404, "作答记录不存在");
    const b = band !== undefined && band !== null && band !== "" ? Number(band) : null;
    if (b !== null && (b < 0 || b > 9)) return fail(res, 400, "Band 范围 0-9");
    await prisma.languageAnswerRecord.update({
      where: { id: rec.id },
      data: { band: b, feedback: feedback ? String(feedback) : null },
    });
    // 若全部主观题已批改,合成会话 Band(主观平均)
    const full = await prisma.languageAnswerRecord.findMany({
      where: { sessionId: session.id },
      include: { question: { select: { qType: true } } },
    });
    const bands = full
      .filter((r) => ["TASK1", "TASK2", "PART1", "PART2", "PART3"].includes(r.question.qType))
      .map((r) => r.band)
      .filter((x) => x !== null && x !== undefined);
    const hasObjective = full.some((r) => ["FILL_BLANK", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING", "TRUE_FALSE_NG", "YES_NO_NG"].includes(r.question.qType));
    const pendingSub = full.some((r) => ["TASK1", "TASK2", "PART1", "PART2", "PART3"].includes(r.question.qType) && (r.band === null || r.band === undefined));
    let bandFinal = session.band;
    if (!pendingSub) {
      if (bands.length) {
        const avg = bands.reduce((a, x) => a + x, 0) / bands.length;
        const round2half = Math.round(avg * 2) / 2;
        bandFinal = hasObjective && session.band ? (session.band + round2half) / 2 : round2half;
      }
    }
    if (bandFinal !== session.band) {
      await prisma.languageSession.update({ where: { id: session.id }, data: { band: bandFinal } });
    }
    ok(res, { recordId: rec.id, band: b, sessionBand: bandFinal }, "批改完成");
  })
);

// —— 语言学情统计(教师端) ——

// GET /api/language/stats/overview — 语言学习总览(人数/会话/Band 分布/薄弱题型)
router.get(
  "/stats/overview",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const sessions = await prisma.languageSession.findMany({
      where: { submittedAt: { not: null } },
      include: { records: { include: { question: { select: { qType: true, skill: true } } } } },
    });
    const students = await prisma.user.count({ where: { role: "STUDENT" } });
    const bySkill = new Map();
    const byBand = { "0-4": 0, "4.5-5.5": 0, "6-6.5": 0, "7-7.5": 0, "8-9": 0 };
    const qTypeAgg = new Map();
    for (const s of sessions) {
      const key = s.skill || "FULL";
      const item = bySkill.get(key) || { sessions: 0, avgBand: 0, totalBand: 0 };
      item.sessions += 1;
      if (s.band !== null && s.band !== undefined) {
        item.totalBand += s.band;
        if (s.band <= 4) byBand["0-4"] += 1;
        else if (s.band <= 5.5) byBand["4.5-5.5"] += 1;
        else if (s.band <= 6.5) byBand["6-6.5"] += 1;
        else if (s.band <= 7.5) byBand["7-7.5"] += 1;
        else byBand["8-9"] += 1;
      }
      bySkill.set(key, item);
    }
    for (const s of sessions) {
      for (const r of s.records) {
        if (r.isCorrect === null || r.isCorrect === undefined) continue;
        const qk = `${r.question.skill}·${r.question.qType}`;
        const it = qTypeAgg.get(qk) || { key: qk, attempts: 0, correct: 0 };
        it.attempts += 1;
        if (r.isCorrect) it.correct += 1;
        qTypeAgg.set(qk, it);
      }
    }
    ok(res, {
      students,
      sessions: sessions.length,
      bySkill: [...bySkill.entries()].map(([skill, v]) => ({
        skill,
        sessions: v.sessions,
        avgBand: v.sessions ? Math.round((v.totalBand / v.sessions) * 2) / 2 : null,
      })),
      byBand,
      weakQTypes: [...qTypeAgg.values()]
        .map((x) => ({ ...x, correctRate: x.attempts ? Math.round((x.correct / x.attempts) * 100) : 0 }))
        .sort((a, b) => a.correctRate - b.correctRate)
        .slice(0, 10),
    });
  })
);

export default router;
