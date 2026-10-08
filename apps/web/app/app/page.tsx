"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  RadarChart, PolarGrid, PolarAngleAxis, Radar,
} from "recharts";
import { api, getUser } from "@/lib/api";
import type { CreateSessionData, SessionSummary, StatsData } from "@/lib/types";

interface MyPaper {
  id: string;
  title: string;
  subject: string;
  questionCount: number;
  source: string | null;
  createdAt: string;
  collectedFrom: string | null; // 收藏副本指向的试卷库原卷 id;自建卷为 null
}

export default function StudentHome() {
  const router = useRouter();
  const user = getUser();
  const [form, setForm] = useState({ subject: "", limit: 10, mode: "PRACTICE" as "PRACTICE" | "EXAM", durationMin: 40, paperId: "", knowledgePointId: "", difficulty: "" });
  const [papers, setPapers] = useState<{ id: string; title: string; questionCount: number; subject: string; kind?: string; sourceType?: string | null; source?: string | null }[]>([]);
  // 试卷库筛选/排序(与教师端试卷管理一致)
  const [libSubject, setLibSubject] = useState("");
  const [libKind, setLibKind] = useState("");
  const [libSourceType, setLibSourceType] = useState("");
  const [libSort, setLibSort] = useState<"createdDesc" | "nameAsc" | "nameDesc">("createdDesc");
  const [allKps, setAllKps] = useState<{ id: string; name: string; subject: string }[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [allSessions, setAllSessions] = useState<SessionSummary[]>([]);
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // 我的试卷(学生自建,仅自己可见)
  const [myPapers, setMyPapers] = useState<MyPaper[]>([]);
  const [myMsg, setMyMsg] = useState("");
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeBusy, setComposeBusy] = useState(false);
  const [composeErr, setComposeErr] = useState("");
  const [compose, setCompose] = useState({
    title: "",
    source: "random" as "random" | "wrongbook",
    subject: "",
    knowledgePointId: "",
    difficulty: "",
    count: "10",
    topics: [] as string[], // 错题组卷:按知识点多选
  });
  const [wrongTopics, setWrongTopics] = useState<{ topic: string; count: number }[]>([]);
  // 题目收藏 / 我的原创题 入口计数
  const [favCount, setFavCount] = useState(0);
  const [myQCount, setMyQCount] = useState(0);

  // 拉取首页全部数据(删除做题进度后重新调用,保证与后端一致)
  async function loadData() {
    try {
      const sess = await api.get<{ list: SessionSummary[] }>("/me/sessions");
      setSessions(sess.list.slice(0, 5));
      setAllSessions(sess.list);
    } catch { /* ignore */ }
    api.get<StatsData>("/me/stats").then(setStats).catch(() => {});
    api.get<{ list: { id: string; title: string; questionCount: number; subject: string; kind?: string; sourceType?: string | null; source?: string | null }[] }>("/papers").then((d) => setPapers(d.list)).catch(() => {});
    // 知识点库(供知识点下拉与掌握度"针对练习")
    api.get<{ list: { id: string; name: string; subject: string }[] }>("/knowledge-points").then((d) => setAllKps(d.list || [])).catch(() => {});
    // 我的试卷
    api.get<{ list: MyPaper[] }>("/papers/mine").then((d) => setMyPapers(d.list || [])).catch(() => {});
    // 题目收藏 / 我的原创题 计数
    api.get<{ list: unknown[] }>("/me/favorites").then((d) => setFavCount(d.list?.length || 0)).catch(() => {});
    api.get<{ list: unknown[] }>("/me/questions").then((d) => setMyQCount(d.list?.length || 0)).catch(() => {});
  }

  useEffect(() => {
    loadData();
  }, []);

  async function start() {
    setError("");
    if (form.mode === "EXAM" && (!form.durationMin || form.durationMin <= 0)) {
      setError("模拟考模式请填写时长(分钟)");
      return;
    }
    setLoading(true);
    try {
      const data = await api.post<CreateSessionData>("/sessions", {
        mode: form.mode,
        limit: form.limit,
        subject: form.subject || undefined,
        knowledgePointId: form.knowledgePointId || undefined,
        difficulty: form.difficulty || undefined,
        // 模拟考时长由学生自行设置(套题本身不再携带时长)
        durationMin: form.mode === "EXAM" ? form.durationMin : undefined,
        paperId: form.paperId || undefined,
      });
      sessionStorage.setItem(`session-${data.sessionId}`, JSON.stringify(data.questions));
      router.push(`/app/practice/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  // 删除进行中的做题进度(本人未交卷会话)
  async function removeSession(id: string) {
    try {
      await api.del(`/sessions/${id}`);
      await loadData(); // 重新拉取,保证与后端一致(含作业回退)
    } catch (e) {
      window.alert(`删除失败：${e instanceof Error ? e.message : "请稍后重试"}`);
    }
  }

  // 针对某个知识点发起练习(10 题)
  async function practiceTopic(topic: string) {
    const kp = allKps.find((k) => k.name === topic);
    if (!kp) return;
    setError("");
    setLoading(true);
    try {
      const data = await api.post<CreateSessionData>("/sessions", { mode: "PRACTICE", limit: 10, knowledgePointId: kp.id });
      sessionStorage.setItem(`session-${data.sessionId}`, JSON.stringify(data.questions));
      router.push(`/app/practice/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "创建失败");
    } finally {
      setLoading(false);
    }
  }

  // 从试卷库直接开始一张卷(学生自选 练习 或 模考;模考需自行设置时长)
  async function startPaper(p: { id: string; title: string; questionCount: number }, mode: "PRACTICE" | "EXAM", durationMin?: number) {
    setError("");
    setLoading(true);
    try {
      if (mode === "EXAM" && (!durationMin || durationMin <= 0)) {
        setError("模拟考请填写有效的时长(分钟)");
        setLoading(false);
        return;
      }
      const data = await api.post<CreateSessionData>("/sessions", {
        mode,
        paperId: p.id,
        ...(mode === "EXAM" ? { durationMin } : {}),
      });
      sessionStorage.setItem(`session-${data.sessionId}`, JSON.stringify(data.questions));
      router.push(`/app/practice/${data.sessionId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "开卷失败");
    } finally {
      setLoading(false);
    }
  }

  // ——— 我的试卷:组卷 / 删除 ———
  function openCompose() {
    setComposeErr("");
    setComposeOpen(true);
    // 错题知识点汇总(供「按错题知识点组卷」多选)
    api.get<{ list: { topic: string; count: number }[] }>("/me/wrongbook/topics")
      .then((d) => setWrongTopics(d.list || []))
      .catch(() => setWrongTopics([]));
  }

  async function createMyPaper() {
    setComposeErr("");
    setComposeBusy(true);
    try {
      await api.post("/papers/student", {
        title: compose.title,
        source: compose.source,
        subject: compose.subject || undefined,
        knowledgePointId: compose.knowledgePointId || undefined,
        difficulty: compose.difficulty || undefined,
        count: compose.count === "" ? undefined : Number(compose.count),
        topics: compose.source === "wrongbook" ? compose.topics : undefined,
      });
      setComposeOpen(false);
      setCompose({ title: "", source: "random", subject: "", knowledgePointId: "", difficulty: "", count: "10", topics: [] });
      setMyMsg("组卷成功,已保存到「我的试卷」");
      setTimeout(() => setMyMsg(""), 4000);
      const d = await api.get<{ list: MyPaper[] }>("/papers/mine");
      setMyPapers(d.list || []);
    } catch (e) {
      setComposeErr(e instanceof Error ? e.message : "组卷失败");
    } finally {
      setComposeBusy(false);
    }
  }

  async function deleteMyPaper(id: string) {
    if (!window.confirm("确认删除这张自己的试卷?")) return;
    try {
      await api.del(`/papers/mine/${id}`);
      setMyPapers((prev) => prev.filter((p) => p.id !== id));
      setMyMsg("试卷已删除");
      setTimeout(() => setMyMsg(""), 3000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  // 收藏试卷库中的套卷到「我的试卷」
  async function collectPaper(paperId: string) {
    setError("");
    try {
      await api.post("/papers/mine/collect", { paperId });
      setMyMsg("已加入「我的试卷」");
      setTimeout(() => setMyMsg(""), 4000);
      const d = await api.get<{ list: MyPaper[] }>("/papers/mine");
      setMyPapers(d.list || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "收藏失败");
    }
  }

  // 试卷库:筛选(学科/套题类型) + 排序(最新/名称自然序),与教师端一致
  const libPapers = useMemo(() => {
    let arr = papers.filter((p) => {
      if (libSubject && p.subject !== libSubject) return false;
      if (libKind && p.kind !== libKind) return false;
      if (libSourceType && p.sourceType !== libSourceType) return false;
      return true;
    });
    if (libSort === "nameAsc" || libSort === "nameDesc") {
      const dir = libSort === "nameAsc" ? 1 : -1;
      arr = [...arr].sort((a, b) => dir * String(a.title).localeCompare(String(b.title), undefined, { numeric: true, sensitivity: "base" }));
    }
    return arr;
  }, [papers, libSubject, libKind, libSourceType, libSort]);

  const input =
    "h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500 ui-select";

  // 成绩趋势数据(已提交且有总分的会话,按时间升序,最近 10 次)
  const trendData = allSessions
    .filter((s) => s.submittedAt && s.total && s.total > 0 && s.correctCount != null)
    .slice()
    .reverse()
    .slice(-10)
    .map((s, i) => ({
      name: `${i + 1}`,
      rate: Math.min(100, Math.round(((s.correctCount ?? s.score ?? 0) / s.total!) * 100)),
      mode: s.mode === "EXAM" ? "模考" : "练习",
    }));

  // 掌握度雷达数据
  const radarData = (stats?.byTopic ?? [])
    .filter((t) => typeof t.correctRate === "number")
    .map((t) => ({ topic: t.topic, rate: t.correctRate }));

  // 已收藏到「我的试卷」的试卷库原卷 id
  const collectedIds = new Set(myPapers.filter((p) => p.collectedFrom).map((p) => p.collectedFrom as string));

  // 「继续做题」列表:按试卷/作业去重(同一份卷子只保留最新一条会话),
  // 避免反复开卷累积出"无穷无尽"的卡片;无试卷的随机练习合并成一个入口。
  const inProgress = useMemo(() => {
    const byKey = new Map<string, SessionSummary>();
    let generic: SessionSummary | null = null;
    for (const s of allSessions) {
      if (s.submittedAt) continue;
      // 只显示至少已完成 1 题的未完成试卷(过滤点开即退出的空卷)
      if ((s.answeredCount ?? 0) === 0) continue;
      if (s.assignmentId) {
        const k = `A:${s.assignmentId}`;
        const cur = byKey.get(k);
        if (!cur || new Date(s.startedAt).getTime() > new Date(cur.startedAt).getTime()) byKey.set(k, s);
      } else if (s.paperId) {
        const k = `P:${s.paperId}`;
        const cur = byKey.get(k);
        if (!cur || new Date(s.startedAt).getTime() > new Date(cur.startedAt).getTime()) byKey.set(k, s);
      } else {
        // 随机练习(无试卷/作业):保留"已答题最多 / 最新"的一条
        if (
          !generic ||
          (s.answeredCount ?? 0) > (generic.answeredCount ?? 0) ||
          ((s.answeredCount ?? 0) === (generic.answeredCount ?? 0) &&
            new Date(s.startedAt).getTime() > new Date(generic.startedAt).getTime())
        ) {
          generic = s;
        }
      }
    }
    const list = Array.from(byKey.values());
    if (generic) list.push(generic);
    return list.sort(
      (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
    );
  }, [allSessions]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">你好,{user?.name}</h1>
        <p className="mt-1 text-sm text-slate-500">选择科目与题量,开始今天的练习吧。</p>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h2 className="text-sm font-medium text-slate-700">开始练习</h2>
        <div className="mt-4 flex flex-wrap items-end gap-4">
          <div>
            <label className="mb-1 block text-sm text-slate-600">模式</label>
            <select className={`${input} ui-select`} value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value as "PRACTICE" | "EXAM" })}>
              <option value="PRACTICE">练习(不限时)</option>
              <option value="EXAM">模拟考(限时)</option>
            </select>
          </div>
          {papers.length > 0 && (
            <div>
              <label className="mb-1 block text-sm text-slate-600">试卷</label>
              <select className={`${input} ui-select`} value={form.paperId} onChange={(e) => setForm({ ...form, paperId: e.target.value })}>
                <option value="">随机组卷</option>
                {papers.map((p) => (
                  <option key={p.id} value={p.id}>{p.title}({p.questionCount}题)</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="mb-1 block text-sm text-slate-600">科目</label>
            <select className={input} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value, knowledgePointId: "" })}>
              <option value="">全部</option>
              <option value="TMUA">TMUA</option>
              <option value="ESAT">ESAT</option>
              <option value="数学">数学</option>
              <option value="物理">物理</option>
              <option value="化学">化学</option>
              <option value="生物">生物</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">知识点</label>
            <select className={`${input} max-w-[220px]`} value={form.knowledgePointId} onChange={(e) => setForm({ ...form, knowledgePointId: e.target.value })}>
              <option value="">全部知识点</option>
              {(() => {
                const pool = form.subject === "TMUA" ? ["数学"] : form.subject === "ESAT" ? ["数学", "物理"] : form.subject ? [form.subject] : null;
                const list = pool ? allKps.filter((k) => pool.includes(k.subject)) : allKps;
                return list.map((kp) => (
                  <option key={kp.id} value={kp.id}>{pool ? kp.name : `[${kp.subject}] ${kp.name}`}</option>
                ));
              })()}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">难度</label>
            <select className={input} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
              <option value="">全部难度</option>
              <option value="1">难度 1</option>
              <option value="2">难度 2</option>
              <option value="3">难度 3</option>
              <option value="4">难度 4</option>
              <option value="5">难度 5</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">题量</label>
            <select className={input} value={form.limit} onChange={(e) => setForm({ ...form, limit: Number(e.target.value) })}>
              {[5, 10, 20].map((n) => (
                <option key={n} value={n}>{n} 题</option>
              ))}
            </select>
          </div>
          {form.mode === "EXAM" && (
            <div>
              <label className="mb-1 block text-sm text-slate-600">时长(分钟)</label>
              <input
                type="number"
                min={1}
                max={240}
                className="h-9 w-28 rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500"
                value={form.durationMin || ""}
                onChange={(e) => setForm({ ...form, durationMin: e.target.value === "" ? 0 : Number(e.target.value) })}
                placeholder="自定义时长"
              />
            </div>
          )}
          <button
            onClick={start}
            disabled={loading}
            className="h-9 rounded-lg bg-indigo-600 px-6 text-sm font-medium text-white transition hover:bg-indigo-700 disabled:opacity-60"
          >
            {loading ? "组卷中..." : form.mode === "EXAM" ? "开始模拟考" : "开始练习"}
          </button>
        </div>
        {form.mode === "EXAM" && <p className="mt-3 text-xs text-slate-400">模拟考模式下,时间到将自动交卷,超时后无法继续作答。</p>}
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {/* 进行中的练习/考试:可继续做题(中途退出的进度已保存) */}
      {inProgress.length > 0 && (
        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/70 p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-sm font-medium text-slate-700">
              <span className="inline-block h-2 w-2 rounded-full bg-indigo-500" /> 进行中 · 可继续做题
            </h2>
            <span className="text-xs text-indigo-400">中途退出已自动保存进度</span>
          </div>
          <div className="mt-3 space-y-2.5">
            {inProgress
              .map((s) => {
                const name = s.assignmentTitle || s.paperTitle || (s.mode === "EXAM" ? "模拟考" : "练习");
                const done = s.answeredCount ?? 0;
                const tot = s.total ?? 0;
                const pct = tot ? Math.round((done / tot) * 100) : 0;
                return (
                  <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl border border-indigo-100 bg-white px-4 py-3 shadow-sm">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="rounded bg-indigo-100 px-2 py-0.5 text-xs font-medium text-indigo-700">
                          {s.mode === "EXAM" ? "模拟考" : "练习"}
                        </span>
                        <span className="truncate font-medium text-slate-700">{name}</span>
                      </div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="h-1.5 w-24 overflow-hidden rounded-full bg-indigo-100">
                          <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="text-xs text-slate-500">已完成 {done}/{tot}</span>
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        onClick={() => router.push(`/app/practice/${s.id}`)}
                        className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-indigo-700"
                      >
                        继续做题 →
                      </button>
                      <button
                        onClick={() => removeSession(s.id)}
                        title="删除该进度(不可恢复)"
                        className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-400 transition hover:border-rose-200 hover:bg-rose-50 hover:text-rose-500"
                      >
                        删除
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      )}

      {/* 我的试卷:学生自建,仅自己可见 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">我的试卷(仅自己可见)</h2>
          <button onClick={openCompose} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            + 组卷
          </button>
        </div>
        {myMsg && <p className="mt-2 text-sm text-emerald-600">{myMsg}</p>}
        {myPapers.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">还没有自己的试卷。点「+ 组卷」可随机组卷或从错题本组卷。</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {myPapers.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-medium text-slate-800" title={p.title}>{p.title}</p>
                    {p.collectedFrom && <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">收藏</span>}
                  </div>
                  <p className="mt-1 text-xs text-slate-500">
                    {p.questionCount} 题
                    {p.subject ? ` · ${p.subject}` : ""} · {new Date(p.createdAt).toLocaleString("zh-CN", { hour12: false })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <PaperStartButton paper={p} disabled={loading} onStart={startPaper} />
                  <button onClick={() => deleteMyPaper(p.id)} className="rounded-lg border border-red-200 px-3 py-1.5 text-xs text-red-500 hover:bg-red-50">
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 题目收藏 / 我的原创题 入口 */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Link
          href="/app/favorites"
          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-amber-300 hover:bg-amber-50/40"
        >
          <div>
            <p className="text-sm font-medium text-slate-800">⭐ 题目收藏</p>
            <p className="mt-1 text-xs text-slate-500">做题时收藏的题目,供自己查阅复习</p>
          </div>
          <span className="shrink-0 text-xs font-medium text-amber-600">已收藏 {favCount} 题 →</span>
        </Link>
        <Link
          href="/app/my-questions"
          className="flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50/40"
        >
          <div>
            <p className="text-sm font-medium text-slate-800">✏️ 我的原创题</p>
            <p className="mt-1 text-xs text-slate-500">上传/新建自己的题目,提交老师审核入库</p>
          </div>
          <span className="shrink-0 text-xs font-medium text-indigo-600">共 {myQCount} 题 →</span>
        </Link>
      </div>

      {/* 试卷库:与教师端试卷管理一致的筛选(学科/套题类型) + 排序,点击直接开卷 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-1.5">
          <h2 className="mr-2 text-sm font-medium text-slate-700">试卷库</h2>
          {[{ v: "", l: "全部" }, { v: "数学", l: "数学" }, { v: "物理", l: "物理" }, { v: "化学", l: "化学" }, { v: "生物", l: "生物" }].map((t) => (
            <button
              key={t.v}
              onClick={() => setLibSubject(t.v)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                libSubject === t.v ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t.l}
            </button>
          ))}
          <span className="mx-1 text-xs text-slate-300">|</span>
          {[{ v: "", l: "全部套题" }, { v: "OFFICIAL", l: "原版套题" }, { v: "mock", l: "模考套题" }, { v: "CUSTOM", l: "组卷套题" }].map((t) => (
            <button
              key={t.v}
              onClick={() => setLibKind(t.v)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                libKind === t.v ? "bg-teal-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t.l}
            </button>
          ))}
          <span className="mx-1 text-xs text-slate-300">|</span>
          {[{ v: "", l: "全部考试" }, { v: "TMUA", l: "TMUA" }, { v: "ESAT", l: "ESAT" }].map((t) => (
            <button
              key={t.v}
              onClick={() => setLibSourceType(t.v)}
              className={`rounded-lg px-2.5 py-1 text-xs font-medium transition ${
                libSourceType === t.v ? "bg-amber-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t.l}
            </button>
          ))}
          <select
            value={libSort}
            onChange={(e) => setLibSort(e.target.value as "createdDesc" | "nameAsc" | "nameDesc")}
            className="ml-auto h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600 outline-none focus:border-indigo-500 ui-select"
            aria-label="排序方式"
          >
            <option value="createdDesc">最新优先</option>
            <option value="nameAsc">名称 A→Z</option>
            <option value="nameDesc">名称 Z→A</option>
          </select>
        </div>

        {libPapers.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">该分类下暂无试卷。</p>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2">
            {libPapers.map((p) => {
              const collected = collectedIds.has(p.id);
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-4 transition hover:border-indigo-300 hover:bg-indigo-50/40"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-slate-800" title={p.title}>{p.title}</p>
                      {p.kind === "OFFICIAL" ? (
                        <span className="shrink-0 rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-medium text-teal-600">原版</span>
                      ) : p.kind === "mock" ? (
                        <span className="shrink-0 rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-600">模考</span>
                      ) : (
                        <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-600">组卷</span>
                      )}
                    </div>
                    <p className="mt-1 text-xs text-slate-500">
                      {p.questionCount} 题
                      {p.sourceType ? ` · ${p.sourceType}` : ""}
                      {p.subject ? ` · ${p.subject}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => collectPaper(p.id)}
                      disabled={loading || collected}
                      className={`rounded-lg px-2.5 py-1 text-xs font-medium transition disabled:cursor-not-allowed ${
                        collected ? "bg-emerald-50 text-emerald-600" : "border border-slate-200 text-slate-500 hover:bg-slate-50"
                      }`}
                    >
                      {collected ? "✓ 已收藏" : "＋ 加入我的试卷"}
                    </button>
                    <PaperStartButton paper={p} disabled={loading} onStart={startPaper} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {stats && stats.totalAnswered > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-700">知识点掌握度</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
            {stats.byTopic.map((t) => (
              <div key={t.topic} className="rounded-xl bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-medium text-slate-800">{t.topic}</p>
                  {allKps.some((k) => k.name === t.topic) && (
                    <button
                      onClick={() => practiceTopic(t.topic)}
                      disabled={loading}
                      title="针对该知识点练 10 题"
                      className="shrink-0 rounded-lg bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      练习
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-500">作答 {t.attempts} 次</p>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-200">
                  <div
                    className={`h-full rounded-full ${t.correctRate >= 70 ? "bg-emerald-500" : t.correctRate >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                    style={{ width: `${t.correctRate}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-slate-600">正确率 {t.correctRate}%</p>
              </div>
            ))}
          </div>
        </div>
      )}

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

      {radarData.length >= 3 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-medium text-slate-700">知识点掌握度雷达图</h2>
          <div className="mt-2 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <RadarChart data={radarData} outerRadius="70%">
                <PolarGrid stroke="#e2e8f0" />
                <PolarAngleAxis dataKey="topic" tick={{ fontSize: 11, fill: "#475569" }} />
                <Radar dataKey="rate" stroke="#6366f1" fill="#6366f1" fillOpacity={0.25} />
                <Tooltip formatter={(v: number) => [`${v}%`, "正确率"]} />
              </RadarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-slate-700">最近成绩</h2>
          <button onClick={() => router.push("/app/space")} className="text-sm text-indigo-600 hover:underline">
            查看全部
          </button>
        </div>
        {sessions.length === 0 ? (
          <p className="mt-4 text-sm text-slate-400">还没有练习记录,先做几道题吧。</p>
        ) : (
          <table className="mt-4 w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-slate-400">
                <th className="pb-2 font-normal">模式</th>
                <th className="pb-2 font-normal">得分</th>
                <th className="pb-2 font-normal">正确率</th>
                <th className="pb-2 font-normal">时间</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr key={s.id} className="border-b border-slate-50">
                  <td className="py-2">{s.mode === "EXAM" ? "模拟考" : "练习"}</td>
                  {s.submittedAt ? (
                    <>
                      <td className="py-2">{(s.correctCount ?? s.score)} / {s.total}</td>
                      <td className="py-2">{s.total ? Math.min(100, Math.round(((s.correctCount ?? s.score ?? 0) / s.total) * 100)) : 0}%</td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 text-amber-600">进行中</td>
                      <td className="py-2 text-amber-600">未交卷</td>
                    </>
                  )}
                  <td className="py-2 text-slate-500">{new Date(s.startedAt).toLocaleString("zh-CN")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* 组卷弹窗(随机组卷 / 错题组卷) */}
      {composeOpen && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={() => !composeBusy && setComposeOpen(false)}>
          <div className="mt-10 w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">学生组卷</h2>
              <button onClick={() => !composeBusy && setComposeOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="关闭">✕</button>
            </div>

            {/* 组卷方式 */}
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCompose({ ...compose, source: "random" })}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  compose.source === "random" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                随机组卷
              </button>
              <button
                type="button"
                onClick={() => setCompose({ ...compose, source: "wrongbook" })}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition ${
                  compose.source === "wrongbook" ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                }`}
              >
                错题组卷
              </button>
            </div>

            <div className="mt-4 grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="mb-1 block text-sm text-slate-600">试卷名称(留空自动命名)</label>
                <input
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-indigo-500"
                  value={compose.title}
                  onChange={(e) => setCompose({ ...compose, title: e.target.value })}
                  placeholder={`如:${compose.source === "wrongbook" ? "我的错题二刷" : "随机模拟一卷"}`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">科目</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-indigo-500 ui-select"
                  value={compose.subject}
                  onChange={(e) => setCompose({ ...compose, subject: e.target.value, knowledgePointId: "" })}
                >
                  <option value="">全部科目</option>
                  <option value="数学">数学</option>
                  <option value="物理">物理</option>
                  <option value="化学">化学</option>
                  <option value="生物">生物</option>
                </select>
              </div>
              {compose.source === "random" && (
                <>
                  <div>
                    <label className="mb-1 block text-sm text-slate-600">知识点</label>
                    <select
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-indigo-500 ui-select"
                      value={compose.knowledgePointId}
                      onChange={(e) => setCompose({ ...compose, knowledgePointId: e.target.value })}
                    >
                      <option value="">全部知识点</option>
                      {(() => {
                        const pool = compose.subject === "TMUA" ? ["数学"] : compose.subject === "ESAT" ? ["数学", "物理"] : compose.subject ? [compose.subject] : null;
                        const list = pool ? allKps.filter((k) => pool.includes(k.subject)) : allKps;
                        return list.map((kp) => (
                          <option key={kp.id} value={kp.id}>{pool ? kp.name : `[${kp.subject}] ${kp.name}`}</option>
                        ));
                      })()}
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm text-slate-600">难度</label>
                    <select
                      className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-indigo-500 ui-select"
                      value={compose.difficulty}
                      onChange={(e) => setCompose({ ...compose, difficulty: e.target.value })}
                    >
                      <option value="">全部难度</option>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>难度 {n}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
              <div>
                <label className="mb-1 block text-sm text-slate-600">题量</label>
                <select
                  className="w-full rounded-lg border border-slate-300 px-2.5 py-2 text-sm outline-none focus:border-indigo-500 ui-select"
                  value={compose.count}
                  onChange={(e) => setCompose({ ...compose, count: e.target.value })}
                >
                  <option value="5">5 题</option>
                  <option value="10">10 题</option>
                  <option value="15">15 题</option>
                  <option value="20">20 题</option>
                  {compose.source === "wrongbook" && <option value="">全部错题</option>}
                </select>
              </div>
            </div>

            {compose.source === "wrongbook" && (
              <div className="mt-3">
                <div className="mb-1 flex items-center justify-between">
                  <label className="text-sm text-slate-600">按知识点筛选(可多选,留空 = 全部错题)</label>
                  {compose.topics.length > 0 && (
                    <button onClick={() => setCompose({ ...compose, topics: [] })} className="text-xs text-indigo-600 hover:underline">
                      清空选择({compose.topics.length})
                    </button>
                  )}
                </div>
                {wrongTopics.length === 0 ? (
                  <p className="text-xs text-slate-400">错题本中暂无可组卷的已发布题目。</p>
                ) : (
                  <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-2">
                    {wrongTopics.map((t) => {
                      const on = compose.topics.includes(t.topic);
                      return (
                        <button
                          type="button"
                          key={t.topic}
                          onClick={() =>
                            setCompose((c) => ({
                              ...c,
                              topics: on ? c.topics.filter((x) => x !== t.topic) : [...c.topics, t.topic],
                            }))
                          }
                          className={`rounded-full border px-2.5 py-1 text-xs transition ${
                            on ? "border-indigo-500 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          }`}
                        >
                          {t.topic}({t.count})
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <p className="mt-3 text-xs text-slate-400">
              {compose.source === "wrongbook" ? "从你的错题本(已发布题目)中组卷,用于二刷巩固。" : "从题库已发布题目中按条件随机抽取。"}
              组卷结果仅你自己可见,保存在「我的试卷」。
            </p>
            {composeErr && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{composeErr}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setComposeOpen(false)} disabled={composeBusy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                取消
              </button>
              <button onClick={createMyPaper} disabled={composeBusy} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                {composeBusy ? "组卷中..." : "生成试卷"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 试卷库 / 我的试卷 卡片右侧的「练习 / 模考」启动控件
// 套题本身不再区分模式,模式与(模考)用时完全由学生自选
function PaperStartButton({
  paper,
  disabled,
  onStart,
}: {
  paper: { id: string; title: string; questionCount: number };
  disabled: boolean;
  onStart: (p: { id: string; title: string; questionCount: number }, mode: "PRACTICE" | "EXAM", durationMin?: number) => void;
}) {
  const [mode, setMode] = useState<"PRACTICE" | "EXAM">("PRACTICE");
  const [dur, setDur] = useState<string>("40");
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-7 overflow-hidden rounded-lg border border-slate-200 text-xs">
        <button
          type="button"
          onClick={() => setMode("PRACTICE")}
          className={`flex items-center px-2.5 font-medium transition ${mode === "PRACTICE" ? "bg-indigo-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
        >
          练习
        </button>
        <button
          type="button"
          onClick={() => setMode("EXAM")}
          className={`flex items-center px-2.5 font-medium transition ${mode === "EXAM" ? "bg-indigo-600 text-white" : "bg-white text-slate-500 hover:bg-slate-50"}`}
        >
          模考
        </button>
      </div>
      {mode === "EXAM" && (
        <input
          type="number"
          min={1}
          max={240}
          value={dur}
          onChange={(e) => setDur(e.target.value)}
          placeholder="时长(分)"
          className="h-7 w-20 rounded border border-slate-300 px-1.5 text-xs outline-none focus:border-indigo-500"
        />
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => onStart(paper, mode, mode === "EXAM" ? Number(dur) : undefined)}
        className="flex h-7 items-center rounded-lg bg-emerald-500 px-3 text-xs font-semibold text-white transition hover:bg-emerald-600 disabled:opacity-50"
      >
        开始
      </button>
    </div>
  );
}
