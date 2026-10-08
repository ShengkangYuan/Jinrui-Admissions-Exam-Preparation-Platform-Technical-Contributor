import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
const PUBLIC_FIELDS = {
  id: true,
  subject: true,
  tagClass: true,
  heading: true,
  stem: true,
  focus: true,
  steps: true,
  sortOrder: true,
  status: true,
  createdAt: true,
  updatedAt: true,
};

function parseSteps(q) {
  try {
    return { ...q, steps: JSON.parse(q.steps || "[]") };
  } catch {
    return { ...q, steps: [] };
  }
}

// GET /api/interview — 面试题列表(学生只看已发布,按 sortOrder 排序)
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const where =
      req.user.role === "STUDENT" ? { status: "PUBLISHED" } : req.query.status ? { status: String(req.query.status) } : {};
    const list = await prisma.interviewQuestion.findMany({
      where,
      select: PUBLIC_FIELDS,
      orderBy: { sortOrder: "asc" },
    });
    ok(res, { list: list.map(parseSteps), total: list.length });
  })
);

// GET /api/interview/:id — 面试题详情
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const q = await prisma.interviewQuestion.findUnique({ where: { id: req.params.id } });
    if (!q) return fail(res, 404, "题目不存在");
    if (q.status !== "PUBLISHED" && req.user.role === "STUDENT") return fail(res, 404, "题目不存在");
    ok(res, parseSteps(q));
  })
);

// POST /api/interview — 新增面试题(老师/管理员)
router.post(
  "/",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { subject, tagClass, heading, stem, focus, steps, sortOrder, status } = req.body || {};
    if (!subject || !heading || !stem) return fail(res, 400, "subject、heading、stem 必填");
    const q = await prisma.interviewQuestion.create({
      data: {
        subject,
        tagClass: tagClass || null,
        heading,
        stem,
        focus: focus || "",
        steps: JSON.stringify(steps || []),
        sortOrder: Number(sortOrder) || 0,
        status: status || "PUBLISHED",
      },
    });
    ok(res, parseSteps(q), "创建成功");
  })
);

// PUT /api/interview/:id — 更新面试题(老师/管理员)
router.put(
  "/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.interviewQuestion.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    const b = req.body || {};
    const data = {};
    for (const key of ["subject", "tagClass", "heading", "stem", "focus", "sortOrder", "status"]) {
      if (b[key] !== undefined) data[key] = b[key];
    }
    if (b.steps !== undefined) data.steps = JSON.stringify(b.steps || []);
    const q = await prisma.interviewQuestion.update({ where: { id: req.params.id }, data });
    ok(res, parseSteps(q), "更新成功");
  })
);

// DELETE /api/interview/:id — 删除面试题(管理员)
router.delete(
  "/:id",
  requireAuth,
  requireRole("ADMIN"),
  asyncHandler(async (req, res) => {
    const existed = await prisma.interviewQuestion.findUnique({ where: { id: req.params.id } });
    if (!existed) return fail(res, 404, "题目不存在");
    await prisma.interviewQuestion.delete({ where: { id: req.params.id } });
    ok(res, null, "删除成功");
  })
);

export default router;
