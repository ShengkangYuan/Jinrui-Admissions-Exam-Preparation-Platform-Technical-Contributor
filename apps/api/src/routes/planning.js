// 升学规划模块(独立命名空间 /api/planning)
// 与笔试题库/会话/作业/讲评等完全隔离:仅读写 PlanningProfile 表,不触碰任何笔试相关 model/路由。
// 注意:public/planning.html 的 fetch 直接 r.json() 解析为裸对象,不消费 {code,message,data} 信封,
//       因此本路由统一返回裸 JSON(res.json(...)),禁止使用 res 信封工具,否则前端 applyProfile 会读不到字段。

import express from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { asyncHandler } from "../lib/res.js";
import { prisma } from "../lib/db.js";

const router = express.Router();

// 读权限:本人(学生读自己)/教师/管理员
function canRead(req, studentId) {
  if (req.user.role === "TEACHER" || req.user.role === "ADMIN") return true;
  return req.user.id === studentId; // 学生只能读自己的档案
}

// GET /api/planning/students —— 仅教师/管理员:返回已审核学生列表(供下拉选择)
router.get(
  "/students",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const students = await prisma.user.findMany({
      where: { role: "STUDENT", status: "APPROVED" },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    });
    res.json({ students });
  })
);

// ---------- 教师端「学生档案」可视化表单(聚合全部学生规划档案) ----------
// 从结构化档案派生单行摘要(name 之外的列);若存在 data.archive 覆盖层则覆盖层优先(教师人工修订)。
function deriveArchive(data) {
  const d = data || {};
  const subs = Array.isArray(d.subjects) ? d.subjects : [];
  const comps = Array.isArray(d.competitions) ? d.competitions : [];
  const langs = Array.isArray(d.language_scores) ? d.language_scores : [];
  const eng = langs
    .filter((l) => l && String(l.overall || "").trim())
    .map((l) => {
      const t = String(l.test || "");
      let pre = "";
      if (/toefl/i.test(t)) pre = "托福";
      else if (/duolingo/i.test(t)) pre = "多邻国";
      else if (/pte/i.test(t)) pre = "PTE";
      return pre + String(l.overall);
    })
    .join("、");
  const contest = comps
    .filter((c) => c && String(c.name || "").trim())
    .map((c) => String(c.name) + (String(c.award || "").trim() ? " " + String(c.award) : ""))
    .join("、");
  const fmtSub = (s) => (s.subject || "") + (s.grade || "");
  const exam = subs.filter((s) => s && s.status === "Achieved").map(fmtSub).join("、");
  // 预估列:Predicted(或填了等级但未标实考)的科目照旧显示「科目+等级」;
  // 只选了科目名、还没有等级的 → 显示「科目 (Pending)」(用户 2026-09-22:如 Mathematics (Pending))。
  // 注意:表单里 status/grade 的默认占位值就是字面量 "Pending",必须视为「未出分」而非等级。
  const predParts = [];
  const pend = [];
  const seenPend = new Set();
  subs.forEach((s) => {
    const nm = s && String(s.subject || "").trim();
    if (!nm) return;
    if (s.status === "Achieved") return; // 实考已出分,归「实考」列
    const g = String(s.grade || "").trim();
    if (g && g.toLowerCase() !== "pending") {
      predParts.push(fmtSub(s)); // 已有预估等级
      return;
    }
    const key = nm.toLowerCase();
    if (!seenPend.has(key)) {
      seenPend.add(key);
      pend.push(nm + " (Pending)");
    }
  });
  const pred = predParts.join("、");
  const counts = {};
  subs
    .filter((s) => s && s.status === "Achieved" && s.grade)
    .forEach((s) => {
      counts[s.grade] = (counts[s.grade] || 0) + 1;
    });
  const order = ["A*", "A", "B", "C", "D", "E"];
  const summary = order
    .filter((g) => counts[g])
    .map((g) => `${counts[g]}${g}`)
    .join(", ");
  return { summary, exam, pred, pend, contest, eng };
}

