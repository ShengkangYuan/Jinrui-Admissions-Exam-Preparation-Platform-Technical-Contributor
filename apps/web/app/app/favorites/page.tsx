"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import { renderRich } from "@/lib/rich";

interface FavItem {
  favoritedAt: string;
  question: {
    id: string;
    subject: string;
    sourceType: string | null;
    topic: string;
    difficulty: number;
    type: string;
    stem: string;
    options: string[];
    answer: string;
    solution: string | null;
    source: string | null;
  };
}

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

export default function FavoritesPage() {
  const [list, setList] = useState<FavItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // 讲评请求相关状态
  const [reviewedMap, setReviewedMap] = useState<Record<string, { note: string | null; status: string }>>({});
  const [reviewTarget, setReviewTarget] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [msg, setMsg] = useState("");

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api.get<{ list: FavItem[] }>("/me/favorites"),
      api.get<{ list: { questionId: string; note: string | null; status: string }[] }>("/review-requests").catch(() => ({ list: [] as { questionId: string; note: string | null; status: string }[] })),
    ])
      .then(([fav, rr]) => {
        setList(fav.list || []);
        const m: Record<string, { note: string | null; status: string }> = {};
        (rr.list || []).forEach((x) => { m[x.questionId] = { note: x.note, status: x.status }; });
        setReviewedMap(m);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function remove(qid: string) {
    try {
      await api.del(`/me/favorites/${qid}`);
      setList((prev) => prev.filter((f) => f.question.id !== qid));
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    }
  }

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 3500); };
  function openReview(qid: string) {
    const existing = reviewedMap[qid];
    setReviewNote(existing?.note || "");
    setReviewTarget(qid);
  }
  async function submitReview() {
    if (!reviewTarget) return;
    setReviewBusy(true);
    try {
      await api.post("/review-requests", { questionId: reviewTarget, source: "FAVORITE", note: reviewNote.trim() });
      setReviewedMap((prev) => ({ ...prev, [reviewTarget as string]: { note: reviewNote.trim() || null, status: "PENDING" } }));
      setReviewTarget(null);
      setReviewNote("");
      flash("已提交讲评请求");
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setReviewBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">⭐ 题目收藏</h1>
          <p className="mt-1 text-sm text-slate-500">做题时收藏的题目,共 {list.length} 题</p>
        </div>
        <button onClick={() => window.history.back()} className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50">
          ← 返回
        </button>
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-400">加载中...</p>
      ) : list.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          还没有收藏题目。做题时点题目右上角「☆ 收藏」即可加入,方便以后查阅复习。
        </p>
      ) : (
        list.map((f) => (
          <div key={f.question.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700">{f.question.subject}</span>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] font-medium text-indigo-600">{f.question.topic}</span>
              {f.question.sourceType && (
                <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[11px] font-medium text-teal-600">{f.question.sourceType}</span>
              )}
              <span className="text-xs text-slate-400">
                难度 {f.question.difficulty} · 收藏于 {new Date(f.favoritedAt).toLocaleString("zh-CN", { hour12: false })}
              </span>
              <button onClick={() => remove(f.question.id)} className="ml-auto text-xs text-red-500 hover:underline">
                移除收藏
              </button>
              {reviewedMap[f.question.id] ? (
                <button
                  onClick={() => openReview(f.question.id)}
                  className="text-xs font-medium text-emerald-600 hover:underline"
                >
                  已提交讲评 ✓
                </button>
              ) : (
                <button
                  onClick={() => openReview(f.question.id)}
                  className="text-xs font-medium text-amber-600 hover:underline"
                >
                  需要讲评
                </button>
              )}
            </div>
            <p className="mt-3 text-[15px] leading-relaxed text-slate-800">{renderRich(f.question.stem)}</p>
            <div className="mt-3 space-y-1">
              {f.question.options.map((opt, j) => {
                const isAns = opt === f.question.answer;
                return (
                  <div key={j} className={`rounded px-3 py-1.5 text-[14px] ${isAns ? "bg-emerald-50 font-medium text-emerald-800" : "text-slate-600"}`}>
                    <span className="mr-1 font-bold text-indigo-600">{LETTERS[j]}.</span>
                    {renderRich(opt, { smart: false })}
                    {isAns && <span className="ml-2 text-xs text-emerald-600">✓ 正确答案</span>}
                  </div>
                );
              })}
            </div>
            {f.question.solution && (
              <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/50 px-3 py-2.5">
                <p className="text-xs font-semibold text-amber-700">💡 解析</p>
                <div className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{renderRich(f.question.solution, { smart: false })}</div>
              </div>
            )}
          </div>
        ))
      )}

      {/* 讲评请求确认弹窗(收藏) */}
      {reviewTarget && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={() => !reviewBusy && setReviewTarget(null)}>
          <div className="mt-24 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-800">请求老师讲评</h2>
              <button onClick={() => !reviewBusy && setReviewTarget(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <p className="mt-2 text-sm text-slate-500">你可以给老师留一句话,说明哪里没看懂(可留空)。</p>
            <textarea
              className="mt-3 min-h-[80px] w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-indigo-500"
              value={reviewNote}
              onChange={(e) => setReviewNote(e.target.value)}
              placeholder="例如:这道向量题的几何意义不太明白..."
            />
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => !reviewBusy && setReviewTarget(null)} disabled={reviewBusy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                取消
              </button>
              <button onClick={submitReview} disabled={reviewBusy} className="rounded-lg bg-amber-500 px-5 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-60">
                {reviewBusy ? "提交中..." : "确认提交"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
