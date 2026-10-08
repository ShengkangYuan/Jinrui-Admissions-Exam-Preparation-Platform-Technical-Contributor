"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { renderRich } from "@/lib/rich";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

interface StudentRef {
  studentId: string;
  name: string;
  email: string;
  score: number | null;
  total: number | null;
  correctCount: number | null;
  correctRate: number | null;
}

interface PerQ {
  index: number;
  questionId: string;
  timeSpent: number | null;
  isCorrect: boolean | null;
  selected: string | null;
  topic: string;
  difficulty: number | null;
}

interface WrongQ {
  index: number;
  questionId: string;
  stem: string;
  options: string[];
  answer: string;
  solution: string | null;
  topic: string;
  difficulty: number | null;
  selected: string | null;
  timeSpent: number | null;
}

interface Detail {
  student: {
    studentId: string;
    name: string;
    email: string;
    score: number | null;
    total: number | null;
    correctCount: number | null;
    startedAt: string | null;
    submittedAt: string | null;
  };
  perQuestion: PerQ[];
  wrongQuestions: WrongQ[];
}

function correctLabel(c: boolean | null): string {
  if (c === true) return "答对";
  if (c === false) return "答错";
  return "未答";
}

function fmtTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}

// 秒 → "12分30秒" / "45秒"
function fmtDuration(sec: number | null | undefined): string {
  if (sec == null || sec < 0 || Number.isNaN(sec)) return "—";
  const s = Math.round(sec);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m === 0) return `${r}秒`;
  return `${m}分${r}秒`;
}

// 折线图上的点:按对错上色
function TimeDot(props: any) {
  const { cx, cy, payload } = props;
  if (cx == null || cy == null || payload?.timeSpent == null) return null;
  const c =
    payload.isCorrect === true ? "#10b981" : payload.isCorrect === false ? "#ef4444" : "#94a3b8";
  return <circle cx={cx} cy={cy} r={4} fill={c} stroke="#fff" strokeWidth={1.5} />;
}