// GET /api/planning/teacher/archive —— 教师/管理员:聚合所有学生档案行
router.get(
  "/teacher/archive",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    // 仅纳入「填写且被关联过规划任务」的学生:既有 PlanningProfile 档案,又至少有一条 PlanningTaskStudent 关联(状态不限)
    const taskStus = await prisma.planningTaskStudent.findMany({
      select: { studentId: true },
    });
    const taskStudentIds = Array.from(new Set(taskStus.map((s) => s.studentId)));
    const users = await prisma.user.findMany({
      where: { role: "STUDENT", id: { in: taskStudentIds } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, status: true },
    });
    const rows = (
      await Promise.all(
        users.map(async (u) => {
          const prof = await prisma.planningProfile.findUnique({ where: { studentId: u.id } });
          if (!prof) return null; // 无档案则排除(仅显示填写过档案且被关联任务的学生)
          const data = JSON.parse(prof.data || "{}");
          const ov = data && data.archive ? data.archive : null;
          const der = deriveArchive(data);
          // 预估列合并:教师覆盖层优先;再把「未出分科目 (Pending)」追加进去(按「、」分词去重,避免重复追加)。
          const base = ov && typeof ov.pred === "string" && ov.pred.trim() ? ov.pred : der.pred;
          const baseToks = String(base).split("、").map((t) => t.trim());
          const extra = (der.pend || []).filter((p) => {
            const bare = p.replace(/ \(Pending\)$/, "");
            return !baseToks.some((t) => t === p || t === bare);
          });
          const pred = [base, ...extra].filter(Boolean).join("、");
          return {
            id: u.id,
            name: u.name,
            status: u.status,
            hl: !!(ov && ov.hl),
            summary: ov ? ov.summary ?? der.summary : der.summary,
            exam: ov ? ov.exam ?? der.exam : der.exam,
            pred: pred,
            contest: ov ? ov.contest ?? der.contest : der.contest,
            eng: ov ? ov.eng ?? der.eng : der.eng,
            year_group: (data && data.year_group) || "",
            hasProfile: true,
          };
        })
      )
    ).filter(Boolean);
    res.json({ students: rows });
  })
);

// PUT /api/planning/teacher/archive —— 教师/管理员:写回编辑结果到各学生 PlanningProfile.data.archive
router.put(
  "/teacher/archive",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const rows = req.body && req.body.rows;
    if (!Array.isArray(rows)) return res.status(400).json({ error: "rows 缺失" });
    let updated = 0;
    for (const r of rows) {
      if (!r || !r.id) continue;
      const prof = await prisma.planningProfile.findUnique({ where: { studentId: r.id } });
      const data = prof ? JSON.parse(prof.data || "{}") : {};
      data.archive = {
        summary: String(r.summary || ""),
        exam: String(r.exam || ""),
        pred: String(r.pred || ""),
        contest: String(r.contest || ""),
        eng: String(r.eng || ""),
        hl: !!r.hl,
      };
      await prisma.planningProfile.upsert({
        where: { studentId: r.id },
        create: { studentId: r.id, data: JSON.stringify(data) },
        update: { data: JSON.stringify(data) },
      });
      updated++;
    }
    res.json({ ok: true, updated });
  })
);

// GET /api/planning/student/:id —— 本人或教师/管理员可读:返回裸档案 JSON,未找到返回 null
router.get(
  "/student/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!canRead(req, id)) return res.status(403).json({ error: "无权限读取该学生档案" });
    const profile = await prisma.planningProfile.findUnique({ where: { studentId: id } });
    if (!profile) return res.json(null);
    res.json(JSON.parse(profile.data));
  })
);

// POST /api/planning/student/:id
//   教师/管理员:可写任意学生档案(原行为)
//   学生:仅可写本人档案(档案填写任务场景 -> 自动保存/草稿)。写本人时将其名下 ACTIVE 任务中
//         PENDING 态置为 DRAFT(中途退出不丢内容,再次进入仍可见草稿;未提交=草稿已落库)
router.post(
  "/student/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    const data = req.body;
    if (!data || typeof data !== "object") return res.status(400).json({ error: "档案数据缺失" });
    const isTeacher = req.user.role === "TEACHER" || req.user.role === "ADMIN";
    const isSelf = req.user.role === "STUDENT" && req.user.id === id;
    if (!isSelf && !isTeacher) return res.status(403).json({ error: "无权限填写该档案" });
    await prisma.planningProfile.upsert({
      where: { studentId: id },
      create: { studentId: id, data: JSON.stringify(data) },
      update: { data: JSON.stringify(data) },
    });
    if (isSelf) {
      const activeTaskIds = (
        await prisma.planningTask.findMany({ where: { status: "ACTIVE" }, select: { id: true } })
      ).map((t) => t.id);
      if (activeTaskIds.length) {
        await prisma.planningTaskStudent.updateMany({
          where: { studentId: id, status: "PENDING", taskId: { in: activeTaskIds } },
          data: { status: "DRAFT" },
        });
      }
    }
    res.json({ snapshot: new Date().toISOString() });
  })
);

// GET /api/planning/student/:id/plan —— 本人或教师/管理员可读:返回知识库/规划方案裸 JSON,未找到返回 null
router.get(
  "/student/:id/plan",
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = req.params.id;
    if (!canRead(req, id)) return res.status(403).json({ error: "无权限读取该学生规划方案" });
    const profile = await prisma.planningProfile.findUnique({ where: { studentId: id } });
    if (!profile || !profile.plan) return res.json(null);
    res.json(JSON.parse(profile.plan));
  })
);

