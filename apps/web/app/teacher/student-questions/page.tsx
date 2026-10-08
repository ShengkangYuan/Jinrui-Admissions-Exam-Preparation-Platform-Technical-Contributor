"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface SQ {
  id: string;
  subject: string;
  topic: string;
  difficulty: number;
  stem: string;
  options: string[];
  answer: string;
  solution: string | null;
  status: string;
  reviewNote: string | null;
  createdAt: string;
  studentName: string;
  studentEmail: string;
}

const input = "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-indigo-500";
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

type Tab = "PENDING_REVIEW" | "PUBLISHED" | "REJECTED";
const TABS: { v: Tab; l: string }[] = [
  { v: "PENDING_REVIEW", l: "待审核" },
  { v: "PUBLISHED", l: "已入库" },
  { v: "REJECTED", l: "已驳回" },
];

export default function StudentQuestionsPage() {
  const [tab, setTab] = useState<Tab>("PENDING_REVIEW");
  const [list, setList] = useState<SQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ list: SQ[] }>(`/teacher/student-questions?status=${tab}`)
      .then((d) => { setList(d.list || []); setSelected(new Set()); })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [tab]);
  useEffect(() => { load(); }, [load]);

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 4000); };

  async function approveOne(id: string) {
    setBusy(true);
    try {
      await api.post(`/teacher/student-questions/${id}/approve`, {});
      await load();
      flash("已通过并入题库");
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally { setBusy(false); }
  }

  async function rejectOne(id: string) {
    const reason = window.prompt("请输入驳回原因(将反馈给学生):");
    if (reason === null) return;
    setBusy(true);
    try {
      await api.post(`/teacher/student-questions/${id}/reject`, { reason });
      await load();
      flash("已驳回");
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally { setBusy(false); }
  }

  async function batchApprove() {
    if (!selected.size) return;
    setBusy(true);
    try {
      await api.post("/teacher/student-questions/batch-approve", { ids: Array.from(selected) });
      await load();
      flash(`已批量通过 ${selected.size} 题并入题库`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally { setBusy(false); }
  }

  async function batchReject() {
    if (!selected.size) return;
    const reason = window.prompt(`驳回选中的 ${selected.size} 题,请输入原因(留空=未说明):`) ?? "";
    setBusy(true);
    try {
      await api.post("/teacher/student-questions/batch-reject", { ids: Array.from(selected), reason });
      await load();
      flash("已批量驳回");
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally { setBusy(false); }
  }

  const allSelected = list.length > 0 && selected.size === list.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">学生原创题审核</h1>
          <p className="mt-1 text-sm text-slate-500">
            学生上传的原创题(题源标注「学生原创题」,永久标记出题学生姓名),审核通过后入库
          </p>
        </div>
        <div className="flex gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
          {TABS.map((t) => (
            <button
              key={t.v}
              onClick={() => setTab(t.v)}
              className={`rounded-lg px-4 py-1.5 text-sm font-medium transition ${
                tab === t.v ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
              }`}
            >
              {t.l}
            </button>
          ))}
        </div>
      </div>

      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {tab === "PENDING_REVIEW" && list.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-4 py-2.5 shadow-sm">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => setSelected(allSelected ? new Set() : new Set(list.map((q) => q.id)))}
              className="h-4 w-4 accent-indigo-600"
            />
            全选({selected.size}/{list.length})
          </label>
          <button
            onClick={batchApprove}
            disabled={busy || selected.size === 0}
            className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            批量通过入库
          </button>
          <button
            onClick={batchReject}
            disabled={busy || selected.size === 0}
            className="rounded-lg bg-red-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            批量驳回
          </button>
        </div>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-400">加载中...</p>
      ) : list.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          {tab === "PENDING_REVIEW" ? "暂无待审核的学生原创题。" : tab === "PUBLISHED" ? "暂无已入库的学生原创题。" : "暂无被驳回的学生原创题。"}
        </p>
      ) : (
        list.map((q) => (
          <div key={q.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              {tab === "PENDING_REVIEW" && (
                <input
                  type="checkbox"
                  checked={selected.has(q.id)}
                  onChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(q.id)) n.delete(q.id); else n.add(q.id); return n; })}
                  className="h-4 w-4 accent-indigo-600"
                />
              )}
              <span className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-700" title={q.studentEmail}>
                👤 出题学生:{q.studentName}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{q.subject}</span>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-600">{q.topic || "未分类"}</span>
              <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[11px] text-slate-500">难度 {q.difficulty}</span>
              <span className="text-xs text-slate-400">{new Date(q.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
              <div className="ml-auto flex gap-2">
                {tab === "PENDING_REVIEW" && (
                  <>
                    <button onClick={() => approveOne(q.id)} disabled={busy} className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50">
                      通过
                    </button>
                    <button onClick={() => rejectOne(q.id)} disabled={busy} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50 disabled:opacity-50">
                      驳回
                    </button>
                  </>
                )}
                <button
                  onClick={() => setExpanded((prev) => { const n = new Set(prev); if (n.has(q.id)) n.delete(q.id); else n.add(q.id); return n; })}
                  className="text-xs text-slate-500 hover:underline"
                >
                  {expanded.has(q.id) ? "收起" : "展开答案/解析"}
                </button>
              </div>
            </div>

            <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">{q.stem}</p>

            <div className="mt-2 space-y-1">
              {q.options.map((opt, j) => {
                const isAns = opt === q.answer;
                return (
                  <div key={j} className={`rounded px-3 py-1 text-[14px] ${isAns ? "bg-emerald-50 font-medium text-emerald-800" : "text-slate-600"}`}>
                    <span className="mr-1 font-bold text-indigo-600">{LETTERS[j]}.</span>
                    {opt}
                    {isAns && <span className="ml-2 text-xs text-emerald-600">✓ 答案</span>}
                  </div>
                );
              })}
            </div>

            {expanded.has(q.id) && (
              <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/50 px-3 py-2.5">
                {q.solution ? (
                  <>
                    <p className="text-xs font-semibold text-indigo-700">💡 解析</p>
                    <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{q.solution}</div>
                  </>
                ) : (
                  <p className="text-xs text-slate-400">该题未填写解析。</p>
                )}
                {q.reviewNote && (
                  <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600">驳回原因:{q.reviewNote}</p>
                )}
              </div>
            )}
          </div>
        ))
      )}
    </div>
  );
}
