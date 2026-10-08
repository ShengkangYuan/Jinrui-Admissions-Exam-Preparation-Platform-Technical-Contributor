"use client";

import { useCallback, useEffect, useState } from "react";
import { api, getUser } from "@/lib/api";
import { renderRich } from "@/lib/rich";
import type { Question } from "@/lib/types";

interface KnowledgePoint {
  id: string;
  subject: string;
  name: string;
  sortOrder: number;
  questionCount: number;
  createdAt: string;
}

const SUBJECTS = ["数学", "物理", "化学", "生物"];
const SUBJECT_COLOR: Record<string, string> = {
  数学: "bg-indigo-50 text-indigo-600",
  物理: "bg-emerald-50 text-emerald-600",
  化学: "bg-amber-50 text-amber-600",
  生物: "bg-rose-50 text-rose-600",
  TMUA: "bg-violet-50 text-violet-600",
  ESAT: "bg-teal-50 text-teal-600",
};
const STATUS_LABEL: Record<string, string> = { DRAFT: "草稿", PENDING_REVIEW: "待审核", PUBLISHED: "已发布", REJECTED: "已退回", ARCHIVED: "已下架" };
const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-500",
  PENDING_REVIEW: "bg-blue-50 text-blue-600",
  PUBLISHED: "bg-emerald-50 text-emerald-600",
  REJECTED: "bg-red-50 text-red-600",
  ARCHIVED: "bg-slate-100 text-slate-400",
};

