"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { renderRich } from "@/lib/rich";

interface Submitter {
  id: string;
  name: string;
  source: string; // WRONG_BOOK | FAVORITE
}
interface RRQuestion {
  id: string;
  subject: string;
  topic: string;
  difficulty: number;
  stem: string;
  sourceType: string | null;
  options: string[];
  answer: string;
  solution: string | null;
  paperTitle: string | null;
  paperSourceType: string | null;
  paperSource: string | null;
}
interface RRItem {
  question: RRQuestion;
  submitters: Submitter[];
  count: number;
  status: string; // PENDING | RESOLVED
  latestAt: string;
}

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const STATUS_LABEL: Record<string, string> = { PENDING: "待讲评", RESOLVED: "已讲评" };
const STATUS_CLASS: Record<string, string> = {
  PENDING: "bg-amber-50 text-amber-700",
  RESOLVED: "bg-emerald-50 text-emerald-600",
};
const SOURCE_LABEL: Record<string, string> = { WRONG_BOOK: "错题本", FAVORITE: "收藏" };

export default function ReviewRequestsPanel() {
  const [list, setList] = useState<RRItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [statusFilter, setStatusFilter] = useState(""); // "" | PENDING | RESOLVED
  const [subjectFilter, setSubjectFilter] = useState(""); // "" | 数学 | 物理 | 化学 | 生物
  const [nameFilter, setNameFilter] = useState(""); // 学生姓名搜索(客户端过滤)
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (subjectFilter) params.set("subject", subjectFilter);
    const qs = params.toString();
    api
      .get<{ list: RRItem[] }>(`/review-requests/teacher${qs ? `?${qs}` : ""}`)
      .then((d) => setList(d.list || []))
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, [statusFilter, subjectFilter]);
  useEffect(() => { load(); }, [load]);

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 3500); };

  async function toggleStatus(it: RRItem) {
    const next = it.status === "PENDING" ? "RESOLVED" : "PENDING";
    setBusyId(it.question.id);
    try {
      await api.patch(`/review-requests/teacher/${it.question.id}`, { status: next });
      setList((prev) => prev.map((x) => (x.question.id === it.question.id ? { ...x, status: next } : x)));
      flash(next === "RESOLVED" ? "已标记为已讲评" : "已重新标记为待讲评");
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setBusyId(null);
    }
  }

  const subjects = ["数学", "物理", "化学", "生物"];

  // 学生姓名客户端过滤:保留每题完整提交者名单与人数,仅隐藏无匹配提交者的题目
  const nameQuery = nameFilter.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      nameQuery
        ? list.filter((it) => it.submitters.some((s) => s.name.toLowerCase().includes(nameQuery)))
        : list,
    [list, nameQuery]
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-slate-800">📣 学生讲评请求</h2>
          <p className="mt-1 text-sm text-slate-500">学生从错题本 / 收藏发起的讲评请求,同一题自动去重,可看到提交的学生名单。</p>
        </div>
      </div>

      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {/* 筛选 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl bg-white px-4 py-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">状态</span>
          {[{ v: "", l: "全部" }, { v: "PENDING", l: "待讲评" }, { v: "RESOLVED", l: "已讲评" }].map((t) => (
            <button
              key={t.v}
              onClick={() => setStatusFilter(t.v)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${statusFilter === t.v ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {t.l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">科目</span>
          {[{ v: "", l: "全部" }, ...subjects.map((s) => ({ v: s, l: s }))].map((t) => (
            <button
              key={t.v}
              onClick={() => setSubjectFilter(t.v)}
              className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${subjectFilter === t.v ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
            >
              {t.l}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-slate-500">学生</span>
          <input
            value={nameFilter}
            onChange={(e) => setNameFilter(e.target.value)}
            placeholder="搜索学生姓名…"
            className="w-40 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-200"
          />
          {nameFilter && (
            <button
              onClick={() => setNameFilter("")}
              className="rounded-lg bg-slate-100 px-2 py-1.5 text-xs text-slate-500 transition hover:bg-slate-200"
            >
              清除
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-400">加载中...</p>
      ) : filtered.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          {list.length === 0
            ? "暂无讲评请求。学生从错题本或收藏点击「需要讲评」后会出现在这里。"
            : `未找到姓名包含「${nameFilter.trim()}」的提交学生。`}
        </p>
      ) : (
        <div className="space-y-4">
          {nameQuery && (
            <p className="text-xs text-slate-500">共 {filtered.length} 条讲评请求含学生「{nameFilter.trim()}」</p>
          )}
          {filtered.map((it) => (
            <div key={it.question.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[it.status] ?? "bg-slate-100 text-slate-500"}`}>
                  {STATUS_LABEL[it.status] ?? it.status}
                </span>
                <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{it.question.subject}</span>
                <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-600">{it.question.topic || "未分类"}</span>
                {it.question.paperTitle ? (
                  <span className="rounded-full bg-rose-50 px-2 py-0.5 text-[11px] font-medium text-rose-600">📕 套题：{it.question.paperTitle}</span>
                ) : (
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-400">独立题</span>
                )}
                <span className="text-xs text-slate-400">难度 {it.question.difficulty}</span>
                <span className="ml-auto text-xs text-slate-400">最近提交 {new Date(it.latestAt).toLocaleString("zh-CN", { hour12: false })}</span>
              </div>
              <p className="mt-3 text-[15px] leading-relaxed text-slate-800">{renderRich(it.question.stem)}</p>
              <div className="mt-3 space-y-1">
                {it.question.options.map((opt, j) => {
                  const isAns = opt === it.question.answer;
                  return (
                    <div key={j} className={`rounded px-3 py-1.5 text-[14px] ${isAns ? "bg-emerald-50 font-medium text-emerald-800" : "text-slate-600"}`}>
                      <span className="mr-1 font-bold text-indigo-600">{LETTERS[j]}.</span>
                      {renderRich(opt, { smart: false })}
                      {isAns && <span className="ml-2 text-xs text-emerald-600">✓ 正确答案</span>}
                    </div>
                  );
                })}
              </div>

              {/* 提交者名单 */}
              <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3">
                <span className="text-xs font-medium text-slate-500">提交学生({it.count} 人)</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {it.submitters.map((s) => (
                    <span key={s.id} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-xs text-slate-700 ring-1 ring-slate-200">
                      {s.name}
                      <span className="rounded bg-slate-100 px-1 text-[10px] text-slate-500">{SOURCE_LABEL[s.source] ?? s.source}</span>
                    </span>
                  ))}
                </div>
              </div>

              <div className="mt-4 flex justify-end">
                <button
                  onClick={() => toggleStatus(it)}
                  disabled={busyId === it.question.id}
                  className={`rounded-lg px-4 py-1.5 text-sm font-medium text-white disabled:opacity-50 ${it.status === "PENDING" ? "bg-emerald-600 hover:bg-emerald-700" : "bg-slate-400 hover:bg-slate-500"}`}
                >
                  {busyId === it.question.id ? "处理中..." : it.status === "PENDING" ? "标记为已讲评" : "重新标记为待讲评"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
