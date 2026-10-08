"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api, setToken, setUser } from "@/lib/api";
import { APP_VERSION } from "@/lib/version";
import type { AuthData } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [form, setForm] = useState({ email: "", password: "", name: "" });
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setSuccess("");
    setLoading(true);
    try {
      if (mode === "register") {
        // 注册不直接登录:等待教师审核通过后方可登录
        const data = await api.post<{ user: AuthData["user"] }>("/auth/register", {
          email: form.email,
          password: form.password,
          name: form.name,
        });
        setSuccess(`注册申请已提交！账号「${data.user.email}」正在等待教师审核，通过后即可登录。`);
        setMode("login");
        setForm({ email: form.email, password: "", name: "" });
      } else {
        const data = await api.post<AuthData>("/auth/login", { email: form.email, password: form.password });
        setToken(data.token);
        setUser(data.user);
        router.push(data.user.role === "STUDENT" ? "/app" : "/teacher");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setLoading(false);
    }
  }

  const input =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-center text-2xl font-bold text-slate-900">金瑞升学金鹰系统</h1>
        <p className="mt-1 text-center text-sm text-slate-500">TMUA / ESAT · 练习 · 模拟考 · 学情分析</p>
        <p className="mt-1 text-center text-xs text-slate-300">{APP_VERSION}</p>

        <div className="mt-6 flex rounded-lg bg-slate-100 p-1 text-sm">
          {(["login", "register"] as const).map((m) => (
            <button
              key={m}
              onClick={() => { setMode(m); setError(""); }}
              className={`flex-1 rounded-md py-1.5 transition ${mode === m ? "bg-white font-medium text-indigo-600 shadow-sm" : "text-slate-500"}`}
            >
              {m === "login" ? "登录" : "注册"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="mt-5 space-y-4">
          {mode === "register" && (
            <div>
              <label className="mb-1 block text-sm text-slate-600">姓名</label>
              <input className={input} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="你的名字" required />
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm text-slate-600">邮箱 / 登录名</label>
            <input className={input} type="text" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="you@example.com 或 xuhexin" required />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">密码</label>
            <input className={input} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder="至少 6 位" minLength={6} required />
          </div>
          {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
          {success && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{success}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-indigo-600 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? "请稍候..." : mode === "login" ? "登录" : "提交注册申请"}
          </button>
          {mode === "register" && (
            <p className="text-center text-xs text-slate-400">公开注册仅创建学生账号，需教师审核通过后才能登录;老师账号请由管理员开通</p>
          )}
        </form>
      </div>
    </main>
  );
}
