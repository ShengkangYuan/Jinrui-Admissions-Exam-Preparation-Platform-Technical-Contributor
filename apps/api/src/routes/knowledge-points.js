// 知识点管理(老师/管理员)
// 四门学科:数学 | 物理 | 化学 | 生物。知识点全部由老师手动维护。
// 题目通过 Question.topicIds(JSON 数组)归属到一或多个知识点;导入时自动匹配、匹配不到留白。
import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();

const SUBJECTS = ["数学", "物理", "化学", "生物"];

function parseIds(s) {
  try {
    const arr = JSON.parse(s || "[]");
    return Array.isArray(arr) ? arr.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// GET /api/knowledge-points?subject=数学 — 知识点列表(可按学科过滤,含各知识点关联题目数)
// 登录用户可读(学生端知识点下拉/掌握度"针对练习"需要)
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const subject = req.query.subject ? String(req.query.subject) : "";
    if (subject && !SUBJECTS.includes(subject)) return fail(res, 400, "学科不合法(数学/物理/化学/生物)");
    const list = await prisma.knowledgePoint.findMany({
      where: subject ? { subject } : {},
      orderBy: [{ subject: "asc" }, { sortOrder: "asc" }, { name: "asc" }],
    });
    const withCount = await Promise.all(
      list.map(async (kp) => ({
        ...kp,
        questionCount: await prisma.question.count({ where: { topicIds: { contains: kp.id } } }),
      }))
    );
    ok(res, { list: withCount });
  })
);

// POST /api/knowledge-points — 新建知识点
router.post(
  "/",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { subject, name, sortOrder } = req.body || {};
    const s = String(subject || "").trim();
    const n = String(name || "").trim();
    if (!SUBJECTS.includes(s)) return fail(res, 400, `学科必须为 ${SUBJECTS.join("/")}`);
    if (!n) return fail(res, 400, "知识点名称必填");
    if (n.length > 30) return fail(res, 400, "知识点名称过长(≤30 字)");
    const existed = await prisma.knowledgePoint.findUnique({ where: { subject_name: { subject: s, name: n } } });
    if (existed) return fail(res, 400, `「${s} · ${n}」已存在`);
    const kp = await prisma.knowledgePoint.create({
      data: { subject: s, name: n, sortOrder: Number(sortOrder) || 0 },
    });
    ok(res, kp, `已添加知识点「${s} · ${n}」`);
  })
);

// PUT /api/knowledge-points/:id — 更新知识点
router.put(
  "/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const kp = await prisma.knowledgePoint.findUnique({ where: { id: req.params.id } });
    if (!kp) return fail(res, 404, "知识点不存在");
    const b = req.body || {};
    const data = {};
    if (b.subject !== undefined) {
      const s = String(b.subject).trim();
      if (!SUBJECTS.includes(s)) return fail(res, 400, `学科必须为 ${SUBJECTS.join("/")}`);
      data.subject = s;
    }
    if (b.name !== undefined) {
      const n = String(b.name).trim();
      if (!n) return fail(res, 400, "知识点名称必填");
      if (n.length > 30) return fail(res, 400, "知识点名称过长(≤30 字)");
      data.name = n;
    }
    if (b.sortOrder !== undefined) data.sortOrder = Number(b.sortOrder) || 0;
    // 重名检查(排除自身)
    const finalSubject = data.subject ?? kp.subject;
    const finalName = data.name ?? kp.name;
    const dup = await prisma.knowledgePoint.findUnique({ where: { subject_name: { subject: finalSubject, name: finalName } } });
    if (dup && dup.id !== kp.id) return fail(res, 400, `「${finalSubject} · ${finalName}」已存在`);
    const updated = await prisma.knowledgePoint.update({ where: { id: kp.id }, data });
    ok(res, updated, "已更新知识点");
  })
);

// DELETE /api/knowledge-points/:id — 删除知识点(同时从题目 topicIds 中移除)
router.delete(
  "/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const kp = await prisma.knowledgePoint.findUnique({ where: { id: req.params.id } });
    if (!kp) return fail(res, 404, "知识点不存在");
    await prisma.knowledgePoint.delete({ where: { id: kp.id } });
    // 从所有题目的 topicIds 里移除该 id
    const linked = await prisma.question.findMany({
      where: { topicIds: { contains: kp.id } },
      select: { id: true, topicIds: true, topic: true },
    });
    for (const q of linked) {
      const ids = parseIds(q.topicIds).filter((x) => x !== kp.id);
      let topic = q.topic;
      if (q.topic === kp.name) {
        // 主知识点正好是它,回退到剩余第一个知识点名(若还有)
        topic = ids.length ? (await prisma.knowledgePoint.findUnique({ where: { id: ids[0] } }))?.name || "" : "";
      }
      await prisma.question.update({ where: { id: q.id }, data: { topicIds: JSON.stringify(ids), topic } });
    }
    ok(res, { id: kp.id, removedFrom: linked.length }, `已删除知识点「${kp.subject} · ${kp.name}」,并从 ${linked.length} 道题中移除`);
  })
);

export default router;