// ============================================================
// 档案填写任务(独立:PlanningTask / PlanningTaskStudent,与笔试题库/作业/会话无任何关联)

// 新注册学生审核通过时,自动授予一次「提交升学档案」默认任务(幂等:该生已有任意任务则不重复建)
// 由 teacher.js 的审核通过接口调用。teacherId 取审核通过者(教师/管理员)。
export async function ensureDefaultPlanningTaskForStudent(p, studentId, teacherId) {
  const existing = await p.planningTaskStudent.findFirst({ where: { studentId } });
  if (existing) return null;
  const task = await p.planningTask.create({
    data: {
      teacherId,
      title: "完善你的升学规划档案",
      intro: "请尽快完善并提交你的升学规划档案，便于老师了解你的升学方向与进度。",
    },
  });
  await p.planningTaskStudent.create({ data: { taskId: task.id, studentId } });
  return task;
}
// 裸 JSON 契约(res.json(...)),不消费信封,与上面保持一致。
// ============================================================

// 仅教师/管理员可发布与管理任务
function ensureTeacher(req, res) {
  if (req.user.role !== "TEACHER" && req.user.role !== "ADMIN") {
    res.status(403).json({ error: "仅教师/管理员可管理档案填写任务" });
    return false;
  }
  return true;
}

// POST /api/planning/tasks —— 教师/管理员发布任务:建 PlanningTask + 批量建 PlanningTaskStudent
// body: { title?, intro?, studentIds: string[] }
router.post(
  "/tasks",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureTeacher(req, res)) return;
    const { title, intro, studentIds } = req.body || {};
    if (!Array.isArray(studentIds) || studentIds.length === 0) {
      return res.status(400).json({ error: "请至少选择一名学生" });
    }
    const cleanIds = [...new Set(studentIds.map((s) => String(s).trim()).filter(Boolean))];
    if (cleanIds.length === 0) return res.status(400).json({ error: "学生列表无效" });
    const task = await prisma.planningTask.create({
      data: {
        teacherId: req.user.id,
        title: title && String(title).trim() ? String(title).trim() : "完善你的升学规划档案",
        intro: intro && String(intro).trim() ? String(intro).trim() : null,
      },
    });
    await prisma.planningTaskStudent.createMany({
      data: cleanIds.map((sid) => ({ taskId: task.id, studentId: sid })),
    });
    res.json({ task: { id: task.id, title: task.title } });
  })
);

// GET /api/planning/tasks —— 教师/管理员列出本人发布的任务及每个学生状态
router.get(
  "/tasks",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureTeacher(req, res)) return;
    const tasks = await prisma.planningTask.findMany({
      where: { teacherId: req.user.id },
      orderBy: { createdAt: "desc" },
    });
    const result = await Promise.all(
      tasks.map(async (t) => {
        const stus = await prisma.planningTaskStudent.findMany({ where: { taskId: t.id } });
        const ids = stus.map((s) => s.studentId);
        const users =
          ids.length > 0
            ? await prisma.user.findMany({
                where: { id: { in: ids } },
                select: { id: true, name: true },
              })
            : [];
        const nameMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
        return {
          id: t.id,
          title: t.title,
          intro: t.intro,
          status: t.status,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          students: stus.map((s) => ({
            studentId: s.studentId,
            name: nameMap[s.studentId] || s.studentId,
            status: s.status,
            submittedAt: s.submittedAt,
          })),
        };
      })
    );
    res.json({ tasks: result });
  })
);

// GET /api/planning/tasks/:id —— 任务详情 + 学生清单状态(仅发布者)
router.get(
  "/tasks/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureTeacher(req, res)) return;
    const t = await prisma.planningTask.findUnique({ where: { id: req.params.id } });
    if (!t) return res.status(404).json({ error: "任务不存在" });
    if (t.teacherId !== req.user.id) return res.status(403).json({ error: "无权访问该任务" });
    const stus = await prisma.planningTaskStudent.findMany({ where: { taskId: t.id } });
    const ids = stus.map((s) => s.studentId);
    const users =
      ids.length > 0
        ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true } })
        : [];
    const nameMap = Object.fromEntries(users.map((u) => [u.id, u.name]));
    res.json({
      task: {
        id: t.id,
        title: t.title,
        intro: t.intro,
        status: t.status,
        createdAt: t.createdAt,
        updatedAt: t.updatedAt,
        students: stus.map((s) => ({
          studentId: s.studentId,
          name: nameMap[s.studentId] || s.studentId,
          status: s.status,
          submittedAt: s.submittedAt,
        })),
      },
    });
  })
);

