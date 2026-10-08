"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";

type LangPaper = {
  id: string;
  examType: string;
  skill: string;
  title: string;
  segments: { skill: string; durationMin: number; questionCount: number }[];
  mode: string;
  durationMin: number | null;
  kind: string;
  status: string;
  questionCount: number;
  createdAt: string;
};

const EXAMS = ["IELTS", "TOEFL", "KET_PET", "OTHER"];
const EXAM_LABEL: Record<string, string> = { IELTS: "雅思", TOEFL: "托福", KET_PET: "剑桥KET/PET", OTHER: "其他语言" };
const SKILL_LABEL: Record<string, string> = { LISTENING: "听力", READING: "阅读", WRITING: "写作", SPEAKING: "口语", FULL: "全真连考" };
const SKILL_COLOR: Record<string, string> = {
  LISTENING: "#1f6fb2", READING: "#2e6f40", WRITING: "#b8860b", SPEAKING: "#7a3b8f", FULL: "#a14a3a",
};

// 听说读写四大分类(FULL 全真连考单独成块),作为页面主导航
const SKILL_GROUPS = [
  { skill: "LISTENING", icon: "🎧", label: "听力", color: SKILL_COLOR.LISTENING },
  { skill: "READING", icon: "📖", label: "阅读", color: SKILL_COLOR.READING },
  { skill: "WRITING", icon: "✍️", label: "写作", color: SKILL_COLOR.WRITING },
  { skill: "SPEAKING", icon: "🗣️", label: "口语", color: SKILL_COLOR.SPEAKING },
  { skill: "FULL", icon: "📝", label: "全真连考", color: SKILL_COLOR.FULL },
];

export default function StudentLanguagePage() {
  const router = useRouter();
  const [papers, setPapers] = useState<LangPaper[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [startingId, setStartingId] = useState<string | null>(null);

  const [examType, setExamType] = useState("");

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const p = await api.get<{ list: LangPaper[] }>("/language/papers");
        setPapers(p.list);
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const libPapers = useMemo(() => {
    return papers
      .filter((p) => p.status === "READY")
      .filter((p) => (examType ? p.examType === examType : true));
  }, [papers, examType]);

  async function start(paperId: string) {
    setError("");
    setStartingId(paperId);
    try {
      const data = await api.post<{
        sessionId: string;
        mode: string;
        durationMin: number | null;
        segments: { skill: string; durationMin: number; questionCount: number }[];
        questions: any[];
      }>("/language/sessions", { paperId, mode: undefined });
      sessionStorage.setItem(`lang-session-${data.sessionId}`, JSON.stringify(data));
      router.push(`/app/language/practice/${data.sessionId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "开卷失败");
    } finally {
      setStartingId(null);
    }
  }

  const hasAny = SKILL_GROUPS.some((g) => libPapers.some((p) => p.skill === g.skill));

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-center gap-1.5">
        <h1 className="mr-2 text-xl font-bold text-slate-800">语言学习</h1>
        <span className="mx-1 text-xs text-slate-300">|</span>
        <span className="mr-1 text-xs text-slate-400">考试类型</span>
        {[{ v: "", l: "全部" }, ...EXAMS.map((x) => ({ v: x, l: EXAM_LABEL[x] }))].map((t) => (
          <button
            key={t.v}
            onClick={() => setExamType(t.v)}
            className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
              examType === t.v ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {loading && <p className="py-10 text-center text-slate-400">加载中...</p>}

      {!loading && (
        <div className="space-y-6">
          {SKILL_GROUPS.map((g) => {
            const list = libPapers.filter((p) => p.skill === g.skill);
            if (list.length === 0) return null;
            return (
              <section key={g.skill}>
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-lg leading-none">{g.icon}</span>
                  <h2 className="text-base font-bold text-slate-700">{g.label}</h2>
                  <span
                    className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                    style={{ background: g.color }}
                  >
                    {list.length}
                  </span>
                </div>
                <div className="grid auto-rows-fr gap-3 md:grid-cols-2">
                  {list.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => start(p.id)}
                      disabled={!!startingId}
                      className="flex h-full items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 text-left shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50/40 disabled:opacity-60"
                    >
                      <div className="min-w-0">
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-700">{EXAM_LABEL[p.examType] || p.examType}</span>
                          {p.kind === "OFFICIAL" && <span className="rounded-md bg-cyan-50 px-1.5 py-0.5 text-xs text-cyan-700">原版</span>}
                          {p.kind === "CUSTOM" && <span className="rounded-md bg-purple-50 px-1.5 py-0.5 text-xs text-purple-700">组卷</span>}
                        </div>
                        <p className="text-sm font-semibold text-slate-800">{p.title}</p>
                        <p className="mt-1 text-xs text-slate-500">
                          {p.questionCount} 题 · {p.mode === "EXAM" ? `限时 ${p.durationMin ?? ""} 分钟` : "练习"}
                          {p.segments.length > 0 && ` · ${p.segments.map((s) => `${SKILL_LABEL[s.skill]}${s.durationMin}min`).join("→")}`}
                        </p>
                      </div>
                      <span className="shrink-0 text-xs font-medium text-indigo-600">
                        {startingId === p.id ? "开卷中..." : p.mode === "EXAM" ? "开始模考 →" : "开始练习 →"}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}

          {!hasAny && (
            <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">暂无可用试卷</p>
          )}
        </div>
      )}
    </div>
  );
}
