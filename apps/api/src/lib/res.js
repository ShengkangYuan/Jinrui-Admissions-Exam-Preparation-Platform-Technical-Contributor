// 统一响应结构:{ code, message, data }
// code: 0 成功 | 400 参数错误 | 401 未认证 | 403 无权限 | 404 不存在 | 500 服务器错误

export const ok = (res, data = null, message = "ok") =>
  res.json({ code: 0, message, data });

export const fail = (res, code, message) => {
  const status = code >= 500 ? 500 : code >= 400 && code < 500 ? code : 500;
  return res.status(status).json({ code, message, data: null });
};

// 包装异步路由,统一捕获异常
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
