import jwt from "jsonwebtoken";
import { fail } from "../lib/res.js";
import { prisma } from "../lib/db.js";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";

export function signToken(user) {
  return jwt.sign({ sub: user.id, role: user.role }, SECRET, { expiresIn: "7d" });
}

// 认证中间件:解析 Bearer token,挂载 req.user
export async function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return fail(res, 401, "未登录或 token 缺失");
  try {
    const payload = jwt.verify(token, SECRET);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) return fail(res, 401, "用户不存在");
    // 学生账号未通过审核时,即使持有效 token 也禁止访问任何业务接口
    if (user.role === "STUDENT" && user.status !== "APPROVED") {
      return fail(res, 403, user.status === "PENDING" ? "账号待教师审核，暂无法使用" : "账号未通过审核，无法使用");
    }
    req.user = user;
    next();
  } catch {
    return fail(res, 401, "token 无效或已过期");
  }
}

// 角色中间件:requireRole("TEACHER", "ADMIN") 等
export const requireRole =
  (...roles) =>
  (req, res, next) => {
    if (!req.user) return fail(res, 401, "未认证");
    if (!roles.includes(req.user.role)) return fail(res, 403, "无权限执行此操作");
    next();
  };
