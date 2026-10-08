// 前端 API 客户端:统一封装 fetch、token、错误处理
import type { Question } from "./types";

const BASE = "/api";
const TOKEN_KEY = "wb_token";
const USER_KEY = "wb_user";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function getUser(): { id: string; name: string; role: string } | null {
  if (typeof window === "undefined") return null;
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) || "null");
  } catch {
    return null;
  }
}

export function setUser(user: unknown) {
  localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

function parseOptions(q: Question) {
  if (typeof q.options === "string") {
    try {
      return { ...q, options: JSON.parse(q.options) };
    } catch {
      return { ...q, options: [] };
    }
  }
  return q;
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { ...options, headers });
  } catch {
    throw new Error("无法连接服务器,请确认后端已启动");
  }

  const body = await res.json().catch(() => ({ code: 500, message: "响应解析失败", data: null }));
  if (body.code !== 0) {
    if (body.code === 401 && typeof window !== "undefined") {
      clearAuth();
      window.location.href = "/login";
    }
    throw new Error(body.message || "请求失败");
  }
  // 题目列表/详情的 options 为 JSON 字符串,统一解析为数组
  if (path.startsWith("/questions") && body.data && typeof body.data === "object") {
    if (Array.isArray(body.data.list)) {
      body.data.list = body.data.list.map(parseOptions);
    } else if (body.data.options) {
      body.data = parseOptions(body.data);
    }
  }
  return body.data as T;
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, data?: unknown) => request<T>(p, { method: "POST", body: JSON.stringify(data ?? {}) }),
  put: <T>(p: string, data?: unknown) => request<T>(p, { method: "PUT", body: JSON.stringify(data ?? {}) }),
  patch: <T>(p: string, data?: unknown) => request<T>(p, { method: "PATCH", body: JSON.stringify(data ?? {}) }),
  del: <T>(p: string, data?: unknown) =>
    request<T>(p, { method: "DELETE", body: data ? JSON.stringify(data) : undefined }),
};