export default function KnowledgePage() {
  const user = getUser();
  const [subject, setSubject] = useState("数学");
  const [list, setList] = useState<KnowledgePoint[]>([]);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // 行内编辑状态
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  // 查看知识点下题目
  const [viewKp, setViewKp] = useState<KnowledgePoint | null>(null);
  const [viewList, setViewList] = useState<Question[]>([]);
  const [viewLoading, setViewLoading] = useState(false);
  // 可添加到题目的知识点(同知识点学科),供逐题打标签选择
  const [kpOptions, setKpOptions] = useState<KnowledgePoint[]>([]);

  async function openView(kp: KnowledgePoint) {
    setViewKp(kp);
    setViewList([]);
    setKpOptions([]);
    setViewLoading(true);
    setError("");
    try {
      const [qd, kd] = await Promise.all([
        api.get<{ list: Question[] }>(`/questions?knowledgePointId=${kp.id}&pageSize=50`),
        api.get<{ list: KnowledgePoint[] }>(`/knowledge-points?subject=${encodeURIComponent(kp.subject)}`),
      ]);
      setViewList(qd.list || []);
      setKpOptions(kd.list || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载题目失败");
    } finally {
      setViewLoading(false);
    }
  }

  const load = useCallback(async () => {
    try {
      const d = await api.get<{ list: KnowledgePoint[] }>(`/knowledge-points?subject=${encodeURIComponent(subject)}`);
      setList(d.list || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [subject]);

  useEffect(() => {
    load();
  }, [load]);

  async function add() {
    const n = name.trim();
    if (!n) return setError("请输入知识点名称");
    setBusy(true);
    setError("");
    try {
      const r = await api.post<{ id: string }>("/knowledge-points", { subject, name: n });
      setMessage(r ? "已添加" : "");
      setName("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加失败");
    } finally {
      setBusy(false);
    }
  }

  async function saveEdit(kp: KnowledgePoint) {
    const n = editName.trim();
    if (!n) return setError("名称不能为空");
    setBusy(true);
    setError("");
    try {
      await api.put(`/knowledge-points/${kp.id}`, { name: n });
      setEditingId(null);
      setMessage("已更新");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "更新失败");
    } finally {
      setBusy(false);
    }
  }

  async function remove(kp: KnowledgePoint) {
    if (!window.confirm(`删除知识点「${kp.name}」?${kp.questionCount ? `\n将同时从 ${kp.questionCount} 道题中移除该标签。` : ""}`)) return;
    setError("");
    try {
      await api.del(`/knowledge-points/${kp.id}`);
      setMessage("已删除");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  // 给题目添加知识点标签(按 id 写入 topicIds,后端同步 topic)
  async function addTag(q: Question, kpId: string) {
    const cur = q.topicIds || [];
    if (cur.includes(kpId)) return;
    const next = [...cur, kpId];
    const name = kpOptions.find((k) => k.id === kpId)?.name || "";
    try {
      await api.put(`/questions/${q.id}`, { topicIds: next });
      setViewList((prev) => prev.map((x) => (x.id === q.id ? { ...x, topicIds: next, topics: [...(x.topics || []), name] } : x)));
      load(); // 刷新左侧各知识点关联题目数
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加标签失败");
    }
  }

  // 移除题目的某个知识点标签
  async function removeTag(q: Question, kpId: string) {
    const ids = [...(q.topicIds || [])];
    const names = [...(q.topics || [])];
    const idx = ids.indexOf(kpId);
    if (idx === -1) return;
    ids.splice(idx, 1);
    names.splice(idx, 1);
    try {
      await api.put(`/questions/${q.id}`, { topicIds: ids });
      setViewList((prev) => prev.map((x) => (x.id === q.id ? { ...x, topicIds: ids, topics: names } : x)));
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "移除标签失败");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">知识点管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            维护数学/物理/化学/生物四门学科的知识点标签。导入的题目会自动匹配归类,匹配不到的留空由老师在此补充。
          </p>
        </div>
      </div>

      {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-600">{message}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {/* 学科切换 */}
      <div className="flex gap-2">
        {SUBJECTS.map((s) => (
          <button
            key={s}
            onClick={() => { setSubject(s); setMessage(""); setError(""); }}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${subject === s ? "bg-indigo-600 text-white" : "border border-slate-300 text-slate-600 hover:bg-slate-50"}`}
          >
            {s}
          </button>
        ))}
      </div>

      {/* 新增 */}
      <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder={`新增「${subject}」知识点,如:二次函数、牛顿定律…`}
          className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
        />
        <button onClick={add} disabled={busy || !name.trim()} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
          {busy ? "添加中..." : "+ 添加"}
        </button>
      </div>

      {/* 列表 */}
      {list.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          暂无「{subject}」知识点,请在上方添加
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-left text-slate-400">
              <tr>
                <th className="px-4 py-3 font-normal">知识点名称</th>
                <th className="px-4 py-3 font-normal">关联题目</th>
                <th className="px-4 py-3 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((kp) => (
                <tr key={kp.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    {editingId === kp.id ? (
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && saveEdit(kp)}
                        autoFocus
                        className="w-56 rounded-lg border border-indigo-400 px-3 py-1.5 text-sm outline-none"
                      />
                    ) : (
                      <span className="inline-flex items-center gap-2">
                        <span className={`rounded px-2 py-0.5 text-xs font-medium ${SUBJECT_COLOR[kp.subject] || "bg-slate-100 text-slate-600"}`}>{kp.subject}</span>
                        <span className="font-medium text-slate-700">{kp.name}</span>
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => openView(kp)}
                      title={`查看「${kp.name}」下的题目`}
                      className={`rounded px-2 py-0.5 text-xs transition ${kp.questionCount > 0 ? "bg-indigo-50 text-indigo-600 hover:bg-indigo-100" : "bg-slate-100 text-slate-400 hover:bg-slate-200"}`}
                    >
                      {kp.questionCount} 题
                    </button>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    {editingId === kp.id ? (
                      <>
                        <button onClick={() => saveEdit(kp)} disabled={busy} className="font-medium text-emerald-600 hover:underline disabled:opacity-50">保存</button>
                        <button onClick={() => setEditingId(null)} className="ml-3 text-slate-500 hover:underline">取消</button>
                      </>
                    ) : (
                      <>
                        <button onClick={() => openView(kp)} className="font-medium text-emerald-600 hover:underline">查看题目</button>
                        <button onClick={() => { setEditingId(kp.id); setEditName(kp.name); }} className="ml-3 font-medium text-indigo-600 hover:underline">编辑</button>
                        <button onClick={() => remove(kp)} className="ml-3 text-red-500 hover:underline">删除</button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="text-xs text-slate-400">老师身份: {user?.name}</p>

      {/* 查看知识点下的题目 */}
      {viewKp && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">
                知识点「{viewKp.name}」下的题目
                <span className="ml-2 text-sm font-normal text-slate-400">{viewList.length} 题</span>
              </h2>
              <button onClick={() => setViewKp(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            {viewLoading ? (
              <p className="py-8 text-center text-sm text-slate-400">加载中...</p>
            ) : viewList.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">该知识点下暂无题目</p>
            ) : (
              <div className="mt-4 max-h-[62vh] space-y-3 overflow-y-auto">
                {viewList.map((q, idx) => (
                  <div key={q.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
                    {/* 头部信息条 */}
                    <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-xs font-bold text-white">
                        {idx + 1}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${SUBJECT_COLOR[q.subject] || "bg-slate-100 text-slate-600"}`}>
                        {q.subject}
                      </span>
                      <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_BADGE[q.status] || "bg-slate-100 text-slate-500"}`}>
                        {STATUS_LABEL[q.status] || q.status}
                      </span>
                      <span className="text-xs text-slate-400">难度 {q.difficulty}</span>
                      {q.paper && <span className="max-w-[200px] truncate text-xs text-slate-400">{q.paper}</span>}
                    </div>
                    {/* 题干 + 选项(公式用 KaTeX 渲染) */}
                    <div className="px-4 py-3">
                      <div className="text-[15px] leading-relaxed text-slate-800">{renderRich(q.stem)}</div>
                      {q.options?.length ? (
                        <div className="mt-2.5 space-y-1.5">
                          {q.options.map((opt, j) => (
                            <div key={j} className="flex items-start gap-2 text-sm text-slate-600">
                              <span className="mt-0.5 shrink-0 font-bold text-slate-400">{String.fromCharCode(65 + j)}.</span>
                              <span className="leading-relaxed">{renderRich(String(opt))}</span>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                    {/* 知识点标签:可逐题修改 / 添加 */}
                    <div className="flex flex-wrap items-center gap-1.5 border-t border-slate-100 bg-slate-50/60 px-4 py-2">
                      <span className="text-xs text-slate-400">知识点:</span>
                      {(q.topicIds || []).map((id, i) => (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                          {q.topics?.[i] || "知识点"}
                          <button
                            onClick={() => removeTag(q, id)}
                            title="移除该知识点标签"
                            className="text-indigo-400 transition hover:text-red-500"
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                      {kpOptions.length > 0 && (
                        <select
                          value=""
                          onChange={(e) => { if (e.target.value) addTag(q, e.target.value); }}
                          className="ml-1 rounded-full border border-slate-300 bg-white px-2 py-0.5 text-xs text-slate-500 outline-none hover:border-indigo-400"
                        >
                          <option value="">+ 添加知识点</option>
                          {kpOptions.filter((k) => !(q.topicIds || []).includes(k.id)).map((k) => (
                            <option key={k.id} value={k.id}>{k.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
