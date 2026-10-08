import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const router = Router();
// 仅最高权限管理员 ADMIN 可访问「教师管理」
router.use(requireAuth, requireRole("ADMIN"));

// 把权限数组落库为 JSON 字符串;空/非法 → null(= 全部可见)
function toPermJson(arr) {
  if (Array.isArray(arr) && arr.length) {
    return JSON.stringify(arr.filter((x) => typeof x === "string"));
  }
  return null;
}

// 列表/详情统一返回的安全字段(不泄露 passwordHash)
function safeUser(u) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    status: u.status,
    permSubjects: u.permSubjects ? safeParseArr(u.permSubjects) : null,
    permSourceTypes: u.permSourceTypes ? safeParseArr(u.permSourceTypes) : null,
    createdAt: u.createdAt,
  };
}
function safeParseArr(str) {
  try {
    const v = JSON.parse(str);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

// GET /api/teacher/admin/teachers — 列出所有教师与管理员账号(可管理对象)
router.get(
  "/teachers",
  asyncHandler(async (req, res) => {
    const list = await prisma.user.findMany({
      where: { role: { in: ["TEACHER", "ADMIN"] } },
      orderBy: [{ role: "desc" }, { createdAt: "asc" }],
    });
    ok(res, { list: list.map(safeUser) });
  })
);

// POST /api/teacher/admin/teachers — 新建教师账号(默认 APPROVED 可直接登录)
router.post(
  "/teachers",
  asyncHandler(async (req, res) => {
    const { email, password, name, permSubjects, permSourceTypes } = req.body || {};
    if (!email || !password || !name) return fail(res, 400, "账号(登录名)、密码、姓名必填");
    const login = String(email).trim().toLowerCase();
    const existed = await prisma.user.findUnique({ where: { email: login } });
    if (existed) return fail(res, 400, "该登录名已存在");
    const user = await prisma.user.create({
      data: {
        email: login,
        passwordHash: await bcrypt.hash(password, 10),
        name: String(name).trim(),
        role: "TEACHER", // 教师管理模块只创建教师账号;管理员由种子/脚本创建
        status: "APPROVED",
        permSubjects: toPermJson(permSubjects),
        permSourceTypes: toPermJson(permSourceTypes),
      },
    });
    ok(res, { user: safeUser(user) }, "教师账号创建成功");
  })
);

// PUT /api/teacher/admin/teachers/:id — 编辑教师(姓名 / 登录名 / 重置密码 / 可见范围权限 / 角色 / 状态)
router.put(
  "/teachers/:id",
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || !["TEACHER", "ADMIN"].includes(target.role)) return fail(res, 404, "教师账号不存在");
    const isSelf = target.id === req.user.id;

    const { name, email, password, permSubjects, permSourceTypes, role, status } = req.body || {};
    const data = {};
    if (name !== undefined) data.name = String(name).trim();
    if (email !== undefined && email !== target.email) {
      const login = String(email).trim().toLowerCase();
      const existed = await prisma.user.findUnique({ where: { email: login } });
      if (existed && existed.id !== target.id) return fail(res, 400, "该登录名已被占用");
      data.email = login;
    }
    if (password) data.passwordHash = await bcrypt.hash(String(password), 10);

    // 角色的修改不允许针对自己(防止把自己降权锁死);且只能互转为 TEACHER/ADMIN
    if (role !== undefined && role !== target.role) {
      if (isSelf) return fail(res, 400, "不能修改自己的角色");
      if (!["TEACHER", "ADMIN"].includes(role)) return fail(res, 400, "角色非法");
      data.role = role;
    }
    // 状态同理,不允许把自己置为非 APPROVED(锁死登录)
    if (status !== undefined && status !== target.status) {
      if (isSelf) return fail(res, 400, "不能修改自己的账号状态");
      if (!["PENDING", "APPROVED", "REJECTED"].includes(status)) return fail(res, 400, "状态非法");
      data.status = status;
    }
    // 可见范围权限:仅对 TEACHER 有意义;ADMIN 始终全部可见,这里也存但后端不过滤
    if (permSubjects !== undefined) data.permSubjects = toPermJson(permSubjects);
    if (permSourceTypes !== undefined) data.permSourceTypes = toPermJson(permSourceTypes);

    const updated = await prisma.user.update({ where: { id: target.id }, data });
    ok(res, { user: safeUser(updated) }, "已保存修改");
  })
);

// DELETE /api/teacher/admin/teachers/:id — 删除教师账号(级联清理其分组与作业分发)
router.delete(
  "/teachers/:id",
  asyncHandler(async (req, res) => {
    const target = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!target || !["TEACHER", "ADMIN"].includes(target.role)) return fail(res, 404, "教师账号不存在");
    if (target.id === req.user.id) return fail(res, 400, "不能删除自己");

    // 级联:作业分发 → 分组
    const ownAssignments = await prisma.assignment.findMany({ where: { teacherId: target.id }, select: { id: true } });
    const ownAids = ownAssignments.map((a) => a.id);
    if (ownAids.length) {
      await prisma.assignmentStudent.deleteMany({ where: { assignmentId: { in: ownAids } } });
      await prisma.session.updateMany({ where: { assignmentId: { in: ownAids } }, data: { assignmentId: null } });
      await prisma.languageSession.updateMany({ where: { assignmentId: { in: ownAids } }, data: { assignmentId: null } });
      await prisma.assignment.deleteMany({ where: { id: { in: ownAids } } });
    }
    const ownGroups = await prisma.group.findMany({ where: { teacherId: target.id }, select: { id: true } });
    const ownGids = ownGroups.map((g) => g.id);
    if (ownGids.length) {
      await prisma.groupStudent.deleteMany({ where: { groupId: { in: ownGids } } });
      await prisma.group.deleteMany({ where: { id: { in: ownGids } } });
    }
    await prisma.user.delete({ where: { id: target.id } });
    ok(res, { id: target.id }, `已删除教师「${target.name}」`);
  })
);

export default router;