// POST /api/planning/tasks/:id/students/:sid/reset —— 重开某学生的任务(PENDING,清空 submittedAt)
router.post(
  "/tasks/:id/students/:sid/reset",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureTeacher(req, res)) return;
    const t = await prisma.planningTask.findUnique({ where: { id: req.params.id } });
    if (!t || t.teacherId !== req.user.id) return res.status(403).json({ error: "无权操作该任务" });
    const rec = await prisma.planningTaskStudent.update({
      where: { taskId_studentId: { taskId: req.params.id, studentId: req.params.sid } },
      data: { status: "PENDING", submittedAt: null },
    });
    res.json({ student: { studentId: rec.studentId, status: rec.status } });
  })
);

// POST /api/planning/tasks/:id/close —— 教师关闭任务(ACTIVE->CLOSED,学生端不再显示)
router.post(
  "/tasks/:id/close",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureTeacher(req, res)) return;
    const t = await prisma.planningTask.findUnique({ where: { id: req.params.id } });
    if (!t || t.teacherId !== req.user.id) return res.status(403).json({ error: "无权操作该任务" });
    const updated = await prisma.planningTask.update({
      where: { id: req.params.id },
      data: { status: "CLOSED" },
    });
    res.json({ task: { id: updated.id, status: updated.status } });
  })
);

// POST /api/planning/tasks/:id/open —— 教师重新打开任务(CLOSED->ACTIVE)
router.post(
  "/tasks/:id/open",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureTeacher(req, res)) return;
    const t = await prisma.planningTask.findUnique({ where: { id: req.params.id } });
    if (!t || t.teacherId !== req.user.id) return res.status(403).json({ error: "无权操作该任务" });
    const updated = await prisma.planningTask.update({
      where: { id: req.params.id },
      data: { status: "ACTIVE" },
    });
    res.json({ task: { id: updated.id, status: updated.status } });
  })
);

// DELETE /api/planning/tasks/:id —— 教师删除任务(连同学生关联记录;学生已填的规划档案数据不受影响)
router.delete(
  "/tasks/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!ensureTeacher(req, res)) return;
    const t = await prisma.planningTask.findUnique({ where: { id: req.params.id } });
    if (!t || t.teacherId !== req.user.id) return res.status(403).json({ error: "无权操作该任务" });
    await prisma.$transaction([
      prisma.planningTaskStudent.deleteMany({ where: { taskId: t.id } }),
      prisma.planningTask.delete({ where: { id: t.id } }),
    ]);
    res.json({ deleted: t.id });
  })
);

// GET /api/planning/my-tasks —— 学生本人:返回其 ACTIVE 且本人状态!=SUBMITTED 的任务(驱动档案填写 tab 显示)
router.get(
  "/my-tasks",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== "STUDENT") return res.status(403).json({ error: "仅学生可访问" });
    const stus = await prisma.planningTaskStudent.findMany({
      where: { studentId: req.user.id, status: { not: "SUBMITTED" } },
    });
    const taskIds = stus.map((s) => s.taskId);
    const tasks =
      taskIds.length > 0
        ? await prisma.planningTask.findMany({ where: { id: { in: taskIds }, status: "ACTIVE" } })
        : [];
    const statusMap = Object.fromEntries(stus.map((s) => [s.taskId, s.status]));
    res.json({
      tasks: tasks.map((t) => ({
        id: t.id,
        title: t.title,
        intro: t.intro,
        status: statusMap[t.id] || "PENDING",
      })),
    });
  })
);

// POST /api/planning/tasks/:id/submit —— 学生提交:写 PlanningProfile.data + 该生置 SUBMITTED
router.post(
  "/tasks/:id/submit",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.user.role !== "STUDENT") return res.status(403).json({ error: "仅学生可提交" });
    const data = req.body;
    if (!data || typeof data !== "object") return res.status(400).json({ error: "档案数据缺失" });
    const t = await prisma.planningTask.findUnique({ where: { id: req.params.id } });
    if (!t || t.status !== "ACTIVE") return res.status(404).json({ error: "任务不存在或已关闭" });
    const rec = await prisma.planningTaskStudent.findUnique({
      where: { taskId_studentId: { taskId: req.params.id, studentId: req.user.id } },
    });
    if (!rec) return res.status(403).json({ error: "你不在该任务的名单中" });
    if (rec.status === "SUBMITTED") return res.status(409).json({ error: "你已提交过该任务" });
    await prisma.planningProfile.upsert({
      where: { studentId: req.user.id },
      create: { studentId: req.user.id, data: JSON.stringify(data) },
      update: { data: JSON.stringify(data) },
    });
    await prisma.planningTaskStudent.update({
      where: { taskId_studentId: { taskId: req.params.id, studentId: req.user.id } },
      data: { status: "SUBMITTED", submittedAt: new Date() },
    });
    res.json({ snapshot: new Date().toISOString() });
  })
);

export default router;
