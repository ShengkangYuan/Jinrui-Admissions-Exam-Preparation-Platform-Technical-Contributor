import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth } from "../middleware/auth.js";
import { extractQuestionFromImage, parseJsonArray } from "../lib/vision.js";

const router = Router();

// GET /api/me/sessions — 我的成绩历史
router.get(
  "/sessions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const where = { studentId: req.user.id };
    if (req.query.mode) where.mode = req.query.mode;
    const list = await prisma.session.findMany({
      where,
      select: {
        id: true, mode: true, score: true, total: true, correctCount: true, startedAt: true, submittedAt: true,
        paperId: true, assignmentId: true,
        paper: { select: { title: true } },
        assignment: { select: { title: true } },
      },
      orderBy: { startedAt: "desc" },
    });
    // 统计每场会话已作答(已选答案)的题目数,供"继续做题"展示进度
    const ids = list.map((s) => s.id);
    const answeredMap = {};
    if (ids.length) {
      const groups = await prisma.answerRecord.groupBy({
        by: ["sessionId"],
        where: { sessionId: { in: ids }, selected: { not: null } },
        _count: { _all: true },
      });
      groups.forEach((g) => { answeredMap[g.sessionId] = g._count._all; });
    }
    const out = list.map((s) => ({
      id: s.id,
      mode: s.mode,
      score: s.score,
      total: s.total,
      correctCount: s.correctCount,
      startedAt: s.startedAt,
      submittedAt: s.submittedAt,
      paperId: s.paperId ?? null,
      assignmentId: s.assignmentId ?? null,
      paperTitle: s.paper?.title ?? null,
      assignmentTitle: s.assignment?.title ?? null,
      answeredCount: answeredMap[s.id] ?? 0,
    }));
    ok(res, { list: out });
  })
);

// GET /api/me/wrongbook — 我的错题本
router.get(
  "/wrongbook",
  requireAuth,
  asyncHandler(async (req, res) => {
    const list = await prisma.wrongBook.findMany({
      where: { studentId: req.user.id },
      include: { question: { select: { id: true, topic: true, subject: true, difficulty: true, stem: true, solution: true, answer: true } } },
      orderBy: { updatedAt: "desc" },
    });
    ok(res, {
      list: list.map((w) => ({
        questionId: w.questionId,
        topic: w.question.topic,
        subject: w.question.subject,
        difficulty: w.question.difficulty,
        stem: w.question.stem,
        answer: w.question.answer,
        solution: w.question.solution,
        wrongCount: w.wrongCount,
        mastered: w.mastered,
      })),
    });
  })
);

// GET /api/me/wrongbook/topics — 错题本知识点汇总(供「按错题知识点组卷」多选)
router.get(
  "/wrongbook/topics",
  requireAuth,
  asyncHandler(async (req, res) => {
    const wb = await prisma.wrongBook.findMany({
      where: { studentId: req.user.id },
      include: { question: { select: { topic: true, status: true } } },
    });
    const agg = new Map();
    for (const w of wb) {
      if (w.question.status !== "PUBLISHED") continue;
      const t = String(w.question.topic || "").trim() || "未分类";
      agg.set(t, (agg.get(t) || 0) + 1);
    }
    ok(res, {
      list: [...agg.entries()]
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => b.count - a.count),
    });
  })
);

// POST /api/me/wrongbook/:questionId/master — 标记掌握
router.post(
  "/wrongbook/:questionId/master",
  requireAuth,
  asyncHandler(async (req, res) => {
    const existed = await prisma.wrongBook.findUnique({
      where: { studentId_questionId: { studentId: req.user.id, questionId: req.params.questionId } },
    });
    if (!existed) return fail(res, 404, "错题不存在");
    await prisma.wrongBook.update({
      where: { id: existed.id },
      data: { mastered: true },
    });
    ok(res, null, "已标记掌握");
  })
);

