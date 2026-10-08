"use client";

// 每题整体考情表格(共享组件):ExamAnalysisView 与 ExamsPanel 共用。
// 交互:鼠标悬停「题号」弹出该题内容卡片(题干 + 选项,高亮正确答案),移开即消失。
import { useRef, useState, type MouseEvent } from "react";
import { renderRich } from "@/lib/rich";

export interface QuestionStat {
  questionId: string;
  index: number;
  topic: string;
  difficulty: number | null;
  attempts: number;
  correct: number;
  correctRate: number | null;
  avgTimeSpent: number | null;
  // 题目内容(悬停弹卡用;旧数据/接口未升级时可能缺省)
  stem?: string | null;
  options?: string[] | null;
  answer?: string | null;
}

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];
const POPUP_W = 520;
const HIDE_DELAY_MS = 120;

function rateColor(r: number | null | undefined): string {
  if (r == null) return "text-slate-400";
  return r >= 70 ? "text-emerald-600" : r >= 40 ? "text-amber-600" : "text-red-500";
}

export default function QuestionStatsTable({ perQuestion }: { perQuestion: QuestionStat[] }) {
  const [hover, setHover] = useState<{ q: QuestionStat; x: number; y: number } | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function show(q: QuestionStat, e: MouseEvent<HTMLSpanElement>) {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    setHover({ q, x: rect.left, y: rect.bottom });
  }
  function scheduleHide() {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setHover(null), HIDE_DELAY_MS);
  }
  function cancelHide() {
    if (hideTimer.current) {
      clearTimeout(hideTimer.current);
      hideTimer.current = null;
    }
  }

  // 弹卡定位:屏幕正中央(fixed + translate 居中),水平/垂直夹在视口内,不被遮挡
  const vw = typeof window !== "undefined" ? window.innerWidth : 1024;
  const vh = typeof window !== "undefined" ? window.innerHeight : 768;
  // 居中水平:视口中线 - 卡片半宽;并夹在 [16, vw-POPUP_W-16] 内兜底
  const left = hover ? Math.max(16, Math.min((vw - POPUP_W) / 2, vw - POPUP_W - 16)) : 0;

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-sm font-medium text-slate-700">每题整体考情</h2>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-slate-100 text-left text-slate-400">
              <th className="pb-2 font-normal">题号</th>
              <th className="pb-2 font-normal">知识点</th>
              <th className="pb-2 font-normal">难度</th>
              <th className="pb-2 font-normal">作答</th>
              <th className="pb-2 font-normal">答对</th>
              <th className="pb-2 font-normal">正确率</th>
              <th className="pb-2 font-normal">平均用时</th>
            </tr>
          </thead>
          <tbody>
            {perQuestion.map((q) => (
              <tr key={q.questionId} className="border-b border-slate-50">
                <td className="py-2.5">
                  <span
                    className="cursor-help underline decoration-slate-300 decoration-dotted underline-offset-4 hover:text-indigo-600"
                    onMouseEnter={(e) => show(q, e)}
                    onMouseLeave={scheduleHide}
                  >
                    第 {q.index} 题
                  </span>
                </td>
                <td className="py-2.5 text-slate-500">{q.topic || "未分类"}</td>
                <td className="py-2.5 text-slate-500">{q.difficulty ?? "—"}</td>
                <td className="py-2.5">{q.attempts}</td>
                <td className="py-2.5 text-emerald-600">{q.correct}</td>
                <td className={`py-2.5 font-medium ${rateColor(q.correctRate)}`}>
                  {q.correctRate != null ? `${q.correctRate}%` : "—"}
                </td>
                <td className="py-2.5 text-slate-500">{q.avgTimeSpent != null ? `${q.avgTimeSpent}s` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* 悬停弹出的题目内容卡片(fixed 定位,不受 overflow 裁剪) */}
      {hover && (
        <div
          className="fixed z-[1000] max-h-[80vh] overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-2xl"
          style={{ top: "50%", left, width: POPUP_W, maxWidth: `calc(100vw - 32px)`, transform: "translateY(-50%)" }}
          onMouseEnter={cancelHide}
          onMouseLeave={scheduleHide}
        >
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-semibold text-slate-500">
              第 {hover.q.index} 题 · {hover.q.topic || "未分类"}
            </p>
            <span className="shrink-0 text-xs text-slate-400">难度 {hover.q.difficulty ?? "—"}</span>
          </div>
          <div className="mt-2 text-[14px] leading-relaxed text-slate-800">
            {hover.q.stem ? (
              renderRich(hover.q.stem)
            ) : (
              <span className="text-slate-400">题目内容未加载</span>
            )}
          </div>
          {hover.q.options && hover.q.options.length > 0 && (
            <div className="mt-2 space-y-1">
              {hover.q.options.map((opt, j) => {
                const isAns = hover.q.answer != null && opt === hover.q.answer;
                return (
                  <div
                    key={j}
                    className={`rounded px-2.5 py-1 text-[13px] ${
                      isAns ? "bg-emerald-50 font-medium text-emerald-700" : "text-slate-600"
                    }`}
                  >
                    <span className="mr-1 font-semibold text-slate-400">{LETTERS[j]}.</span>
                    {renderRich(opt)}
                    {isAns && <span className="ml-2 text-[11px] text-emerald-600">正确答案</span>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
