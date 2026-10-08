"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import StudentExamDetail from "@/components/StudentExamDetail";
import QuestionStatsTable from "@/components/QuestionStatsTable";

// 考情分析数据结构(与 GET /api/exams/:id/analysis 返回一致)
export interface Analysis {
  exam: { id: string; title: string; note: string | null; dueAt: string | null; createdAt: string };
  paper: { id: string; title: string; subject: string; sourceType: string | null; durationMin: number | null; questionCount: number } | null;
  students: {
    studentId: string;
    name: string;
    email: string;
    status: string;
    submittedAt: string | null;
    score: number | null;
    total: number | null;
    correctCount: number | null;
    correctRate: number | null;
    startedAt: string | null;
  }[];
  perQuestion: { questionId: string; index: number; topic: string; difficulty: number | null; attempts: number; correct: number; correctRate: number | null; avgTimeSpent: number | null; stem?: string | null; options?: string[] | null; answer?: string | null }[];
  overall: { totalStudents: number; submitted: number; pending: number; inProgress: number; avgCorrectRate: number | null; avgScore: number | null };
  suggestions: string[];
}

const ST_LABEL: Record<string, string> = { PENDING: "未交", IN_PROGRESS: "进行中", SUBMITTED: "已交", EXPIRED: "已过期" };
const ST_CLASS: Record<string, string> = {
  PENDING: "bg-slate-100 text-slate-500",
  IN_PROGRESS: "bg-blue-50 text-blue-600",
  SUBMITTED: "bg-emerald-50 text-emerald-600",
  EXPIRED: "bg-red-50 text-red-600",
};

function fmtTime(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN", { hour12: false });
}

function rateColor(r: number | null | undefined): string {
  if (r == null) return "text-slate-400";
  return r >= 70 ? "text-emerald-600" : r >= 40 ? "text-amber-600" : "text-red-500";
}

interface StudentRef {
  studentId: string;
  name: string;
  email: string;
  score: number | null;
  total: number | null;
  correctCount: number | null;
  correctRate: number | null;
}

// 自包含考情分析视图:给定 examId,拉取并渲染考情(总体 / 建议 / 每考生 / 每题 / 单生明细)
export default function ExamAnalysisView({ examId }: { examId: string }) {
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [aiSuggestion, setAiSuggestion] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [llmOn, setLlmOn] = useState(false);
  const [detailStudent, setDetailStudent] = useState<StudentRef | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setAiSuggestion(null);
    setDetailStudent(null);
    api
      .get<Analysis>(`/exams/${examId}/analysis`)
      .then((d) => { if (alive) setAnalysis(d); })
      .catch(() => { if (alive) setAnalysis(null); })
      .finally(() => { if (alive) setLoading(false); });
    api.get<{ llmConfigured: boolean }>("/health").then((d) => { if (alive) setLlmOn(!!d.llmConfigured); }).catch(() => {});
    return () => { alive = false; };
  }, [examId]);

  async function runAiSuggest() {
    if (!analysis) return;
    setAiBusy(true);
    setAiSuggestion(null);
    try {
      const d = await api.post<{ suggestion: string }>(`/exams/${analysis.exam.id}/suggest`, {});
      setAiSuggestion(d?.suggestion || "");
    } catch (e) {
      setAiSuggestion(e instanceof Error ? e.message : "生成教学建议失败");
    } finally {
      setAiBusy(false);
    }
  }

  if (loading) {
    return <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">加载考情中…</p>;
  }
  if (!analysis) {
    return <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">暂无考情数据。</p>;
  }

  return (
    <div className="space-y-4">
      {/* 总体概览 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { label: "考生数", value: analysis.overall.totalStudents },
          { label: "已交", value: `${analysis.overall.submitted}` },
          { label: "平均正确率", value: analysis.overall.avgCorrectRate != null ? `${analysis.overall.avgCorrectRate}%` : "—" },
          { label: "未交 / 进行中", value: `${analysis.overall.pending} / ${analysis.overall.inProgress}` },
        ].map((x) => (
          <div key={x.label} className="rounded-2xl border border-slate-200 bg-white p-4 text-center shadow-sm">
            <p className="text-2xl font-bold text-indigo-600">{x.value}</p>
            <p className="mt-1 text-xs text-slate-500">{x.label}</p>
          </div>
        ))}
      </div>

      {/* 给老师的建议 */}
      <div className="rounded-2xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-indigo-800">给老师的建议</h2>
          <button
            onClick={runAiSuggest}
            disabled={aiBusy || !llmOn}
            title={llmOn ? "用 AI 生成教学建议" : "服务端未配置 LLM_API_KEY,暂不可用"}
            className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {aiBusy ? "生成中…" : "AI 生成教学建议"}
          </button>
        </div>
        <ul className="mt-3 space-y-1.5">
          {analysis.suggestions.map((s, i) => (
            <li key={i} className="text-sm leading-relaxed text-indigo-900">
              <span className="mr-1 text-indigo-400">•</span>
              {s}
            </li>
          ))}
        </ul>
        {aiSuggestion && (
          <div className="mt-3 whitespace-pre-wrap rounded-xl bg-white px-4 py-3 text-sm leading-relaxed text-slate-700 ring-1 ring-indigo-100">
            <p className="mb-1 text-xs font-medium text-indigo-500">AI 教学建议:</p>
            {aiSuggestion}
          </div>
        )}
      </div>

      {/* 每考生考试结果 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-medium text-slate-700">各考生考试结果({analysis.paper ? `《${analysis.paper.title}》` : ""})</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="pb-2 font-normal">考生</th>
                <th className="pb-2 font-normal">状态</th>
                <th className="pb-2 font-normal">得分</th>
                <th className="pb-2 font-normal">正确率</th>
                <th className="pb-2 font-normal">开始</th>
                <th className="pb-2 font-normal">提交</th>
                <th className="pb-2 font-normal text-right">明细</th>
              </tr>
            </thead>
            <tbody>
              {analysis.students.map((s) => (
                <tr key={s.studentId} className="border-b border-slate-50">
                  <td className="py-2.5">
                    <span className="font-medium">{s.name}</span>
                    <span className="ml-1 text-xs text-slate-400">{s.email}</span>
                  </td>
                  <td className="py-2.5">
                    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ST_CLASS[s.status] ?? "bg-slate-100 text-slate-500"}`}>
                      {ST_LABEL[s.status] ?? s.status}
                    </span>
                  </td>
                  <td className="py-2.5">
                    {s.score != null && s.total != null ? `${s.score}/${s.total}` : "—"}
                  </td>
                  <td className={`py-2.5 font-medium ${rateColor(s.correctRate)}`}>
                    {s.correctRate != null ? `${s.correctRate}%` : "—"}
                  </td>
                  <td className="py-2.5 text-slate-500">{fmtTime(s.startedAt)}</td>
                  <td className="py-2.5 text-slate-500">{fmtTime(s.submittedAt)}</td>
                  <td className="py-2.5 text-right">
                    <button
                      onClick={() => setDetailStudent(s)}
                      className="rounded-md bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-600 hover:bg-indigo-100"
                    >
                      查看明细
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 每题分析(题号悬停弹出题目内容) */}
      <QuestionStatsTable perQuestion={analysis.perQuestion} />

      {/* 单个学生考情明细(每题用时折线图 + 错题) */}
      {detailStudent && (
        <StudentExamDetail
          examId={analysis.exam.id}
          student={detailStudent}
          onClose={() => setDetailStudent(null)}
        />
      )}
    </div>
  );
}