// DELETE /api/me/wrongbook — 批量删除错题本条目 { questionIds: [] }
// 仅删除属于当前登录学生的条目,防止越权删除他人错题
router.delete(
  "/wrongbook",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.questionIds)
      ? req.body.questionIds.map((x) => String(x))
      : [];
    if (ids.length === 0) return fail(res, 400, "请选择要删除的错题");
    const r = await prisma.wrongBook.deleteMany({
      where: { studentId: req.user.id, questionId: { in: ids } },
    });
    ok(res, { deleted: r.count }, `已删除 ${r.count} 条错题`);
  })
);

// GET /api/me/stats — 知识点掌握度(按 topic 聚合)
router.get(
  "/stats",
  requireAuth,
  asyncHandler(async (req, res) => {
    const records = await prisma.answerRecord.findMany({
      where: { session: { studentId: req.user.id }, isCorrect: { not: null } },
      include: {
        question: { select: { topic: true, subject: true, difficulty: true } },
        session: { select: { mode: true } },
      },
    });
    const byTopic = new Map();
    const bySubject = new Map();
    const byMode = new Map();
    const byDifficulty = new Map();
    let correctAnswered = 0;
    for (const r of records) {
      const correct = r.isCorrect ? 1 : 0;
      correctAnswered += correct;
      const topic = r.question.topic || "未分类";
      let t = byTopic.get(topic) || { topic, attempts: 0, correct: 0 };
      t.attempts += 1; t.correct += correct; byTopic.set(topic, t);
      const subject = r.question.subject || "其他";
      let s = bySubject.get(subject) || { subject, attempts: 0, correct: 0 };
      s.attempts += 1; s.correct += correct; bySubject.set(subject, s);
      const mode = r.session?.mode || "PRACTICE";
      let m = byMode.get(mode) || { mode, attempts: 0, correct: 0 };
      m.attempts += 1; m.correct += correct; byMode.set(mode, m);
      const diff = r.question.difficulty ?? 3;
      let d = byDifficulty.get(diff) || { difficulty: diff, attempts: 0, correct: 0 };
      d.attempts += 1; d.correct += correct; byDifficulty.set(diff, d);
    }
    const rate = (o) => (o.attempts ? Math.round((o.correct / o.attempts) * 100) : 0);
    ok(res, {
      totalAnswered: records.length,
      correctAnswered,
      overallRate: records.length ? Math.round((correctAnswered / records.length) * 100) : 0,
      byTopic: [...byTopic.values()].map(({ topic, attempts, correct }) => ({ topic, attempts, correctRate: rate({ attempts, correct }) })),
      bySubject: [...bySubject.values()].map(({ subject, attempts, correct }) => ({ subject, attempts, correctRate: rate({ attempts, correct }) })).sort((a, b) => b.correctRate - a.correctRate),
      byMode: [...byMode.values()].map(({ mode, attempts, correct }) => ({ mode, attempts, correctRate: rate({ attempts, correct }) })),
      byDifficulty: [...byDifficulty.values()].map(({ difficulty, attempts, correct }) => ({ difficulty, attempts, correctRate: rate({ attempts, correct }) })).sort((a, b) => a.difficulty - b.difficulty),
    });
  })
);

