"use client";

import { useCallback, useEffect, useState } from "react";
import { api, getUser } from "@/lib/api";

interface TeacherRow {
  id: string;
  email: string;
  name: string;
  role: "TEACHER" | "ADMIN";
  status: string;
  permSubjects: string[] | null;
  permSourceTypes: string[] | null;
  createdAt: string;
}

const SUBJECTS = ["数学", "物理", "化学", "生物"];
const SOURCE_TYPES = ["TMUA", "ESAT", "ENGAA", "NSAA", "其他"];
const STATUS_LABEL: Record<string, string> = {
  APPROVED: "正常",
  PENDING: "待审核",
  REJECTED: "已停用",
};

interface FormState {
  email: string;
  name: string;
  password: string;
  role: "TEACHER" | "ADMIN";
  status: string;
  permSubjects: string[];
  permSourceTypes: string[];
}

const EMPTY_FORM: FormState = {
  email: "",
  name: "",
  password: "",
  role: "TEACHER",
  status: "APPROVED",
  permSubjects: [],
  permSourceTypes: [],
};

export default function TeacherManagePage() {
  const me = getUser();
  const myId = me?.id;
  const [list, setList] = useState<TeacherRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<TeacherRow | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await api.get<{ list: TeacherRow[] }>("/teacher/admin/teachers");
      setList(data.list || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  }

  function openEdit(t: TeacherRow) {
    setEditing(t);
    setForm({
      email: t.email,
      name: t.name,
      password: "",
      role: t.role,
      status: t.status,
      permSubjects: t.permSubjects || [],
      permSourceTypes: t.permSourceTypes || [],
    });
    setModalOpen(true);
  }

  function toggle(list: string[], v: string): string[] {
    return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      if (editing) {
        const payload: Record<string, unknown> = {
          name: form.name,
          email: form.email,
          permSubjects: form.permSubjects,
          permSourceTypes: form.permSourceTypes,
        };
        if (form.password) payload.password = form.password;
        if (editing.id !== myId) {
          payload.role = form.role;
          payload.status = form.status;
        }
        await api.put(`/teacher/admin/teachers/${editing.id}`, payload);
      } else {
        await api.post("/teacher/admin/teachers", {
          email: form.email,
          password: form.password,
          name: form.name,
          permSubjects: form.permSubjects,
          permSourceTypes: form.permSourceTypes,
        });
      }
      setModalOpen(false);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove(t: TeacherRow) {
    if (!window.confirm(`确定删除教师「${t.name}」吗?该操作会一并清理其分组与作业分发,不可恢复。`)) return;
    setError("");
    try {
      await api.del(`/teacher/admin/teachers/${t.id}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "删除失败");
    }
  }

  const input =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";

  return (
    <div>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-900">教师管理</h1>
          <p className="mt-1 text-sm text-slate-500">新建教师账号并设置其可见范围(学科 / 题源)。留空即代表可见全部。</p>
        </div>
        <button
          onClick={openCreate}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-700"
        >
          + 新建教师
        </button>
      </div>

      {error && <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      <div className="mt-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left text-slate-500">
            <tr>
              <th className="px-4 py-3 font-medium">姓名</th>
              <th className="px-4 py-3 font-medium">登录名</th>
              <th className="px-4 py-3 font-medium">角色</th>
              <th className="px-4 py-3 font-medium">状态</th>
              <th className="px-4 py-3 font-medium">可见学科</th>
              <th className="px-4 py-3 font-medium">可见题源</th>
              <th className="px-4 py-3 font-medium text-right">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">加载中…</td>
              </tr>
            ) : list.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-slate-400">暂无教师账号</td>
              </tr>
            ) : (
              list.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    {t.name}
                    {t.id === myId && <span className="ml-1 text-xs text-slate-400">(我)</span>}
                  </td>
                  <td className="px-4 py-3 text-slate-600">{t.email}</td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${t.role === "ADMIN" ? "bg-amber-100 text-amber-700" : "bg-indigo-100 text-indigo-700"}`}>
                      {t.role === "ADMIN" ? "管理员" : "教师"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">
                    <span className={`rounded-full px-2 py-0.5 text-xs ${t.status === "APPROVED" ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                      {STATUS_LABEL[t.status] || t.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{t.permSubjects && t.permSubjects.length ? t.permSubjects.join("、") : "全部"}</td>
                  <td className="px-4 py-3 text-slate-600">{t.permSourceTypes && t.permSourceTypes.length ? t.permSourceTypes.join("、") : "全部"}</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => openEdit(t)} className="rounded-md px-2 py-1 text-indigo-600 hover:bg-indigo-50">编辑</button>
                    <button
                      onClick={() => remove(t)}
                      disabled={t.id === myId}
                      className="ml-1 rounded-md px-2 py-1 text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:text-slate-300"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold text-slate-900">{editing ? "编辑教师" : "新建教师"}</h2>
            <form onSubmit={submit} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm text-slate-600">登录名(用于登录系统)</label>
                <input className={input} type="text" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="如 xuhexin 或 teacher@x.com" required />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">姓名</label>
                <input className={input} type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="教师姓名" required />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">密码{editing && " (留空则不修改)"}</label>
                <input className={input} type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} placeholder={editing ? "留空保持原密码" : "至少 6 位"} minLength={editing ? 0 : 6} required={!editing} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-slate-600">角色</label>
                  <select className={input} value={form.role} disabled={editing?.id === myId} onChange={(e) => setForm({ ...form, role: e.target.value as FormState["role"] })}>
                    <option value="TEACHER">教师</option>
                    <option value="ADMIN">管理员</option>
                  </select>
                  {editing?.id === myId && <p className="mt-1 text-xs text-slate-400">不能修改自己的角色</p>}
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-600">状态</label>
                  <select className={input} value={form.status} disabled={editing?.id === myId} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                    <option value="APPROVED">正常</option>
                    <option value="PENDING">待审核</option>
                    <option value="REJECTED">已停用</option>
                  </select>
                  {editing?.id === myId && <p className="mt-1 text-xs text-slate-400">不能修改自己的状态</p>}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-600">可见学科(不勾=全部学科)</label>
                <div className="flex flex-wrap gap-2">
                  {SUBJECTS.map((s) => (
                    <label key={s} className={`cursor-pointer rounded-full border px-3 py-1 text-sm transition ${form.permSubjects.includes(s) ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-600"}`}>
                      <input type="checkbox" className="mr-1 hidden" checked={form.permSubjects.includes(s)} onChange={() => setForm({ ...form, permSubjects: toggle(form.permSubjects, s) })} />
                      {s}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm text-slate-600">可见题源(不勾=全部题源)</label>
                <div className="flex flex-wrap gap-2">
                  {SOURCE_TYPES.map((s) => (
                    <label key={s} className={`cursor-pointer rounded-full border px-3 py-1 text-sm transition ${form.permSourceTypes.includes(s) ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-300 text-slate-600"}`}>
                      <input type="checkbox" className="mr-1 hidden" checked={form.permSourceTypes.includes(s)} onChange={() => setForm({ ...form, permSourceTypes: toggle(form.permSourceTypes, s) })} />
                      {s}
                    </label>
                  ))}
                </div>
                {form.role === "ADMIN" && <p className="mt-1 text-xs text-slate-400">管理员始终可见全部内容,此处设置不生效</p>}
                {form.role === "TEACHER" && <p className="mt-1 text-xs text-slate-400">勾选 ESAT 即同时覆盖 ENGAA / NSAA(三者同属 ESAT 题源家族)</p>}
              </div>

              {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">取消</button>
                <button type="submit" disabled={saving} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                  {saving ? "保存中…" : "保存"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
