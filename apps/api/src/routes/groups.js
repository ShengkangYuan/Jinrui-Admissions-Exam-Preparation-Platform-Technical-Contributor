import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
// 老师/管理员专用
router.use(requireAuth, requireRole("TEACHER", "ADMIN"));

// GET /api/teacher/groups — 当前老师的分组列表(含成员人数与各成员概要)
router.get(
  "/",
  asyncHandler(async (req, res) => {
    const groups = await prisma.group.findMany({
      where: { teacherId: req.user.id },
      orderBy: { createdAt: "asc" },
      include: {
        _count: { select: { students: true } },
        students: {
          select: {
            student: { select: { id: true, name: true, email: true, status: true } },
          },
          orderBy: { student: { name: "asc" } },
        },
      },
    });
    ok(res, {
      list: groups.map((g) => ({
        id: g.id,
        name: g.name,
        note: g.note,
        createdAt: g.createdAt,
        memberCount: g._count.students,
        students: g.students.map((s) => s.student),
      })),
    });
  })
);

// POST /api/teacher/groups — 新建分组
router.post(
  "/",
  asyncHandler(async (req, res) => {
    const name = String(req.body?.name || "").trim();
    if (!name) return fail(res, 400, "请填写分组名称");
    const note = req.body?.note ? String(req.body.note).trim() : null;
    const existing = await prisma.group.findUnique({ where: { teacherId_name: { teacherId: req.user.id, name } } });
    if (existing) return fail(res, 400, "已存在同名分组");
    const group = await prisma.group.create({ data: { teacherId: req.user.id, name, note } });
    ok(res, { id: group.id }, `已创建分组「${name}」`);
  })
);

// PUT /api/teacher/groups/:id — 重命名 / 改备注
router.put(
  "/:id",
  asyncHandler(async (req, res) => {
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group || group.teacherId !== req.user.id) return fail(res, 404, "分组不存在");
    const name = req.body?.name !== undefined ? String(req.body.name).trim() : undefined;
    const note = req.body?.note !== undefined ? (req.body.note ? String(req.body.note).trim() : null) : undefined;
    if (name !== undefined && !name) return fail(res, 400, "分组名称不能为空");
    if (name && name !== group.name) {
      const dup = await prisma.group.findUnique({ where: { teacherId_name: { teacherId: req.user.id, name } } });
      if (dup) return fail(res, 400, "已存在同名分组");
    }
    const updated = await prisma.group.update({
      where: { id: group.id },
      data: { ...(name !== undefined ? { name } : {}), ...(note !== undefined ? { note } : {}) },
    });
    ok(res, { id: updated.id, name: updated.name, note: updated.note }, "分组已更新");
  })
);

// DELETE /api/teacher/groups/:id — 删除分组(成员关联随级联删除)
router.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group || group.teacherId !== req.user.id) return fail(res, 404, "分组不存在");
    await prisma.group.delete({ where: { id: group.id } });
    ok(res, { id: group.id }, `已删除分组「${group.name}」`);
  })
);

// PUT /api/teacher/groups/:id/students — 整体替换成员(传入 studentIds 全量)
router.put(
  "/:id/students",
  asyncHandler(async (req, res) => {
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group || group.teacherId !== req.user.id) return fail(res, 404, "分组不存在");
    const raw = Array.isArray(req.body?.studentIds) ? req.body.studentIds.map(String).filter(Boolean) : [];
    // 仅允许已通过审核的 STUDENT 进入分组
    const valid = await prisma.user.findMany({
      where: { id: { in: raw }, role: "STUDENT", status: "APPROVED" },
      select: { id: true },
    });
    const ids = valid.map((s) => s.id);
    await prisma.$transaction([
      prisma.groupStudent.deleteMany({ where: { groupId: group.id } }),
      prisma.groupStudent.createMany({ data: ids.map((studentId) => ({ groupId: group.id, studentId })) }),
    ]);
    ok(res, { id: group.id, memberCount: ids.length }, `分组「${group.name}」已更新为 ${ids.length} 名学生`);
  })
);