// GET /api/me/assignments — 我的作业(待完成 + 已完成)
router.get(
  "/assignments",
  requireAuth,
  asyncHandler(async (req, res) => {
    const targets = await prisma.assignmentStudent.findMany({
      where: { studentId: req.user.id },
      include: {
        assignment: {
          include: {
            paper: { select: { title: true, subject: true, sourceType: true } },
            languagePaper: { select: { title: true, mode: true, durationMin: true, examType: true, skill: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    const now = Date.now();
    const list = targets.map((t) => {
      const a = t.assignment;
      let status = t.status;
      // PENDING 且已过 DDL → 过期
      if (status === "PENDING" && a.dueAt && now > new Date(a.dueAt).getTime()) status = "EXPIRED";
      const isLanguage = !!a.languagePaperId;
      const lp = a.languagePaper;
      const pp = a.paper;
      return {
        id: t.assignmentId,
        title: a.title,
        note: a.note,
        mode: a.mode,
        dueAt: a.dueAt,
        status,
        submittedAt: t.submittedAt,
        sessionId: t.sessionId,
        lateSubmit: t.lateSubmit,
        isLanguage,
        paper: isLanguage
          ? { title: lp?.title, mode: lp?.mode, durationMin: lp?.durationMin, subject: null, sourceType: null, isLanguage: true, examType: lp?.examType, skill: lp?.skill }
          : { title: pp?.title, mode: a.mode, durationMin: a.durationMin, subject: pp?.subject, sourceType: pp?.sourceType, isLanguage: false },
      };
    });
    ok(res, { list });
  })
);

/* ================= 题目收藏 ================= */
// GET /api/me/favorites — 我的题目收藏(含答案/解析,供查阅复习)
router.get(
  "/favorites",
  requireAuth,
  asyncHandler(async (req, res) => {
    const list = await prisma.favoriteQuestion.findMany({
      where: { studentId: req.user.id },
      include: { question: true },
      orderBy: { createdAt: "desc" },
    });
    ok(res, {
      list: list.map((f) => ({
        favoritedAt: f.createdAt,
        question: {
          id: f.question.id,
          subject: f.question.subject,
          sourceType: f.question.sourceType,
          topic: f.question.topic,
          difficulty: f.question.difficulty,
          type: f.question.type,
          stem: f.question.stem,
          options: parseJsonArray(f.question.options),
          answer: f.question.answer,
          solution: f.question.solution,
          source: f.question.source,
        },
      })),
    });
  })
);

// POST /api/me/favorites — 收藏题目 { questionId }
router.post(
  "/favorites",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { questionId } = req.body || {};
    if (!questionId) return fail(res, 400, "缺少题目参数");
    const q = await prisma.question.findUnique({ where: { id: questionId } });
    if (!q) return fail(res, 404, "题目不存在");
    if (q.status !== "PUBLISHED") return fail(res, 400, "只能收藏已发布的题目");
    await prisma.favoriteQuestion.upsert({
      where: { studentId_questionId: { studentId: req.user.id, questionId } },
      create: { studentId: req.user.id, questionId },
      update: {},
    });
    ok(res, null, "已加入收藏");
  })
);

// DELETE /api/me/favorites/:questionId — 取消收藏
router.delete(
  "/favorites/:questionId",
  requireAuth,
  asyncHandler(async (req, res) => {
    await prisma.favoriteQuestion.deleteMany({
      where: { studentId: req.user.id, questionId: req.params.questionId },
    });
    ok(res, null, "已取消收藏");
  })
);

/* ================= 我的原创题 ================= */
const parseOpts = (s) => {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
};

// GET /api/me/questions — 我的原创题列表
router.get(
  "/questions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const list = await prisma.question.findMany({
      where: { createdBy: req.user.id, source: "学生原创题" },
      orderBy: { createdAt: "desc" },
    });
    ok(res, {
      list: list.map((q) => ({
        id: q.id,
        subject: q.subject,
        topic: q.topic,
        difficulty: q.difficulty,
        type: q.type,
        stem: q.stem,
        options: parseOpts(q.options),
        answer: q.answer,
        solution: q.solution,
        status: q.status,
        reviewNote: q.reviewNote,
        createdAt: q.createdAt,
      })),
    });
  })
);

// POST /api/me/questions — 新建原创题(草稿)
router.post(
  "/questions",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { subject, topic, difficulty, type, stem, options, answer, solution } = req.body || {};
    const opts = Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean) : [];
    if (!subject || !topic || !String(stem || "").trim()) return fail(res, 400, "请填写科目、知识点与题干");
    if (opts.length < 2) return fail(res, 400, "选项至少 2 个");
    if (!String(answer || "").trim()) return fail(res, 400, "请填写正确答案");
    const q = await prisma.question.create({
      data: {
        subject: String(subject),
        topic: String(topic),
        difficulty: Math.min(Math.max(Number(difficulty) || 3, 1), 5),
        type: type === "SINGLE_CHOICE" ? "SINGLE_CHOICE" : "SINGLE_CHOICE",
        stem: String(stem).trim(),
        options: JSON.stringify(opts),
        answer: String(answer).trim(),
        solution: String(solution || "").trim() || null,
        source: "学生原创题",
        status: "DRAFT",
        createdBy: req.user.id,
      },
    });
    ok(res, { id: q.id }, "原创题已保存为草稿,可继续编辑或提交审核");
  })
);

