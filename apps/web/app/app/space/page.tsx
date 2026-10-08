"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from "recharts";
import { api, getUser, getToken } from "@/lib/api";
import { renderRich } from "@/lib/rich";
import type { SessionSummary, WrongItem, StatsData, GrowthData } from "@/lib/types";
import LangGrowthPanel, { type LangAssignment } from "@/components/LangGrowthPanel";

type Assignment = {
  id: string;
  title: string;
  note: string | null;
  mode: string;
  dueAt: string | null;
  status: string;
  lateSubmit?: boolean;
  submittedAt: string | null;
  sessionId: string | null;
  isLanguage?: boolean;
  paper: {
    title: string; mode: string; durationMin: number | null; subject: string | null;
    sourceType: string | null; isLanguage?: boolean; examType?: string | null; skill?: string | null;
  } | null;
};

type LangSession = {
  id: string;
  examType: string;
  skill: string;
  mode: string;
  score: number | null;
  total: number | null;
  correctCount: number | null;
  band: number | null;
  startedAt: string;
  submittedAt: string | null;
  paper: { title: string } | null;
};

const EXAM_LABEL: Record<string, string> = { IELTS: "雅思", TOEFL: "托福", KET_PET: "剑桥KET/PET", OTHER: "其他语言" };
const SKILL_LABEL: Record<string, string> = { LISTENING: "听力", READING: "阅读", WRITING: "写作", SPEAKING: "口语", FULL: "全真连考" };
const SKILL_COLOR: Record<string, string> = {
  LISTENING: "#1f6fb2", READING: "#2e6f40", WRITING: "#b8860b", SPEAKING: "#7a3b8f", FULL: "#a14a3a",
};

const SUBJECT_LINE_COLORS = ["#10b981", "#f59e0b", "#ef4444", "#0ea5e9", "#a855f7", "#14b8a6"];

type Tab = "assignments" | "grades" | "analysis" | "wrong";