// POST /api/teacher/groups/:id/students — 添加单个学生
router.post(
  "/:id/students",
  asyncHandler(async (req, res) => {
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group || group.teacherId !== req.user.id) return fail(res, 404, "分组不存在");
    const studentId = String(req.body?.studentId || "");
    if (!studentId) return fail(res, 400, "请选择学生");
    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student || student.role !== "STUDENT" || student.status !== "APPROVED") {
      return fail(res, 400, "学生无效或未通过审核");
    }
    const existing = await prisma.groupStudent.findUnique({
      where: { groupId_studentId: { groupId: group.id, studentId } },
    });
    if (existing) return fail(res, 400, "该学生已在分组中");
    await prisma.groupStudent.create({ data: { groupId: group.id, studentId } });
    ok(res, { id: group.id }, `已将「${student.name}」加入分组`);
  })
);

// DELETE /api/teacher/groups/:id/students/:studentId — 移除单个学生
router.delete(
  "/:id/students/:studentId",
  asyncHandler(async (req, res) => {
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group || group.teacherId !== req.user.id) return fail(res, 404, "分组不存在");
    await prisma.groupStudent.deleteMany({ where: { groupId: group.id, studentId: req.params.studentId } });
    ok(res, { id: group.id }, "已移除学生");
  })
);

// GET /api/teacher/groups/:id/assignments — 该分组已布置的模考与作业(含每项统计)
// 仅返回创建时按组布置(groupIds 含本分组)的作业/考试;逐生布置的不在此列。
router.get(
  "/:id/assignments",
  asyncHandler(async (req, res) => {
    const group = await prisma.group.findUnique({ where: { id: req.params.id } });
    if (!group || group.teacherId !== req.user.id) return fail(res, 404, "分组不存在");

    const assignments = await prisma.assignment.findMany({
      where: { teacherId: req.user.id },
      orderBy: { createdAt: "desc" },
      include: {
        paper: { select: { id: true, title: true, subject: true } },
        languagePaper: { select: { id: true, title: true } },
        targets: { select: { studentId: true, status: true } },
        sessions: { select: { studentId: true, score: true, total: true, correctCount: true, submittedAt: true } },
      },
    });

    const list = [];
    for (const a of assignments) {
      // 过滤:仅保留"按组布置"且包含本分组的条目
      let gids = [];
      try { gids = a.groupIds ? JSON.parse(a.groupIds) : []; } catch { gids = []; }
      if (!Array.isArray(gids) || !gids.map(String).includes(String(group.id))) continue;

      const sessionByStudent = new Map(a.sessions.map((s) => [s.studentId, s]));
      let submitted = 0, inProgress = 0, notSubmitted = 0;
      for (const t of a.targets) {
        if (t.status === "SUBMITTED") { submitted++; continue; }
        const sess = sessionByStudent.get(t.studentId);
        if (sess && !sess.submittedAt) inProgress++;
        else notSubmitted++;
      }
      const done = a.sessions.filter((s) => s.submittedAt);
      const scored = done.filter((s) => s.score != null);
      const acc = done.filter((s) => s.total && s.total > 0);
      const avgScore = scored.length ? Math.round(scored.reduce((x, s) => x + (s.score ?? 0), 0) / scored.length) : null;
      const avgAccuracy = acc.length
        ? Math.round(acc.reduce((x, s) => x + ((s.correctCount ?? 0) / s.total) * 100, 0) / acc.length)
        : null;

      list.push({
        id: a.id,
        title: a.title,
        mode: a.mode, // PRACTICE=作业, EXAM=模考
        note: a.note,
        dueAt: a.dueAt,
        createdAt: a.createdAt,
        kind: a.paperId ? "SUBJECT" : a.languagePaperId ? "LANGUAGE" : "UNKNOWN",
        paperTitle: a.paper?.title || a.languagePaper?.title || null,
        subject: a.paper?.subject || null,
        stats: {
          total: a.targets.length,
          submitted,
          inProgress,
          notSubmitted,
          avgScore: avgScore,
          avgAccuracy: avgAccuracy,
        },
      });
    }

    ok(res, { groupId: group.id, groupName: group.name, list });
  })
);

export default router;