// POST /api/me/questions/import-image — 学生图片识别(截图粘贴)新建原创题
router.post(
  "/questions/import-image",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { data } = req.body || {};
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
    const options = (Array.isArray(raw.options) ? raw.options : parseJsonArray(String(raw.options || "[]")))
      .map((o) => String(o).trim()).filter(Boolean);
    let answer = String(raw.answer || "").trim();
    if (/^[A-H]$/i.test(answer) && options.length) {
      answer = options[answer.toUpperCase().charCodeAt(0) - 65] ?? answer;
    }
    const rawSubj = String(raw.subject || "").trim();
    const isSource = /^(TMUA|ESAT|NSAA|BMAT|STEP|MAT|PAT|ENGAA|SMC)$/i.test(rawSubj);
    ok(res, {
      subject: isSource ? "数学" : rawSubj,
      sourceType: isSource ? rawSubj.toUpperCase() : null,
      options,
      answer,
      stem: String(raw.stem || "").trim(),
      solution: String(raw.solution || "").trim() || null,
    }, "识别成功,请核对后保存");
  })
);

// POST /api/me/questions/submit — 批量提交审核 { ids: [] } → PENDING_REVIEW
router.post(
  "/questions/submit",
  requireAuth,
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map((x) => String(x)) : [];
    if (ids.length === 0) return fail(res, 400, "请选择要提交的题目");
    const mine = await prisma.question.findMany({ where: { id: { in: ids }, createdBy: req.user.id } });
    if (mine.length === 0) return fail(res, 404, "未找到你的题目");
    const invalid = mine.filter((q) => {
      if (q.status !== "DRAFT") return true;
      return !String(q.stem || "").trim() || parseOpts(q.options).length < 2 || !String(q.answer || "").trim();
    });
    if (invalid.length) return fail(res, 400, "包含不符合提交条件的题目(请确认题干/选项/答案完整,且状态为草稿)");
    await prisma.question.updateMany({
      where: { id: { in: mine.map((q) => q.id) }, createdBy: req.user.id, status: "DRAFT" },
      data: { status: "PENDING_REVIEW", reviewNote: null },
    });
    ok(res, null, `已提交 ${mine.length} 题,等待老师审核`);
  })
);

// PUT /api/me/questions/:id — 编辑自己的草稿
router.put(
  "/questions/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!q || q.createdBy !== req.user.id || q.source !== "学生原创题") return fail(res, 404, "题目不存在");
    if (q.status !== "DRAFT") return fail(res, 400, "仅草稿可编辑(提交审核后请等待老师处理)");
    const { subject, topic, difficulty, stem, options, answer, solution } = req.body || {};
    const opts = Array.isArray(options) ? options.map((o) => String(o).trim()).filter(Boolean) : parseOpts(q.options);
    if (subject) q.subject = String(subject);
    if (topic) q.topic = String(topic);
    if (difficulty) q.difficulty = Math.min(Math.max(Number(difficulty), 1), 5);
    if (String(stem || "").trim()) q.stem = String(stem).trim();
    if (opts.length >= 2) q.options = JSON.stringify(opts);
    if (String(answer || "").trim()) q.answer = String(answer).trim();
    if (solution !== undefined) q.solution = String(solution || "").trim() || null;
    await prisma.question.update({
      where: { id: q.id },
      data: {
        subject: q.subject, topic: q.topic, difficulty: q.difficulty, stem: q.stem,
        options: q.options, answer: q.answer, solution: q.solution,
      },
    });
    ok(res, null, "已保存");
  })
);

// DELETE /api/me/questions/:id — 删除自己的原创题(仅草稿/被驳回)
router.delete(
  "/questions/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = await prisma.question.findUnique({ where: { id: req.params.id } });
    if (!q || q.createdBy !== req.user.id || q.source !== "学生原创题") return fail(res, 404, "题目不存在");
    if (q.status !== "DRAFT" && q.status !== "REJECTED") return fail(res, 400, "该题已提交/已入库,不能删除");
    await prisma.question.delete({ where: { id: q.id } });
    ok(res, null, "已删除");
  })
);

export default router;