export default function PersonalSpacePage() {
  const router = useRouter();
  const user = getUser();
  const [tab, setTab] = useState<Tab>("assignments");
  // 学情分析子模块切换:笔试成长 / 语言成长(同级并列)
  const [analysisTab, setAnalysisTab] = useState<"subject" | "language">("subject");

  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [subjectSessions, setSubjectSessions] = useState<SessionSummary[]>([]);
  const [langSessions, setLangSessions] = useState<LangSession[]>([]);
  const [langAssignments, setLangAssignments] = useState<LangAssignment[]>([]);
  const [byTopic, setByTopic] = useState<{ topic: string; attempts: number; correctRate: number }[]>([]);
  const [bySubject, setBySubject] = useState<{ subject: string; attempts: number; correctRate: number }[]>([]);
  const [byMode, setByMode] = useState<{ mode: string; attempts: number; correctRate: number }[]>([]);
  const [byDifficulty, setByDifficulty] = useState<{ difficulty: number; attempts: number; correctRate: number }[]>([]);
  const [overallRate, setOverallRate] = useState(0);
  const [totalAnswered, setTotalAnswered] = useState(0);
  const [growth, setGrowth] = useState<GrowthData | null>(null);
  const [hlOpen, setHlOpen] = useState(true);
  const [wrongList, setWrongList] = useState<WrongItem[]>([]);
  // 错题本批量管理
  const [manageMode, setManageMode] = useState(false);
  const [selectedWrong, setSelectedWrong] = useState<Set<string>>(new Set());
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [allKps, setAllKps] = useState<{ id: string; name: string; subject: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // 讲评请求相关状态
  const [reviewedMap, setReviewedMap] = useState<Record<string, { note: string | null; status: string }>>({});
  const [reviewTarget, setReviewTarget] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewBusy, setReviewBusy] = useState(false);
  const [msg, setMsg] = useState("");
  // 升学规划填写任务(来自 /api/planning/my-tasks,裸 JSON 不走 api 信封)
  const [planningTasks, setPlanningTasks] = useState<{ id: string; title: string; intro: string | null; status: string }[]>([]);

  const [subjectTab, setSubjectTab] = useState("");
  const [openSolutions, setOpenSolutions] = useState<Set<string>>(new Set());

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [a, s, ls, stats, w, kps, growthData, rr] = await Promise.all([
          api.get<{ list: Assignment[] }>("/me/assignments").catch(() => ({ list: [] as Assignment[] })),
          api.get<{ list: SessionSummary[] }>("/me/sessions").catch(() => ({ list: [] as SessionSummary[] })),
          api.get<{ list: LangSession[] }>("/language/sessions").catch(() => ({ list: [] as LangSession[] })),
          api.get<StatsData>("/me/stats").catch(() => ({ byTopic: [], totalAnswered: 0, correctAnswered: 0, overallRate: 0, bySubject: [], byMode: [], byDifficulty: [] })),
          api.get<{ list: WrongItem[] }>("/me/wrongbook").catch(() => ({ list: [] as WrongItem[] })),
          api.get<{ list: { id: string; name: string; subject: string }[] }>("/knowledge-points").catch(() => ({ list: [] as { id: string; name: string; subject: string }[] })),
          api.get<GrowthData>("/me/growth").catch(() => ({ points: [], milestones: [], coach: { encouragement: "", suggestions: [] }, summary: { hasData: false } })),
          api.get<{ list: { questionId: string; note: string | null; status: string }[] }>("/review-requests").catch(() => ({ list: [] as { questionId: string; note: string | null; status: string }[] })),
        ]);
        setAssignments(a.list || []);
        setSubjectSessions(s.list || []);
        setLangSessions(ls.list || []);
        // 语言作业(标记 isLanguage,走语言会话入口)
        api
          .get<{ list: LangAssignment[] }>("/language/my-assignments")
          .then((d) => setLangAssignments((d.list || []).map((x) => ({ ...x, isLanguage: true }))))
          .catch(() => {});
        setByTopic(stats.byTopic || []);
        setBySubject(stats.bySubject || []);
        setByMode(stats.byMode || []);
        setByDifficulty(stats.byDifficulty || []);
        setOverallRate(stats.overallRate || 0);
        setTotalAnswered(stats.totalAnswered || 0);
        setGrowth(growthData);
        setWrongList(w.list || []);
        const rrMap: Record<string, { note: string | null; status: string }> = {};
        (rr.list || []).forEach((x) => { rrMap[x.questionId] = { note: x.note, status: x.status }; });
        setReviewedMap(rrMap);
        setAllKps(kps.list || []);
        // 升学规划填写任务:planning 路由返回裸 JSON,直接用 fetch 带 token 拉取
        const ptRes = await fetch('/api/planning/my-tasks', { headers: { Authorization: `Bearer ${getToken() || ''}` } }).catch(() => null);
        let pt: { id: string; title: string; intro: string | null; status: string }[] = [];
        if (ptRes && ptRes.ok) {
          const pd = await ptRes.json().catch(() => ({ tasks: [] }));
          pt = (pd.tasks || []).map((t: any) => ({ id: String(t.id), title: String(t.title), intro: t.intro ? String(t.intro) : null, status: String(t.status || "PENDING") }));
        }
        setPlanningTasks(pt);
      } catch (e) {
        setError(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  // 存在 24 小时内截止的作业时,每秒刷新倒计时
  useEffect(() => {
    const hasUrgent = assignments.some((a) => {
      if (!a.dueAt) return false;
      const ms = new Date(a.dueAt).getTime() - Date.now();
      return ms > 0 && ms <= URGENT_MS;
    });
    if (!hasUrgent) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [assignments]);

  const URGENT_MS = 24 * 3600 * 1000;

  function fmtDueStr(s?: string | null) {
    if (!s) return "不限时";
    const d = new Date(s);
    return d.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }
  function countdownText(dueAt: string, t: number) {
    let ms = new Date(dueAt).getTime() - t;
    if (ms < 0) ms = 0;
    const total = Math.floor(ms / 1000);
    const d = Math.floor(total / 86400);
    const h = Math.floor((total % 86400) / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (d > 0) return `剩 ${d} 天 ${h} 时 ${m} 分`;
    if (h > 0) return `剩 ${h} 时 ${m} 分 ${s} 秒`;
    return `剩 ${m} 分 ${s} 秒`;
  }
  function statusLabel(a: Assignment) {
    const overdue = a.dueAt && new Date(a.dueAt).getTime() < Date.now();
    if (a.status === "SUBMITTED") return a.lateSubmit ? "逾期补交" : "已提交";
    if (a.status === "IN_PROGRESS") return "进行中";
    if (a.status === "EXPIRED" || overdue) return "已过期";
    return "待完成";
  }
  // 往期表现状态(区分「逾期补交」)
  function pastStatus(a: Assignment) {
    if (a.status === "SUBMITTED" && a.lateSubmit) return { label: "逾期补交", cls: "bg-amber-50 text-amber-600" };
    if (a.status === "SUBMITTED") return { label: "已提交", cls: "bg-emerald-50 text-emerald-600" };
    return { label: statusLabel(a), cls: "bg-red-50 text-red-600" };
  }

  // 开作业:学科走 /sessions,语言走 /language/sessions
  async function startAssignment(a: Assignment) {
    setError("");
    setBusyId(a.id);
    try {
      if (a.isLanguage) {
        const data = await api.post<{ sessionId: string }>("/language/sessions", { assignmentId: a.id });
        sessionStorage.setItem(`lang-session-${data.sessionId}`, JSON.stringify(data));
        router.push(`/app/language/practice/${data.sessionId}`);
      } else {
        const data = await api.post<{ sessionId: string; questions: unknown[] }>("/sessions", {
          mode: a.mode === "EXAM" ? "EXAM" : "PRACTICE",
          assignmentId: a.id,
        });
        sessionStorage.setItem(`session-${data.sessionId}`, JSON.stringify(data.questions));
        router.push(`/app/practice/${data.sessionId}`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "开卷失败");
    } finally {
      setBusyId(null);
    }
  }

  // 针对某个知识点练习
  async function practiceTopic(topic: string) {
    const kp = allKps.find((k) => k.name === topic);
    if (!kp) return;
    setBusyId(`kp:${topic}`);
    try {
      const data = await api.post<{ sessionId: string; questions: unknown[] }>("/sessions", { mode: "PRACTICE", limit: 10, knowledgePointId: kp.id });
      sessionStorage.setItem(`session-${data.sessionId}`, JSON.stringify(data.questions));
      router.push(`/app/practice/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setBusyId(null);
    }
  }

  // 我的作业:统一所有作业(笔试 + 语言),后续按分区渲染
  // 待处理 = 未提交(含待完成 / 进行中 / 已过期未交);已过期未交也可补交
  const pendingAssigns = assignments.filter((a) => a.status !== "SUBMITTED");
  // 往期表现 = 已提交(含逾期补交)
  const pastAssigns = assignments.filter((a) => a.status === "SUBMITTED");
  const sessById = useMemo(() => {
    const m = new Map<string, SessionSummary>();
    subjectSessions.forEach((s) => m.set(s.id, s));
    return m;
  }, [subjectSessions]);

  // 待完成默认按 DDL 由近到远排序(无限时排最后)
  const pendingSorted = useMemo(
    () =>
      [...pendingAssigns].sort((a, b) => {
        const ta = a.dueAt ? new Date(a.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        const tb = b.dueAt ? new Date(b.dueAt).getTime() : Number.MAX_SAFE_INTEGER;
        return ta - tb;
      }),
    [pendingAssigns],
  );
  // 24 小时内(且未过期)的紧急作业,单独成区
  const urgentAssigns = useMemo(
    () => pendingSorted.filter((a) => a.dueAt && (() => {
      const ms = new Date(a.dueAt).getTime() - now;
      return ms > 0 && ms <= URGENT_MS;
    })()),
    [pendingSorted, now],
  );
  const otherPending = useMemo(() => pendingSorted.filter((a) => !urgentAssigns.includes(a)), [pendingSorted, urgentAssigns]);

  // 试卷分区(笔试/语言),让"我的作业"页按板块清晰展示
  // 注意:紧急区(urgentAssigns)已单独成区展示,此处待完成区只放非紧急(otherPending)避免重复
  const subjectOtherPending = useMemo(() => otherPending.filter((a) => !a.isLanguage), [otherPending]);
  const langOtherPending = useMemo(() => otherPending.filter((a) => a.isLanguage), [otherPending]);
  const subjectPast = useMemo(() => pastAssigns.filter((a) => !a.isLanguage), [pastAssigns]);
  const langPast = useMemo(() => pastAssigns.filter((a) => a.isLanguage), [pastAssigns]);

  // 渲染单张作业卡(urgent=true 走红色紧急样式 + 倒计时)
  function renderAssignCard(a: Assignment, urgent: boolean) {
    const overdue = a.dueAt ? new Date(a.dueAt).getTime() <= now : false;
    // 已过期未交也允许补交(提交后打「逾期补交」标签)
    const canStart = a.status !== "SUBMITTED";
    const dueStr = a.dueAt ? fmtDueStr(a.dueAt) : "不限时";
    const dueChip = (() => {
      if (!a.dueAt) return <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-500">不限时</span>;
      if (overdue) return <span className="rounded-md bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-600">已过期 {dueStr} · 可补交</span>;
      if (urgent) return <span className="rounded-md bg-red-600 px-2 py-0.5 text-xs font-bold text-white">⏰ {countdownText(a.dueAt, now)}</span>;
      return <span className="rounded-md bg-rose-50 px-2 py-0.5 text-xs font-semibold text-rose-600">DDL {dueStr}</span>;
    })();
    const cardCls =
      "flex items-center justify-between gap-4 rounded-2xl border p-4 shadow-sm transition " +
      (overdue && canStart
        ? "cursor-pointer border-amber-300 bg-white hover:border-amber-400 hover:bg-amber-50/50"
        : urgent && canStart
        ? "cursor-pointer border-red-300 bg-white hover:border-red-400 hover:bg-red-50/50"
        : canStart
        ? "cursor-pointer border-indigo-200 bg-white hover:border-indigo-300 hover:bg-indigo-50/40"
        : "border-slate-200 bg-slate-50");
    const actionLabel = overdue ? "补交 →" : a.status === "IN_PROGRESS" ? "继续作答 →" : "开始作答 →";
    const inner = (
      <>
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${a.status === "IN_PROGRESS" ? "bg-blue-100 text-blue-700" : overdue ? "bg-red-100 text-red-600" : "bg-amber-100 text-amber-700"}`}>{statusLabel(a)}</span>
            {a.isLanguage && a.paper?.examType && (
              <span className="rounded-md px-1.5 py-0.5 text-xs font-medium text-white" style={{ background: SKILL_COLOR[a.paper.skill || "FULL"] || "#666" }}>
                {EXAM_LABEL[a.paper.examType] || a.paper.examType}·{SKILL_LABEL[a.paper.skill || "FULL"] || a.paper.skill}
              </span>
            )}
            {!a.isLanguage && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs font-medium text-slate-600">{a.mode === "EXAM" ? "模考" : "练习"}</span>}
            {dueChip}
          </div>
          <p className="truncate text-sm font-semibold text-slate-800">{a.title}</p>
          <p className="mt-0.5 text-xs text-slate-500">
            {a.paper?.title ?? "试卷"}
            {a.mode === "EXAM" && a.paper?.durationMin ? ` · 限时 ${a.paper.durationMin} 分钟` : ""}
          </p>
          {a.note && <p className="mt-1 truncate text-xs text-slate-400">备注: {a.note}</p>}
          {overdue && canStart && <p className="mt-1 text-xs text-amber-600">⚠ 已过期,提交后将标记为「逾期补交」</p>}
        </div>
        {busyId === a.id ? (
          <span className="shrink-0 text-sm font-medium text-indigo-400">开卷中...</span>
        ) : canStart ? (
          <span className={`shrink-0 whitespace-nowrap text-sm font-medium ${overdue ? "text-amber-600" : "text-indigo-600"}`}>
            {actionLabel}
          </span>
        ) : null}
      </>
    );
    return canStart ? (
      <button key={a.id} onClick={() => startAssignment(a)} disabled={!!busyId} className={cardCls}>
        {inner}
      </button>
    ) : (
      <div key={a.id} className={cardCls}>
        {inner}
      </div>
    );
  }

  // 成绩趋势(学科会话,有得分)
  const trendData = subjectSessions
    .filter((s) => s.submittedAt && s.total && s.total > 0 && s.correctCount != null)
    .slice().reverse().slice(-10)
    .map((s, i) => ({ name: `${i + 1}`, rate: Math.min(100, Math.round(((s.correctCount ?? s.score ?? 0) / s.total!) * 100)), mode: s.mode === "EXAM" ? "模考" : "练习" }));

  const radarData = byTopic
    .filter((t) => typeof t.correctRate === "number" && t.attempts > 0)
    .sort((a, b) => (b.attempts || 0) - (a.attempts || 0))
    .slice(0, 10)
    .map((t) => ({ topic: t.topic, rate: t.correctRate }));
  const weakTopics = useMemo(() => [...byTopic].sort((a, b) => a.correctRate - b.correctRate), [byTopic]);
  // 难度表现:固定 1–5 星,缺省也显示 0%
  const difficultyFull = [1, 2, 3, 4, 5].map((d) => {
    const f = byDifficulty.find((x) => x.difficulty === d);
    return { difficulty: d, correctRate: f ? f.correctRate : 0, attempts: f ? f.attempts : 0 };
  });
  // 成就/高光分组(用于可折叠高光时刻)
  const milestones = growth?.milestones || [];
  const highlightMs = milestones.filter((m) => m.highlight);
  const otherMs = milestones.filter((m) => !m.highlight);

  // 错题本
  const visibleWrong = subjectTab ? wrongList.filter((w) => (subjectTab === "数学" ? w.subject === "数学" || w.subject === "TMUA" : w.subject === subjectTab)) : wrongList;
  const pendingWrong = visibleWrong.filter((w) => !w.mastered);
  const masteredWrong = visibleWrong.filter((w) => w.mastered);

  function toggleSolution(qid: string) {
    setOpenSolutions((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid); else next.add(qid);
      return next;
    });
  }
  async function markMastered(qid: string) {
    await api.post(`/me/wrongbook/${qid}/master`);
    setWrongList((prev) => prev.map((w) => (w.questionId === qid ? { ...w, mastered: true } : w)));
  }

  // 批量删除选中错题
  function toggleSelect(qid: string) {
    setSelectedWrong((prev) => {
      const next = new Set(prev);
      if (next.has(qid)) next.delete(qid); else next.add(qid);
      return next;
    });
  }
  const allVisibleSelected = visibleWrong.length > 0 && visibleWrong.every((w) => selectedWrong.has(w.questionId));
  function toggleSelectAll() {
    setSelectedWrong((prev) => {
      if (visibleWrong.length > 0 && visibleWrong.every((w) => prev.has(w.questionId))) return new Set();
      return new Set(visibleWrong.map((w) => w.questionId));
    });
  }
  async function deleteSelectedWrong() {
    if (selectedWrong.size === 0) return;
    setDeleteBusy(true);
    try {
      const ids = Array.from(selectedWrong);
      await api.del("/me/wrongbook", { questionIds: ids });
      setWrongList((prev) => prev.filter((w) => !selectedWrong.has(w.questionId)));
      setSelectedWrong(new Set());
      setManageMode(false);
      flash(`已删除 ${ids.length} 条错题`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    } finally {
      setDeleteBusy(false);
      setConfirmDeleteOpen(false);
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
      await api.post("/review-requests", { questionId: reviewTarget, source: "WRONG_BOOK", note: reviewNote.trim() });
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

  const tabBtn = (t: Tab, icon: string, label: string, count?: number) => (
    <button
      key={t}
      onClick={() => setTab(t)}
      className={`flex w-full items-center justify-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
        tab === t
          ? "bg-indigo-600 text-white shadow-md shadow-indigo-600/20"
          : "bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50 hover:text-slate-800"
      }`}
    >
      <span className="text-base leading-none">{icon}</span>
      {label}
      {typeof count === "number" && count > 0 && (
        <span className={`ml-0.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${tab === t ? "bg-white/25 text-white" : "bg-indigo-100 text-indigo-600"}`}>{count}</span>
      )}
    </button>
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">个人空间</h1>
        <p className="mt-1 text-sm text-slate-500">{user?.name}，这里汇总了你的作业、成绩、学情与错题。</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tabBtn("assignments", "📌", "我的作业", pendingAssigns.length)}
        {tabBtn("grades", "📈", "成绩历史", subjectSessions.length)}
        {tabBtn("analysis", "📊", "学情分析", weakTopics.filter((t) => t.correctRate < 70).length)}
        {tabBtn("wrong", "📒", "错题本", pendingWrong.length)}
      </div>

      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
      {loading && <p className="py-10 text-center text-slate-400">加载中...</p>}

      {!loading && tab === "assignments" && (
        <div className="space-y-8">
          {/* 升学规划填写任务(来自 /api/planning/my-tasks) */}
          {planningTasks.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-emerald-600">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-100 text-sm">📝</span>
                升学规划填写任务 ({planningTasks.length})
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {planningTasks.map((t) => (
                  <div
                    key={t.id}
                    onClick={() => router.push("/app/planning")}
                    className="flex cursor-pointer items-center justify-between gap-4 rounded-2xl border-2 border-emerald-400 bg-emerald-50/60 p-4 shadow-sm transition hover:border-emerald-500 hover:bg-emerald-50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded-md bg-emerald-600 px-1.5 py-0.5 text-xs font-semibold text-white">档案填写</span>
                        <span className="rounded-md bg-emerald-100 px-1.5 py-0.5 text-xs font-semibold text-emerald-700">{t.status === "DRAFT" ? "草稿 · 继续填写" : "待填写"}</span>
                      </div>
                      <p className="truncate text-sm font-semibold text-slate-800">{t.title}</p>
                      {t.intro && <p className="mt-0.5 truncate text-xs text-slate-500">{t.intro}</p>}
                    </div>
                    <button className="shrink-0 whitespace-nowrap rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700">
                      去填写 →
                    </button>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* 紧急区 · 24 小时内截止(全部) */}
          {urgentAssigns.length > 0 && (
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-red-600">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-red-100 text-sm">⏰</span>
                紧急 · 24 小时内截止 ({urgentAssigns.length})
              </h2>
              <div className="grid gap-3 md:grid-cols-2">
                {urgentAssigns.map((a) => renderAssignCard(a, true))}
              </div>
            </section>
          )}

          {/* 待完成作业放前:笔试 + 语言 */}
          <section className="space-y-8">
            <div className="space-y-4">
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-700">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-100 text-sm">📐</span>
                笔试作业 ({subjectOtherPending.length} 项待完成 / 补交)
              </h2>
              {subjectOtherPending.length === 0 ? (
                <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">暂无待完成的笔试作业,去练习区放松一下吧~</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {subjectOtherPending.map((a) => renderAssignCard(a, false))}
                </div>
              )}
            </div>

            <div className="space-y-4">
                <h2 className="flex items-center gap-2 text-base font-bold text-slate-700">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-100 text-sm">🗣️</span>
                语言作业 ({langOtherPending.length} 项待完成 / 补交)
              </h2>
              {langOtherPending.length === 0 ? (
                <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">暂无待完成的语言作业。</p>
              ) : (
                <div className="grid gap-3 md:grid-cols-2">
                  {langOtherPending.map((a) => renderAssignCard(a, false))}
                </div>
              )}
            </div>
          </section>

          {/* 往期表现放后:笔试 + 语言 */}
          <section className="space-y-8">
            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-500">📋 笔试作业 · 往期表现 ({subjectPast.length})</h3>
              {subjectPast.length === 0 ? (
                <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">还没有已提交的笔试作业。</p>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-normal">作业</th>
                        <th className="px-4 py-3 font-normal">类型</th>
                        <th className="px-4 py-3 font-normal">状态</th>
                        <th className="px-4 py-3 font-normal">成绩</th>
                        <th className="px-4 py-3 font-normal">提交时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subjectPast.map((a) => {
                        const sess = a.sessionId ? sessById.get(a.sessionId) : undefined;
                        const rate = sess && sess.total ? Math.round((sess.score! / sess.total) * 100) : null;
                        const ps = pastStatus(a);
                        return (
                          <tr key={a.id} className="border-t border-slate-100">
                            <td className="px-4 py-3 font-medium text-slate-700">{a.title}</td>
                            <td className="px-4 py-3">{a.mode === "EXAM" ? "模考" : "练习"}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2 py-0.5 text-xs ${ps.cls}`}>{ps.label}</span>
                            </td>
                            <td className="px-4 py-3">{rate !== null ? `${sess!.score} / ${sess!.total} (${rate}%)` : "—"}</td>
                            <td className="px-4 py-3 text-slate-500">{a.submittedAt ? new Date(a.submittedAt).toLocaleString("zh-CN") : "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            <div className="space-y-3">
              <h3 className="text-sm font-semibold text-slate-500">📋 语言作业 · 往期表现 ({langPast.length})</h3>
              {langPast.length === 0 ? (
                <p className="rounded-2xl border border-slate-200 bg-white p-6 text-center text-sm text-slate-400">还没有已提交的语言作业。</p>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50 text-left text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-normal">作业</th>
                        <th className="px-4 py-3 font-normal">类型</th>
                        <th className="px-4 py-3 font-normal">状态</th>
                        <th className="px-4 py-3 font-normal">提交时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {langPast.map((a) => {
                        const ps = pastStatus(a);
                        return (
                          <tr key={a.id} className="border-t border-slate-100">
                            <td className="px-4 py-3 font-medium text-slate-700">
                              {a.title}
                              {a.paper?.examType ? <span className="ml-2 text-xs text-slate-400">· {EXAM_LABEL[a.paper.examType] || a.paper.examType}</span> : ""}
                            </td>
                            <td className="px-4 py-3">{a.mode === "EXAM" ? "模考" : "练习"}</td>
                            <td className="px-4 py-3">
                              <span className={`rounded-full px-2 py-0.5 text-xs ${ps.cls}`}>{ps.label}</span>
                            </td>
                          <td className="px-4 py-3 text-slate-500">{a.submittedAt ? new Date(a.submittedAt).toLocaleString("zh-CN") : "—"}</td>
                        </tr>
                      ); })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {!loading && tab === "grades" && (
        <div className="space-y-6">
          {trendData.length >= 2 && (
            <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-sm font-medium text-slate-700">成绩趋势(正确率 %)</h2>
              <div className="mt-4 h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendData} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} label={{ value: "第 N 次", position: "insideBottomRight", offset: -2, fontSize: 11, fill: "#94a3b8" }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                    <Tooltip formatter={(v: number) => [`${v}%`, "正确率"]} labelFormatter={(l) => `第 ${l} 次`} />
                    <Line type="monotone" dataKey="rate" stroke="#6366f1" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* 学科成绩历史(语言成绩已独立到「语言成长」界面) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-sm font-medium text-slate-700">笔试成绩记录 ({subjectSessions.length})</h2>
            {subjectSessions.length === 0 ? (
              <p className="mt-4 text-sm text-slate-400">暂无记录。</p>
            ) : (
              <div className="mt-4 space-y-2">
                {subjectSessions.map((s) => (
                  <div key={s.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 px-4 py-3">
                    <span className="shrink-0 rounded-md bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">{s.mode === "EXAM" ? "模考" : "练习"}</span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-700">{s.total ? `${s.correctCount ?? s.score} / ${s.total}` : "—"}</p>
                      <p className="mt-0.5 text-xs text-slate-500">{s.total ? `正确率 ${Math.min(100, Math.round(((s.correctCount ?? s.score ?? 0) / s.total) * 100))}%` : ""} · {new Date(s.startedAt).toLocaleString("zh-CN")}</p>
                    </div>
                    {s.submittedAt && (
                      <button onClick={() => router.push(`/app/practice/${s.id}`)} className="shrink-0 text-xs text-indigo-600 hover:underline">查看</button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!loading && tab === "analysis" && (
        <div className="space-y-6">
          {/* 学情分析子模块:笔试成长 / 语言成长 同级并列 */}
          <div className="inline-flex rounded-2xl bg-slate-100 p-1">
            <button
              onClick={() => setAnalysisTab("subject")}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
                analysisTab === "subject" ? "bg-white text-indigo-600 shadow-md ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              📝 笔试成长
            </button>
            <button
              onClick={() => setAnalysisTab("language")}
              className={`flex items-center gap-2 rounded-xl px-5 py-2.5 text-sm font-semibold transition ${
                analysisTab === "language" ? "bg-white text-amber-600 shadow-md ring-1 ring-slate-200" : "text-slate-500 hover:text-slate-700"
              }`}
            >
              🗣️ 语言成长
            </button>
          </div>

          {analysisTab === "subject" ? (
            <>
          {totalAnswered === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">还没有作答记录,先做几道题,系统会生成你的学情分析报告。</p>
          ) : (
            <>
              {/* 成长图谱 */}
              {growth && growth.summary?.hasData && growth.points.length > 0 && (
                <section className="space-y-6">
                  {/* 正确率变化折线图 */}
                  <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-medium text-slate-700">成长图谱 · 正确率变化轨迹</h2>
                      <span className="text-xs text-slate-400">
                        {growth.summary.spanDays} 天 · 共 {growth.summary.totalAnswered} 题 · 峰值 {growth.summary.peakRate}%
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-slate-400">折线为<strong className="text-slate-500">累计正确率</strong>,清楚看见你每个阶段的进步。图例中标明了每条线的含义:</p>
                    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                      <span className="flex items-center gap-1.5 text-xs text-slate-600">
                        <span className="inline-block h-2.5 w-5 rounded-full bg-[#6366f1]" /> 总体正确率(累计)
                      </span>
                      {Object.keys(growth.points[growth.points.length - 1].subjects || {}).map((s, i) => (
                        <span key={s} className="flex items-center gap-1.5 text-xs text-slate-600">
                          <span className="inline-block h-2.5 w-5 rounded-full" style={{ background: SUBJECT_LINE_COLORS[i % SUBJECT_LINE_COLORS.length] }} /> {s}正确率(累计)
                        </span>
                      ))}
                    </div>
                    <div className="mt-4 h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <LineChart data={growth.points} margin={{ top: 8, right: 12, bottom: 0, left: -20 }}>
                          <XAxis dataKey="label" tick={{ fontSize: 12 }} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                          <Tooltip formatter={(v: number) => [`${v}%`, "正确率"]} />
                          <Line type="monotone" dataKey="overallRate" name="总体正确率" stroke="#6366f1" strokeWidth={3} dot={{ r: 3 }} connectNulls />
                          {Object.keys(growth.points[growth.points.length - 1].subjects || {}).map((s, i) => (
                            <Line key={s} type="monotone" dataKey={`subjects.${s}`} name={`${s}正确率`} stroke={SUBJECT_LINE_COLORS[i % SUBJECT_LINE_COLORS.length]} strokeWidth={1.5} dot={false} connectNulls />
                          ))}
                        </LineChart>
                      </ResponsiveContainer>
                    </div>
                  </div>

                  {/* 成长教练:鼓励 + 建议 */}
                  {growth.coach && (growth.coach.encouragement || (growth.coach.suggestions || []).length > 0) && (
                    <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-6 shadow-sm">
                      <h2 className="flex items-center gap-2 text-sm font-semibold text-indigo-700">💡 成长教练</h2>
                      {growth.coach.encouragement && (
                        <p className="mt-2 text-sm leading-relaxed text-slate-700">{growth.coach.encouragement}</p>
                      )}
                      {(growth.coach.suggestions || []).length > 0 && (
                        <ul className="mt-3 space-y-2">
                          {growth.coach.suggestions.map((sg, i) => (
                            <li key={i} className="flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm text-slate-700">
                              <span className="mt-0.5 shrink-0 font-bold text-indigo-500">✓</span>
                              <span>{sg}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  )}

                  {/* 成就 & 高光时刻 时间轴 */}
                  {milestones.length > 0 && (
                    <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                      <h2 className="text-sm font-medium text-slate-700">成就 &amp; 高光时刻 ({milestones.length})</h2>
                      <p className="mt-1 text-xs text-slate-400">每一个值得记住的节点,都在这里留痕。</p>

                      {highlightMs.length > 0 && (
                        <div className="mt-4">
                          <button
                            type="button"
                            onClick={() => setHlOpen((o) => !o)}
                            className="flex w-full items-center justify-between rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-left transition hover:bg-amber-100/60"
                          >
                            <span className="flex items-center gap-2 text-sm font-semibold text-amber-700">🌟 高光时刻 ({highlightMs.length})</span>
                            <span className="text-xs text-amber-600">{hlOpen ? "收起 ▲" : "展开 ▼"}</span>
                          </button>
                          {hlOpen && (
                            <div className="mt-3 space-y-3">
                              {highlightMs.map((m) => (
                                <div key={m.id} className="relative rounded-xl bg-amber-50 p-3 ring-1 ring-amber-200">
                                  <div className="flex items-center justify-between gap-2">
                                    <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-700">
                                      <span className="flex h-5 w-5 items-center justify-center rounded-full bg-amber-400 text-[11px] text-white">{m.icon}</span>
                                      {m.title}
                                    </p>
                                    <span className="shrink-0 text-xs text-slate-400">{new Date(m.date).toLocaleDateString("zh-CN")}</span>
                                  </div>
                                  <p className="mt-1 text-xs leading-relaxed text-slate-500">{m.desc}</p>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {otherMs.length > 0 && (
                        <ol className="relative mt-4 space-y-4 border-l-2 border-indigo-100 pl-5">
                          {otherMs.map((m) => (
                            <li key={m.id} className="relative">
                              <span className="absolute -left-[27px] top-0.5 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-100 text-[11px] text-indigo-600">{m.icon}</span>
                              <div className="rounded-xl bg-slate-50 p-3">
                                <div className="flex items-center justify-between gap-2">
                                  <p className="text-sm font-semibold text-slate-800">{m.title}</p>
                                  <span className="shrink-0 text-xs text-slate-400">{new Date(m.date).toLocaleDateString("zh-CN")}</span>
                                </div>
                                <p className="mt-1 text-xs leading-relaxed text-slate-500">{m.desc}</p>
                              </div>
                            </li>
                          ))}
                        </ol>
                      )}
                    </div>
                  )}
                </section>
              )}

              {/* 总览指标卡 */}
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <MetricCard label="总答题数" value={`${totalAnswered}`} sub="道" />
                <MetricCard label="总体正确率" value={`${overallRate}%`} sub="全部作答" accent />
                <MetricCard label="覆盖学科" value={`${bySubject.length}`} sub="个科目" />
                <MetricCard label="薄弱项" value={`${weakTopics.filter((t) => t.correctRate < 70).length}`} sub="正确率<70%" warn={weakTopics.some((t) => t.correctRate < 70)} />
              </div>

              {/* 学科表现 */}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-sm font-medium text-slate-700">学科表现(按科目正确率)</h2>
                {bySubject.length === 0 ? (
                  <p className="mt-4 text-sm text-slate-400">暂无学科作答数据。</p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {bySubject.map((s) => (
                      <div key={s.subject} className="flex items-center gap-3">
                        <span className="w-12 shrink-0 text-sm font-medium text-slate-700">{s.subject}</span>
                        <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                          <div className={`h-full rounded-full ${s.correctRate >= 70 ? "bg-emerald-500" : s.correctRate >= 40 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${s.correctRate}%` }} />
                        </div>
                        <span className={`w-32 shrink-0 text-right text-xs ${s.correctRate < 70 ? "font-medium text-red-500" : "text-slate-600"}`}>正确率 {s.correctRate}% · {s.attempts}题</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* 练习/模考 + 难度表现 */}
              <div className="grid gap-6 md:grid-cols-2">
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-sm font-medium text-slate-700">练习 vs 模考</h2>
                  <div className="mt-4 space-y-3">
                    {byMode.length === 0 ? (
                      <p className="text-sm text-slate-400">暂无数据。</p>
                    ) : (
                      byMode.map((m) => (
                        <div key={m.mode} className="flex items-center gap-3">
                          <span className="w-12 shrink-0 text-sm font-medium text-slate-700">{m.mode === "EXAM" ? "模考" : "练习"}</span>
                          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                            <div className={`h-full rounded-full ${m.correctRate >= 70 ? "bg-indigo-500" : "bg-amber-500"}`} style={{ width: `${m.correctRate}%` }} />
                          </div>
                          <span className="w-32 shrink-0 text-right text-xs text-slate-600">正确率 {m.correctRate}% · {m.attempts}题</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-sm font-medium text-slate-700">难度表现(1–5 星)</h2>
                  <p className="mt-1 text-xs text-slate-400">无论是否有作答,1–5 星难度均完整展示。</p>
                  <div className="mt-4 h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={difficultyFull} margin={{ top: 5, right: 10, bottom: 0, left: -20 }}>
                        <XAxis dataKey="difficulty" tick={{ fontSize: 12 }} tickFormatter={(d: number) => `${d}星`} tickLine={false} axisLine={{ stroke: "#e2e8f0" }} />
                        <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
                        <Tooltip formatter={(v: number) => [`${v}%`, "正确率"]} labelFormatter={(l: number) => `难度 ${l} 星`} />
                        <Bar dataKey="correctRate" radius={[4, 4, 0, 0]}>
                          {difficultyFull.map((d, i) => (
                            <Cell key={i} fill={d.correctRate >= 70 ? "#6366f1" : d.correctRate >= 40 ? "#f59e0b" : "#ef4444"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>

              {/* 知识点掌握雷达 + 薄弱列表 */}
              {radarData.length >= 3 && (
                <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                  <h2 className="text-sm font-medium text-slate-700">知识点掌握度雷达图</h2>
                  <p className="mt-1 text-xs text-slate-400">展示练习最多的 {Math.min(radarData.length, 10)} 个知识点(正确率 %),字号已放大便于查看。</p>
                  <div className="mt-2 h-[380px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart data={radarData} outerRadius="80%">
                        <PolarGrid stroke="#e2e8f0" />
                        <PolarAngleAxis dataKey="topic" tick={{ fontSize: 13, fill: "#334155" }} />
                        <Radar dataKey="rate" stroke="#6366f1" fill="#6366f1" fillOpacity={0.3} />
                        <Tooltip formatter={(v: number) => [`${v}%`, "正确率"]} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}
              <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
                <h2 className="text-sm font-medium text-slate-700">薄弱项(按正确率升序)</h2>
                <p className="mt-1 text-xs text-slate-400">正确率低于 70% 的知识点建议重点练习。</p>
                <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
                  {weakTopics.map((t) => (
                    <div key={t.topic} className="rounded-xl bg-slate-50 p-4">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-medium text-slate-800">{t.topic}</p>
                        {allKps.some((k) => k.name === t.topic) && (
                          <button
                            onClick={() => practiceTopic(t.topic)}
                            disabled={!!busyId}
                            className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                          >
                            针对练习
                          </button>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-500">作答 {t.attempts} 次</p>
                      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                        <div className={`h-full rounded-full ${t.correctRate >= 70 ? "bg-emerald-500" : t.correctRate >= 40 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${t.correctRate}%` }} />
                      </div>
                      <p className={`mt-1 text-xs ${t.correctRate < 70 ? "font-medium text-red-500" : "text-slate-600"}`}>正确率 {t.correctRate}%</p>
                    </div>
                  ))}
                </div>
              </div>

            </>
          )}
            </>
          ) : (
            <LangGrowthPanel sessions={langSessions} />
          )}
        </div>
      )}

      {!loading && tab === "wrong" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-slate-700">错题本 ({wrongList.length})</h2>
            {wrongList.length > 0 && (
              <div className="flex items-center gap-2">
                {!manageMode && (
                  <button
                    onClick={() => { setManageMode(true); setSelectedWrong(new Set()); }}
                    className="rounded-lg border border-slate-300 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-600 shadow-sm hover:bg-slate-50"
                  >
                    管理
                  </button>
                )}
                <div className="flex gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
                  {[{ v: "", l: "全部" }, { v: "数学", l: "数学" }, { v: "物理", l: "物理" }, { v: "化学", l: "化学" }, { v: "生物", l: "生物" }].map((t) => (
                    <button
                      key={t.v}
                      onClick={() => setSubjectTab(t.v)}
                      className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${subjectTab === t.v ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}
                    >
                      {t.l}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          {manageMode && wrongList.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-3">
              <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                />
                全选当前可见 ({visibleWrong.length})
              </label>
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">已选 {selectedWrong.size} 条</span>
                <button
                  onClick={() => setConfirmDeleteOpen(true)}
                  disabled={selectedWrong.size === 0}
                  className="rounded-lg bg-red-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-40"
                >
                  删除选中 ({selectedWrong.size})
                </button>
                <button
                  onClick={() => { setManageMode(false); setSelectedWrong(new Set()); }}
                  className="rounded-lg border border-slate-300 px-4 py-1.5 text-sm text-slate-600 hover:bg-white"
                >
                  退出
                </button>
              </div>
            </div>
          )}
          {wrongList.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">太棒了,目前没有错题!</p>
          ) : visibleWrong.length === 0 ? (
            <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">该学科暂无错题</p>
          ) : (
            <>
              <section>
                <h3 className="mb-3 text-sm font-medium text-slate-500">待掌握 ({pendingWrong.length})</h3>
                <div className="space-y-3">{pendingWrong.map((w) => renderWrong(w))}</div>
              </section>
              {masteredWrong.length > 0 && (
                <section>
                  <h3 className="mb-3 text-sm font-medium text-slate-500">已掌握 ({masteredWrong.length})</h3>
                  <div className="space-y-3 opacity-60">{masteredWrong.map((w) => renderWrong(w))}</div>
                </section>
              )}
            </>
          )}
        </div>
      )}

      {/* 讲评请求确认弹窗(错题本) */}
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
              placeholder="例如:这个函数积分的步骤不太明白..."
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

      {/* 批量删除错题确认弹窗 */}
      {confirmDeleteOpen && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={() => !deleteBusy && setConfirmDeleteOpen(false)}>
          <div className="mt-24 w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-base font-bold text-slate-800">确认删除错题</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-500">
              即将从你的错题本永久删除选中的 <b className="text-slate-700">{selectedWrong.size}</b> 道题。删除后不可恢复,其他功能(如讲评请求、学情统计)不受影响。
            </p>
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => !deleteBusy && setConfirmDeleteOpen(false)} disabled={deleteBusy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                取消
              </button>
              <button onClick={deleteSelectedWrong} disabled={deleteBusy} className="rounded-lg bg-red-500 px-5 py-2 text-sm font-medium text-white hover:bg-red-600 disabled:opacity-60">
                {deleteBusy ? "删除中..." : `确认删除 (${selectedWrong.size})`}
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );

  function renderWrong(w: WrongItem) {
    const selected = selectedWrong.has(w.questionId);
    return (
      <div key={w.questionId} className={`rounded-2xl border bg-white p-5 shadow-sm ${selected ? "border-indigo-400 ring-1 ring-indigo-200" : "border-slate-200"}`}>
        {manageMode && (
          <label className="mb-3 flex cursor-pointer items-center gap-2 text-sm font-medium text-slate-600">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => toggleSelect(w.questionId)}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            选择此题
          </label>
        )}
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600">{w.subject}</span>
              <span className="rounded bg-slate-100 px-1.5 py-0.5">{w.topic}</span>
              <span>难度 {w.difficulty}</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-slate-800">{renderRich(w.stem)}</p>
            {w.answer ? (
              <div className="mt-3 rounded-lg border-l-4 border-emerald-300 bg-emerald-50 px-3 py-2 text-sm leading-relaxed text-emerald-900">
                <b className="text-emerald-700">正确答案:</b> {renderRich(w.answer, { smart: false })}
              </div>
            ) : null}
            <div className="mt-3">
              <button
                onClick={() => toggleSolution(w.questionId)}
                className="flex items-center gap-1.5 rounded-lg border border-[#c9b98f] bg-[#f6f1e2] px-3 py-1.5 text-xs font-medium text-[#3a3528] transition hover:bg-[#efe8d2]"
                aria-expanded={openSolutions.has(w.questionId)}
              >
                <svg className={`h-3 w-3 transition-transform ${openSolutions.has(w.questionId) ? "rotate-90" : ""}`} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
                {w.solution ? (openSolutions.has(w.questionId) ? "收起解析" : "查看解析") : "暂无解析"}
              </button>
              {openSolutions.has(w.questionId) && (
                w.solution ? (
                  <div className="mt-2 whitespace-pre-wrap rounded border-l-4 border-[#c9b98f] bg-[#f6f1e2] px-3 py-2 text-sm leading-relaxed text-[#3a3528]">
                    <b className="text-[#00467F]">解析:</b> {renderRich(w.solution, { smart: false })}
                  </div>
                ) : (
                  <p className="mt-2 rounded bg-slate-50 px-3 py-2 text-xs text-slate-400">暂无解析,老师尚未补充</p>
                )
              )}
            </div>
          </div>
          {!manageMode && (
            <div className="shrink-0 text-right">
              <p className="text-xs text-slate-400">错 {w.wrongCount} 次</p>
              <div className="mt-2 flex flex-col items-end gap-1.5">
                {reviewedMap[w.questionId] ? (
                  <button
                    onClick={() => openReview(w.questionId)}
                    className="rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 ring-1 ring-emerald-200 hover:bg-emerald-100"
                  >
                    已提交讲评 ✓
                  </button>
                ) : (
                  <button
                    onClick={() => openReview(w.questionId)}
                    className="rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600"
                  >
                    需要讲评
                  </button>
                )}
                {!w.mastered && (
                  <button onClick={() => markMastered(w.questionId)} className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700">
                    标记掌握
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }
}

// 学情分析 - 总览指标卡
function MetricCard({ label, value, sub, accent, warn }: { label: string; value: string; sub?: string; accent?: boolean; warn?: boolean }) {
  const color = warn ? "text-red-500" : accent ? "text-indigo-600" : "text-slate-800";
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <p className="text-xs text-slate-500">{label}</p>
      <p className={`mt-1 text-2xl font-bold ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400">{sub}</p>}
    </div>
  );
}