export default function StudentExamDetail({
  examId,
  student,
  onClose,
}: {
  examId: string;
  student: StudentRef;
  onClose: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");
  const [openSol, setOpenSol] = useState<Set<number>>(new Set());

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setErr("");
    api
      .get<Detail>(`/exams/${examId}/student/${student.studentId}`)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setErr(e instanceof Error ? e.message : "加载明细失败"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [examId, student.studentId]);

  const chartData = useMemo(
    () =>
      (detail?.perQuestion || []).map((q) => ({
        index: q.index,
        timeSpent: q.timeSpent,
        isCorrect: q.isCorrect,
      })),
    [detail]
  );

  const hasTime = chartData.some((d) => d.timeSpent != null);

  // 总用时相关统计
  const totalAnswerTime = useMemo(
    () => (detail?.perQuestion || []).reduce((acc, q) => acc + (q.timeSpent ?? 0), 0),
    [detail]
  );
  const answeredCount = useMemo(
    () => (detail?.perQuestion || []).filter((q) => q.timeSpent != null).length,
    [detail]
  );
  const avgPerQ = answeredCount > 0 ? Math.round(totalAnswerTime / answeredCount) : null;
  const durationSec = useMemo(() => {
    const a = detail?.student.startedAt;
    const b = detail?.student.submittedAt;
    if (!a || !b) return null;
    const ms = new Date(b).getTime() - new Date(a).getTime();
    return ms > 0 ? ms / 1000 : null;
  }, [detail]);

  const Stat = ({ label, value }: { label: string; value: string }) => (
    <div className="rounded-xl bg-slate-50 px-3 py-2.5">
      <div className="text-[11px] text-slate-400">{label}</div>
      <div className="mt-0.5 text-base font-semibold text-slate-800">{value}</div>
    </div>
  );

  const toggleSol = (i: number) =>
    setOpenSol((prev) => {
      const n = new Set(prev);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={onClose}>
      <div
        className="mt-8 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-800">
              {student.name} <span className="ml-1 text-xs font-normal text-slate-400">{student.email}</span>
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              得分 {detail?.student.score != null ? `${detail.student.score}/${detail.student.total}` : "—"}
              {detail?.student.correctCount != null && (
                <span className="ml-2">答对 {detail.student.correctCount}/{detail.student.total}</span>
              )}
              <span className="ml-2">提交 {fmtTime(detail?.student.submittedAt)}</span>
            </p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600">✕</button>
        </div>

        {loading && <p className="mt-8 text-center text-sm text-slate-400">加载中…</p>}
        {err && <p className="mt-6 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}

        {!loading && !err && detail && (
          <div className="mt-5 space-y-6">
            {/* —— 总用时统计卡 —— */}
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="总答题用时" value={fmtDuration(totalAnswerTime)} />
              <Stat label="总耗时(开考→交卷)" value={fmtDuration(durationSec)} />
              <Stat label="已记录用时题数" value={`${answeredCount}/${detail.perQuestion.length}`} />
              <Stat label="平均每题用时" value={fmtDuration(avgPerQ)} />
            </section>

            {/* —— 每题用时折线图 —— */}
            <section>
              <h3 className="text-sm font-semibold text-slate-700">每道题做题用时</h3>
              <p className="mt-0.5 text-xs text-slate-400">
                绿色=答对 · 红色=答错 · 灰色=未答（横轴为题号,纵轴为用时秒数）
              </p>
              {hasTime ? (
                <div className="mt-3 h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 16, bottom: 4, left: -16 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#eef2f7" />
                      <XAxis
                        dataKey="index"
                        tickFormatter={(v) => `第${v}题`}
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={{ stroke: "#e2e8f0" }}
                      />
                      <YAxis
                        tickFormatter={(v) => `${v}s`}
                        tick={{ fontSize: 11 }}
                        tickLine={false}
                        axisLine={false}
                        width={48}
                      />
                      <Tooltip
                        formatter={(v: any, _n, p: any) => [
                          v != null ? `${v}s（${correctLabel(p?.payload?.isCorrect)}）` : "未作答",
                          "用时",
                        ]}
                        labelFormatter={(l) => `第 ${l} 题`}
                      />
                      <Line
                        type="monotone"
                        dataKey="timeSpent"
                        stroke="#6366f1"
                        strokeWidth={2}
                        connectNulls={false}
                        dot={<TimeDot />}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <p className="mt-3 rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-400">
                  暂无每题用时数据（学生可能未提交或记录缺失）
                </p>
              )}
            </section>

            {/* —— 错题列表 —— */}
            <section>
              <h3 className="text-sm font-semibold text-slate-700">
                错题明细（{detail.wrongQuestions.length} 道）
              </h3>
              {detail.wrongQuestions.length === 0 ? (
                <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-4 text-center text-sm text-emerald-600">
                  全部答对,没有错题 🎉
                </p>
              ) : (
                <div className="mt-3 space-y-3">
                  {detail.wrongQuestions.map((q) => (
                    <div key={q.questionId} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-slate-800">
                          第 {q.index} 题
                          {q.topic && <span className="ml-2 text-xs text-slate-400">{q.topic}</span>}
                        </span>
                        <span className="text-xs text-slate-400">
                          {q.timeSpent != null ? `用时 ${q.timeSpent}s` : "未记录用时"}
                        </span>
                      </div>
                      <p className="mt-2 text-[15px] leading-relaxed text-[#1a1a1a]">{renderRich(q.stem)}</p>
                      <div className="mt-3 space-y-1">
                        {q.options.map((opt, j) => {
                          const isAns = opt === q.answer;
                          const isSel = opt === q.selected;
                          return (
                            <div
                              key={j}
                              className={`rounded px-3 py-1.5 text-[14px] ${
                                isAns
                                  ? "bg-[#e8f5e9] font-medium text-[#1b3a1d]"
                                  : isSel
                                  ? "bg-[#fdecea] text-[#5a1a17]"
                                  : "text-[#5a5346]"
                              }`}
                            >
                              <span className="mr-1 font-bold text-[#00467F]">{LETTERS[j]}.</span>
                              {renderRich(opt)}
                              {isAns && <span className="ml-2 text-xs text-[#2e7d32]">正确答案</span>}
                              {isSel && !isAns && <span className="ml-2 text-xs text-[#c62828]">学生的选择</span>}
                            </div>
                          );
                        })}
                      </div>
                      {q.solution && (
                        <div className="mt-2">
                          <button
                            onClick={() => toggleSol(q.index)}
                            className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:underline"
                          >
                            <span>{openSol.has(q.index) ? "▾" : "▸"}</span>
                            <span>解析</span>
                          </button>
                          {openSol.has(q.index) && (
                            <div className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-[#3a3528]">
                              {renderRich(q.solution, { smart: false })}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
