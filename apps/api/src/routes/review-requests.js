import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { parseJsonArray } from "../lib/vision.js";

const router = Router();

// 解析每题所属套题信息(标题 + 题源类型)。
// 历史约定:模考1–5 在 Question.paper 冗余存「套题标题」;模考6+ 起不再写 paper,
// 改由 Paper.questionIds(JSON 数组)反向关联。故解析需两步:
//   1) 读 Question.paper 冗余字段(模考1–5)
//   2) 若无,反向扫描所有 Paper.questionIds 找出包含该题的试卷(模考6+)
// 返回 Map<questionId, { paperTitle, paperSourceType, paperSource, paperSubject } | null>
async function resolveQuestionPapers(qids) {
  const ids = [...new Set(qids.filter(Boolean))];
  if (ids.length === 0) return new Map();

  // 1) 冗余 paper 字段(模考1–5)
  const qs = await prisma.question.findMany({
    where: { id: { in: ids } },
    select: { id: true, paper: true },
  });
  const legacy = new Map(qs.map((q) => [q.id, q.paper || null]));

  // 2) 反向查 Paper.questionIds(模考6+)
  const papers = await prisma.paper.findMany({
    select: { id: true, title: true, sourceType: true, source: true, subject: true, questionIds: true },
  });
  const byQid = new Map();
  for (const p of papers) {
    let arr = [];
    try { arr = JSON.parse(p.questionIds || "[]"); } catch { arr = []; }
    if (!Array.isArray(arr)) continue;
    for (const id of arr) {
      if (id && !byQid.has(id)) {
        byQid.set(id, {
          paperTitle: p.title,
          paperSourceType: p.sourceType || null,
          paperSource: p.source || null,
          paperSubject: p.subject || null,
        });
      }
    }
  }

  // 3) 合并:优先反向查到的(信息更全),否则退化用冗余标题
  const out = new Map();
  for (const id of ids) {
    const rev = byQid.get(id);
    if (rev) { out.set(id, rev); continue; }
    const lg = legacy.get(id);
    out.set(id, lg ? { paperTitle: lg, paperSourceType: null, paperSource: null, paperSubject: null } : null);
  }
  return out;
}
// 学生提交 / 查看自己的请求;教师查看聚合列表、标记状态
router.use(requireAuth);

// POST /api/review-requests — 学生提交/更新讲评请求(幂等:同生同题仅一条)
// body: { questionId, source: "WRONG_BOOK" | "FAVORITE", note?: string }
router.post(
  "/",
  requireRole("STUDENT"),
  asyncHandler(async (req, res) => {
    const { questionId, source, note } = req.body || {};
    if (!questionId) return fail(res, 400, "缺少题目参数");
    const src = source === "FAVORITE" ? "FAVORITE" : "WRONG_BOOK";
    const q = await prisma.question.findUnique({ where: { id: questionId } });
    if (!q) return fail(res, 404, "题目不存在");
    // 幂等 upsert:已存在则更新来源/附言,不新增行(同生同题不重复)
    const rec = await prisma.reviewRequest.upsert({
      where: { studentId_questionId: { studentId: req.user.id, questionId } },
      create: {
        studentId: req.user.id,
        questionId,
        source: src,
        note: note ? String(note).slice(0, 500) : null,
        status: "PENDING",
      },
      update: {
        source: src,
        note: note !== undefined ? String(note).slice(0, 500) : undefined,
        status: "PENDING",
        updatedAt: new Date(),
      },
    });
    ok(res, { id: rec.id, status: rec.status }, "已提交讲评请求,老师会在「学生讲评请求」中看到");
  })
);

// GET /api/review-requests — 学生查看自己已提交的题目集合(供前端标记"已提交")
router.get(
  "/",
  requireRole("STUDENT"),
  asyncHandler(async (req, res) => {
    const list = await prisma.reviewRequest.findMany({
      where: { studentId: req.user.id },
      select: { questionId: true, source: true, note: true, status: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    const qids = [...new Set(list.map((l) => l.questionId))];
    const paperMap = await resolveQuestionPapers(qids);
    ok(res, {
      list: list.map((l) => ({
        ...l,
        paperTitle: (paperMap.get(l.questionId) || {}).paperTitle || null,
      })),
    });
  })
);

// GET /api/review-requests/teacher — 教师端:按题目聚合查看所有讲评请求(去重,一题一行)
// ?status=PENDING|RESOLVED 过滤;?subject= 过滤
router.get(
  "/teacher",
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : undefined;
    const subject = req.query.subject ? String(req.query.subject) : undefined;
    const where = {};
    if (status === "PENDING" || status === "RESOLVED") where.status = status;
    if (subject) where.question = { subject };

    const reqs = await prisma.reviewRequest.findMany({
      where,
      include: {
        question: {
          select: {
            id: true, subject: true, topic: true, difficulty: true,
            stem: true, sourceType: true, options: true, answer: true, solution: true,
          },
        },
        student: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    // 解析每题所属套题(标题/题源),供前端标注「源自哪套题」
    const qids = [...new Set(reqs.map((r) => r.questionId))];
    const paperMap = await resolveQuestionPapers(qids);

    // 按 questionId 聚合:同一题只出现一次,附提交者姓名列表 + 人数 + 状态
    const map = new Map();
    for (const r of reqs) {
      const qid = r.questionId;
      if (!map.has(qid)) {
        map.set(qid, {
          question: {
            ...r.question,
            options: parseJsonArray(r.question.options),
          },
          submitters: [],
          count: 0,
          anyPending: false,
          latestAt: r.createdAt,
        });
      }
      const item = map.get(qid);
      item.submitters.push({ id: r.student.id, name: r.student.name, source: r.source });
      item.count += 1;
      if (r.status === "PENDING") item.anyPending = true;
      if (new Date(r.createdAt) > new Date(item.latestAt)) item.latestAt = r.createdAt;
    }

    const list = [...map.values()].map((it) => {
      const paper = paperMap.get(it.question.id) || null;
      return {
        question: {
          ...it.question,
          paperTitle: paper ? paper.paperTitle : null,
          paperSourceType: paper ? paper.paperSourceType : null,
          paperSource: paper ? paper.paperSource : null,
        },
        submitters: it.submitters,
        count: it.count,
        status: it.anyPending ? "PENDING" : "RESOLVED",
        latestAt: it.latestAt,
      };
    });
    ok(res, { list });
  })
);

// PATCH /api/review-requests/teacher/:questionId — 教师标记某题讲评状态(对该题所有请求)
// body: { status: "PENDING" | "RESOLVED" }
router.patch(
  "/teacher/:questionId",
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    if (status !== "PENDING" && status !== "RESOLVED") return fail(res, 400, "状态非法");
    const r = await prisma.reviewRequest.updateMany({
      where: { questionId: req.params.questionId },
      data: { status },
    });
    if (!r.count) return fail(res, 404, "该题暂无讲评请求");
    ok(res, null, status === "RESOLVED" ? "已标记为已讲评" : "已重新标记为待讲评");
  })
);

export default router;
