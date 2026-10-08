"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from "recharts";
import { api } from "@/lib/api";
import { renderRich } from "@/lib/rich";
import ScratchPad from "@/components/ScratchPad";
import type { GradeResult, QuizQuestion, SessionDetail } from "@/lib/types";

const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

// 每题计时累加状态的持久化 key(与 answers-${id}/session-${id} 同机制)
const TIMING_KEY = (sid: string) => `timing-${sid}`;

// 知识点 → 标签配色(试卷风格)
const TOPIC_COLORS: Record<string, string> = {
  代数: "#2e6f40", 函数: "#2e6f40", "代数方程组": "#2e6f40", 不等式: "#2e6f40",
  微积分: "#7a3b8f", 定积分: "#7a3b8f",
  三角: "#b8860b", 三角函数: "#b8860b",
  概率: "#1f6fb2", 统计: "#1f6fb2",
  数列: "#a14a3a", "数列级数": "#a14a3a",
  几何: "#3d6b6b", "坐标几何": "#3d6b6b", "立体几何": "#3d6b6b", "解析几何": "#3d6b6b",
  逻辑: "#5b3a8f",
};
const DEFAULT_TOPIC = "#00467F";

function topicColor(topic: string): string {
  return TOPIC_COLORS[topic] || DEFAULT_TOPIC;
}

// 成绩等级
function gradeOf(pct: number): { label: string; color: string } {
  if (pct >= 90) return { label: "Outstanding", color: "#2e7d32" };
  if (pct >= 75) return { label: "Strong", color: "#1f6fb2" };
  if (pct >= 60) return { label: "Solid", color: "#b8860b" };
  if (pct >= 45) return { label: "Developing", color: "#c62828" };
  return { label: "Keep practising", color: "#9e9e9e" };
}

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

export default function PracticePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [current, setCurrent] = useState<number>(() => {
    if (typeof window === "undefined") return 0;
    try {
      const raw = sessionStorage.getItem(TIMING_KEY(id));
      if (raw) {
        const t = JSON.parse(raw);
        if (typeof t.current === "number" && t.current >= 0) return t.current;
      }
    } catch { /* ignore */ }
    return 0;
  });
  const [result, setResult] = useState<GradeResult | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  // 答题明细弹窗:点击某行查看该题题干/选项/答案/解析
  const [openItem, setOpenItem] = useState<SessionDetail["details"][number] | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [resumed, setResumed] = useState(false);
  const [deadline, setDeadline] = useState<number | null>(null);
  const [remaining, setRemaining] = useState<number | null>(null);
  const submittedRef = useRef(false);
  // 当前剩余秒数(供退出时上报暂停),用 ref 避免闭包取到旧值
  const remainingRef = useRef<number | null>(null);
  // 每题用时计时:enterAtRef=进入当前题的时间,timeMapRef=每题累计停留秒,currentQidRef=当前题 id
  const enterAtRef = useRef<number>(Date.now());
  const timeMapRef = useRef<Record<string, number>>({});
  const currentQidRef = useRef<string | null>(null);
  const answersRef = useRef<Record<string, string>>({});
  // 暂停状态标记:页面隐藏/卸载期间为 true,回到前台时由 resumeNow 复位。
  const pausedRef = useRef(false);
  // 挂载时刻:区分开发模式 StrictMode 双挂载与真实卸载,避免误触发暂停上报。
  const mountedAtRef = useRef(Date.now());
  // 手写批注层(半透明叠在题目上方;浏览模式下可正常答题/切题)
  const [scratchOpen, setScratchOpen] = useState(false);
  const [scratchInteractive, setScratchInteractive] = useState(false);
  // 题目收藏
  const [favSet, setFavSet] = useState<Set<string>>(new Set());
  const [favBusy, setFavBusy] = useState<string | null>(null);

  const isExam = !!deadline;
  // 把 isExam 同步到 ref,供卸载副作用读取最新值(卸载时闭包可能捕获旧值)。
  const isExamRef = useRef(false);
  isExamRef.current = isExam;
  // 客户端-服务器时钟偏移:加载会话时以服务端下发时间(epoch ms)为锚,校准本机时钟,
  // 避免学生设备时钟比服务器快几秒时,前端提前判定"超时"而禁答(模考最后几秒点不了选项)。
  const clockOffsetRef = useRef(0);
  const serverNow = () => Date.now() + clockOffsetRef.current;

  // 向服务端上报暂停/恢复(keepalive 保证页面关闭时也能发出):
  // 暂停 = 清空绝对截止时间、仅留剩余秒数(真冻结);恢复 = 重建绝对截止时间为 now + 剩余(离线时长不计入)。
  const reportPause = (rem: number) => {
    const token = (window.localStorage.getItem("wb_token") || "").trim();
    try {
      fetch(`/api/sessions/${id}/pause`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ remaining: rem }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* ignore */ }
  };
  const reportResume = (rem: number) => {
    const token = (window.localStorage.getItem("wb_token") || "").trim();
    try {
      fetch(`/api/sessions/${id}/resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ remaining: rem }),
        keepalive: true,
      }).catch(() => {});
    } catch { /* ignore */ }
  };

  // 持久化每题累计用时 + 当前题号到 sessionStorage,使重挂载(刷新/关页/路由返回)后不丢计时。
  // enterAt 不持久化绝对时间戳(否则离线/隐藏时长会被误计入当前题);重挂载时由 init effect 重置为 now。
  const persistTiming = useCallback(() => {
    try {
      sessionStorage.setItem(TIMING_KEY(id), JSON.stringify({
        timeMap: timeMapRef.current,
        currentQid: currentQidRef.current,
        current,
      }));
    } catch { /* ignore */ }
  }, [id, current]);

  // 结算当前题已停留时间并持久化(用于卸载/隐藏/关闭前的兜底,确保最后片段不丢)
  const flushTiming = useCallback(() => {
    if (currentQidRef.current) {
      const dt = Math.max(0, Math.round((Date.now() - enterAtRef.current) / 1000));
      timeMapRef.current[currentQidRef.current] = (timeMapRef.current[currentQidRef.current] || 0) + dt;
      enterAtRef.current = Date.now();
    }
    persistTiming();
  }, [id, current, persistTiming]);

  // 初始化:读缓存题目;并向后端确认会话信息(时限/是否已提交)
  useEffect(() => {
    // 恢复计时累加状态:重挂载(刷新/关页/SPA 路由返回)后不丢每题累计用时与当前题号
    try {
      const raw = sessionStorage.getItem(TIMING_KEY(id));
      if (raw) {
        const t = JSON.parse(raw);
        if (t.timeMap && typeof t.timeMap === "object") timeMapRef.current = t.timeMap;
        if (typeof t.currentQid === "string") currentQidRef.current = t.currentQid;
      }
    } catch { /* ignore */ }
    enterAtRef.current = Date.now();

    let cached: string | null = null;
    try {
      cached = sessionStorage.getItem(`session-${id}`);
      if (cached) {
        const raw = JSON.parse(cached);
        if (Array.isArray(raw)) {
          const norm = raw.map((q) => ({
            ...q,
            options: Array.isArray(q.options)
              ? q.options
              : typeof q.options === "string"
                ? (() => { try { const v = JSON.parse(q.options); return Array.isArray(v) ? v : []; } catch { return []; } })()
                : [],
          }));
          setQuestions(norm);
          setCurrent((c) => Math.min(c, norm.length - 1));
        }
      }
    } catch {
      sessionStorage.removeItem(`session-${id}`);
    }
    try {
      const saved = sessionStorage.getItem(`answers-${id}`);
      if (saved) setAnswers(JSON.parse(saved));
    } catch {
      sessionStorage.removeItem(`answers-${id}`);
    }

    api.get<SessionDetail>(`/sessions/${id}`)
      .then((d) => {
        if (typeof d.serverTime === "number") clockOffsetRef.current = d.serverTime - Date.now();
        if (d.submittedAt) {
          setDetail(d);
          setResult({ score: d.score ?? 0, total: d.total ?? 0, correctCount: d.correctCount ?? 0, details: [] });
          return;
        }
        if (d.deadlineAt) {
          // 考试进行中:用服务端持久化的绝对截止时间(含中途暂停后恢复的绝对时刻)
          const dl = new Date(d.deadlineAt).getTime();
          setDeadline(dl);
          setRemaining(Math.max(0, Math.floor((dl - serverNow()) / 1000)));
        } else if (d.pausedRemaining != null) {
          // 中途退出过(暂停):服务端 deadlineAt 已清空,仅保留剩余秒数。
          // 按 now + pausedRemaining 重建绝对截止时间,使续做时从剩余时间起算,
          // 退出/离线的时长不计入考试。同时通知后端恢复(把绝对截止时间重新写回)。
          const dl = serverNow() + d.pausedRemaining * 1000;
          setDeadline(dl);
          setRemaining(d.pausedRemaining);
          reportResume(d.pausedRemaining);
        } else if (d.durationMin && d.startedAt) {
          const dl = new Date(d.startedAt).getTime() + d.durationMin * 60000;
          setDeadline(dl);
          setRemaining(Math.max(0, Math.floor((dl - serverNow()) / 1000)));
        }
        if (!cached && d.details?.length) {
          setQuestions(d.details.map((x) => ({
            id: x.questionId, stem: x.stem, options: x.options, topic: x.topic,
            type: "SINGLE_CHOICE", subject: "", difficulty: 0,
          })));
          setCurrent((c) => Math.min(c, (d.details?.length ?? 1) - 1));
        }
        // 从后端恢复已保存的作答(中途退出后再进入本会话可继续):后端 selected 为权威,
        // 与本地 sessionStorage 缓存合并(本地最新优先),保证答案不丢失。
        const localKeys = Object.keys(answers);
        const fromBackend: Record<string, string> = {};
        let recovered = 0;
        (d.details || []).forEach((x) => {
          if (x.selected != null) {
            fromBackend[x.questionId] = x.selected as string;
            if (!localKeys.includes(x.questionId)) recovered += 1;
          }
        });
        if (Object.keys(fromBackend).length) {
          setAnswers((prev) => {
            const merged = { ...fromBackend, ...prev };
            try { sessionStorage.setItem(`answers-${id}`, JSON.stringify(merged)); } catch { /* ignore */ }
            return merged;
          });
          setSavedAt(Date.now());
          if (recovered > 0) setResumed(true);
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
    // 已收藏的题目 id 集合
    api.get<{ list: { question: { id: string } }[] }>("/me/favorites")
      .then((d) => setFavSet(new Set(d.list.map((f) => f.question.id))))
      .catch(() => {});
  }, [id]);

  // 同步最新答案到 ref(供交卷时读取),避免闭包取到旧值
  useEffect(() => { answersRef.current = answers; }, [answers]);

  // 每题停留计时:切换到新题时,把上一题的停留秒数累加到 timeMap
  useEffect(() => {
    const q = questions[current];
    if (currentQidRef.current) {
      const dt = Math.max(0, Math.round((Date.now() - enterAtRef.current) / 1000));
      timeMapRef.current[currentQidRef.current] = (timeMapRef.current[currentQidRef.current] || 0) + dt;
    }
    currentQidRef.current = q?.id ?? null;
    enterAtRef.current = Date.now();
    persistTiming();
  }, [current, questions, persistTiming]);

  const saveAnswer = useCallback((qid: string, selected: string) => {
    // 真实记录该题累计停留时间(秒),随作答一并上报
    const dt = Math.max(0, Math.round((Date.now() - enterAtRef.current) / 1000));
    const acc = (timeMapRef.current[qid] || 0) + dt;
    timeMapRef.current[qid] = acc;
    enterAtRef.current = Date.now();
    persistTiming();
    api.post(`/sessions/${id}/answer`, { questionId: qid, selected, timeSpent: acc })
      .then(() => setSavedAt(Date.now()))
      .catch(() => {});
  }, [id, persistTiming]);

  const submit = useCallback(async (auto = false) => {
    if (submittedRef.current) return;
    if (!auto && !window.confirm("确认交卷?交卷后将无法修改答案。")) return;
    // 结算当前题停留时间
    if (currentQidRef.current) {
      const dt = Math.max(0, Math.round((Date.now() - enterAtRef.current) / 1000));
      timeMapRef.current[currentQidRef.current] = (timeMapRef.current[currentQidRef.current] || 0) + dt;
      enterAtRef.current = Date.now();
    }
    // 上报所有已作答题的最终用时(确保服务端 timeSpent 为真实累计值)
    await Promise.all(
      Object.keys(answersRef.current)
        .filter((qid) => qid in timeMapRef.current)
        .map((qid) =>
          api.post(`/sessions/${id}/answer`, { questionId: qid, selected: answersRef.current[qid], timeSpent: timeMapRef.current[qid] }).catch(() => {})
        )
    );
    persistTiming();
    submittedRef.current = true;
    setSaving(true);
    setError("");
    try {
      const r = await api.post<GradeResult>(`/sessions/${id}/submit`);
      setResult(r);
      const d = await api.get<SessionDetail>(`/sessions/${id}`);
      setDetail(d);
      sessionStorage.removeItem(`session-${id}`);
      sessionStorage.removeItem(`answers-${id}`);
      sessionStorage.removeItem(TIMING_KEY(id));
    } catch (e) {
      submittedRef.current = false;
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setSaving(false);
    }
  }, [id, persistTiming]);

  // 倒计时:以服务端截止时间 deadline 为唯一时钟,每帧由真实时间推导剩余秒数,
  // 避免旧实现“自减计时器”与服务端时钟漂移(尤其切后台被节流)导致倒计时还在走、却已超时禁答。
  // 归零后自动交卷。
  useEffect(() => {
    if (remaining === null || detail || result) return;
    if (deadline === null) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const tick = () => {
      // 已暂停(页面隐藏/卸载):停止本地倒计时,避免后台误触发自动交卷;恢复后续做正常计时。
      if (pausedRef.current) return;
      const left = Math.max(0, Math.ceil((deadline - serverNow()) / 1000));
      remainingRef.current = left;
      setRemaining(left);
      if (left <= 0) {
        submit(true);
        return;
      }
      t = setTimeout(tick, 1000);
    };
    tick();
    return () => { if (t) clearTimeout(t); };
  }, [deadline, detail, result, submit]);

  // 考试中途退出/回到前台 → 暂停或恢复计时:
  // - 页面被隐藏(切后台/关标签)→ 暂停(真冻结:上报剩余秒数,服务端清空 deadlineAt)。
  // - 页面回到前台 → 恢复(按 now + 剩余重建绝对截止时间,离线时长不计入)。
  // 本地倒计时在已暂停期间停止(见上方 countdown effect 的 pausedRef 守卫),避免后台误触发自动交卷。
  useEffect(() => {
    if (!isExam) return;
    const pauseNow = () => {
      if (submittedRef.current || detail?.submittedAt || result) return;
      const rem = remainingRef.current;
      if (rem == null || rem <= 0) return;
      pausedRef.current = true;
      reportPause(rem);
    };
    const resumeNow = () => {
      if (submittedRef.current || detail?.submittedAt || result) return;
      if (!pausedRef.current) return;
      const rem = remainingRef.current;
      if (rem == null || rem <= 0) return;
      pausedRef.current = false;
      const dl = serverNow() + rem * 1000;
      setDeadline(dl);
      setRemaining(rem);
      reportResume(rem);
    };
    const onVis = () => {
      if (document.hidden) pauseNow();
      else resumeNow();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", pauseNow);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", pauseNow);
    };
  }, [isExam, id, detail, result]);

  // 计时兜底:页面隐藏/关闭时结算并持久化当前题已停留时间(避免最后片段丢失);
  // 回到前台时重置 enterAt,使离线/隐藏时长不计入当前题(练习与考试模式一致)。
  // 与上方考试暂停/恢复互不冲突:考试模式由 pause/resume 处理倒计时时钟,此处只管每题用时累加。
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) flushTiming();
      else enterAtRef.current = Date.now();
    };
    const onHide = () => flushTiming();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
    };
  }, [flushTiming]);

  // SPA 路由跳走(如浏览器后退/点其它链接离开本页)时组件卸载,但不触发 pagehide/visibilitychange,
  // 故单独用卸载副作用兜底:卸载时若仍在考试中则上报暂停,避免退出期间计时继续走。
  // 跳过开发模式 StrictMode 双挂载(挂载 <1s 即卸载)误触发;已交卷/不限时则不暂停。
  useEffect(() => {
    const onUnmount = () => {
      if (Date.now() - mountedAtRef.current < 1000) return; // 跳过 StrictMode 双挂载
      if (!isExamRef.current || submittedRef.current) return;
      const rem = remainingRef.current;
      if (rem == null || rem <= 0) return;
      reportPause(rem);
    };
    return onUnmount;
  }, [id]);

  // 键盘导航:←/→ 切题(批注书写时禁用,浏览模式可切)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (scratchOpen && !scratchInteractive) return;
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === "ArrowLeft") setCurrent((c) => Math.max(0, c - 1));
      if (e.key === "ArrowRight") setCurrent((c) => Math.min(questions.length - 1, c + 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [questions.length, scratchOpen, scratchInteractive]);

  // 中途退出保护:答题进行中(未交卷)关闭/刷新页面时提示,避免误丢进度。
  // 注意答案已在每次作答时实时保存到后端,刷新不会丢;此处仅作提醒。
  useEffect(() => {
    if (submittedRef.current || result || detail?.submittedAt) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [result, detail]);

  // 题目详情弹窗:按 ESC 关闭
  useEffect(() => {
    if (!openItem) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenItem(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openItem]);

  function choose(selected: string) {
    if (isExam && deadline !== null && serverNow() >= deadline) return; // 超时禁答(已按服务器时钟校准)
    if (questions.length === 0) return;
    const qid = questions[current].id;
    const next = { ...answers, [qid]: selected };
    setAnswers(next);
    sessionStorage.setItem(`answers-${id}`, JSON.stringify(next));
    saveAnswer(qid, selected);
  }

  // 收藏 / 取消收藏题目
  async function toggleFav(qid: string) {
    if (favBusy) return;
    setFavBusy(qid);
    try {
      if (favSet.has(qid)) {
        await api.del(`/me/favorites/${qid}`);
        setFavSet((prev) => { const n = new Set(prev); n.delete(qid); return n; });
      } else {
        await api.post("/me/favorites", { questionId: qid });
        setFavSet((prev) => new Set(prev).add(qid));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "收藏操作失败");
    } finally {
      setFavBusy(null);
    }
  }

  const modeLabel = isExam ? "模拟考" : "练习";
  const answeredCount = Object.keys(answers).length;
  const total = questions.length;

  // 按 questionId 去重(防御性)。useMemo 必须放在所有提前 return 之前,否则首屏
  // loading 提前返回会少调用一次 hook,二次渲染触发 "Rendered more hooks than during
  // the previous render" 客户端崩溃。
  const detailItems = useMemo(() => {
    const raw = detail?.details ?? [];
    const seen = new Set<string>();
    return raw.filter((d) => {
      if (!d?.questionId || seen.has(d.questionId)) return false;
      seen.add(d.questionId);
      return true;
    });
  }, [detail]);

  if (loading) return <p className="py-10 text-center text-sm text-slate-500">加载中...</p>;

  /* ============ 已提交:成绩总结 + 逐题解析 ============ */

  if (detail?.submittedAt) {
    const items = detailItems;
    const correct = detail.correctCount ?? 0;
    const wrong = items.filter((d) => d.selected != null && !d.isCorrect).length;
    const blank = items.filter((d) => d.selected == null).length;
    // 错题回顾:答错 + 未答
    const wrongItems = items.filter((d) => !d.isCorrect);
    const pct = detail.total ? Math.round((correct / detail.total) * 100) : 0;
    const grade = gradeOf(pct);
    // 每题用时分析:平均用时(仅统计有真实计时的题)
    const times = items.map((d) => d.timeSpent).filter((v): v is number => typeof v === "number" && v > 0);
    const avgTime = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
    // 折线图数据:每题用时(未计时的题记为 0)
    const timeChartData = items.map((d, i) => ({
      name: `Q${i + 1}`,
      time: typeof d.timeSpent === "number" && d.timeSpent > 0 ? d.timeSpent : 0,
    }));

    return (
      <div className="mx-auto max-w-3xl">
        <div className="overflow-hidden rounded-lg bg-[#fbf8f1] shadow-lg ring-1 ring-[#d9d2c2]">
          {/* 头 */}
          <div className="bg-gradient-to-br from-[#00467F] to-[#1f6fb2] px-8 py-6 text-white">
            <h1 className="text-lg font-bold tracking-wide">金瑞升学金鹰系统</h1>
            <p className="mt-1 text-xs opacity-90">{modeLabel} · 成绩报告</p>
            {result?.timedOut && <p className="mt-2 inline-block rounded bg-amber-500/20 px-2 py-0.5 text-xs">考试时间已到,系统已自动交卷</p>}
          </div>
          {/* 成绩总结 */}
          <div className="px-8 py-8 text-center">
            <p className="text-sm text-[#5a5346]">本次得分</p>
            <p className="mt-2 text-6xl font-bold leading-none text-[#00467F]">
              {correct}
              <small className="ml-1 text-2xl text-[#8a8377]">/ {detail.total}</small>
            </p>
            <p className="mt-3 text-2xl font-bold" style={{ color: grade.color }}>{pct}%</p>
            <span className="mt-2 inline-block rounded-full px-4 py-1 text-sm font-semibold text-white" style={{ background: grade.color }}>
              {grade.label}
            </span>
            <div className="mt-5 flex justify-center gap-3 text-sm">
              <span className="rounded border border-[#d9d2c2] bg-white px-3 py-1.5">答对 <b className="text-[#2e7d32]">{correct}</b></span>
              <span className="rounded border border-[#d9d2c2] bg-white px-3 py-1.5">答错 <b className="text-[#c62828]">{wrong}</b></span>
              <span className="rounded border border-[#d9d2c2] bg-white px-3 py-1.5">未答 <b className="text-[#8a8377]">{blank}</b></span>
              <span className="rounded border border-[#d9d2c2] bg-white px-3 py-1.5">平均用时 <b className="text-[#00467F]">{avgTime != null ? `${avgTime}s` : "—"}</b></span>
            </div>
            <div className="mt-6 flex justify-center gap-3">
              <button onClick={() => router.push("/app")} className="rounded bg-[#00467F] px-5 py-2 text-sm font-medium text-white hover:bg-[#1f6fb2]">
                返回首页
              </button>
            </div>
          </div>
          {/* 错题回顾:答错 + 未答,含答案与解析 */}
          {wrongItems.length > 0 && (
            <div className="space-y-4 px-6 pb-2">
              <div>
                <h2 className="flex items-center gap-2 text-base font-bold text-[#c62828]">📕 错题回顾</h2>
                <p className="mt-0.5 text-xs text-[#8a8377]">答错与未答的题目共 {wrongItems.length} 道，含正确答案与解析，便于针对性复习。</p>
              </div>
              {wrongItems.map((d, i) => (
                <div key={d.questionId} className="rounded border border-[#c62828] bg-white p-5 shadow-[0_0_0_3px_rgba(198,40,40,0.10)]">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 min-w-[52px] text-sm font-bold text-[#b8860b]">Q{i + 1}.</span>
                    <div className="flex-1">
                      <span className="mr-2 inline-block rounded-full px-2 py-0.5 text-[11px] text-white" style={{ background: topicColor(d.topic) }}>
                        {d.topic}
                      </span>
                      <span className="inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold bg-[#fdecea] text-[#c62828]">
                        {d.selected ? "✗ 答错" : "未作答"}
                      </span>
                      <p className="mt-2 text-[15px] leading-relaxed text-[#1a1a1a]">{renderRich(d.stem)}</p>
                      <div className="mt-3 space-y-1">
                        {d.options.map((opt, j) => {
                          const isAns = opt === d.answer;
                          const isSel = opt === d.selected;
                          return (
                            <div key={j} className={`rounded px-3 py-1.5 text-[14px] ${isAns ? "bg-[#e8f5e9] font-medium text-[#1b3a1d]" : isSel ? "bg-[#fdecea] text-[#5a1a17]" : "text-[#5a5346]"}`}>
                              <span className="mr-1 font-bold text-[#00467F]">{LETTERS[j]}.</span>
                              {renderRich(opt)}
                              {isAns && <span className="ml-2 text-xs text-[#2e7d32]">正确答案</span>}
                            </div>
                          );
                        })}
                      </div>
                      <p className="mt-2 text-sm text-[#5a5346]">
                        你的答案: <b className={d.selected ? "text-[#c62828]" : "text-[#8a8377]"}>{d.selected || "(未作答)"}</b>
                        <span className="ml-3 text-[#2e7d32]">正确答案: <b>{d.answer}</b></span>
                      </p>
                      {d.solution && (
                        <div className="mt-3 rounded border border-[#e3d6b0] bg-[#fbf6e9] px-3 py-2.5">
                          <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-[#8a6d1f]">
                            <span>💡</span><span>解析</span>
                          </div>
                          <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#3a3528]">{renderRich(d.solution, { smart: false })}</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {/* 每题用时折线图 */}
          <div className="px-6 pb-2 pt-2">
            <h2 className="mb-2 flex items-center gap-2 text-base font-bold text-[#00467F]">
              <span>⌛</span> 每题用时
              {avgTime != null && <span className="text-xs font-normal text-[#8a8377]">平均 {avgTime}s / 题</span>}
            </h2>
            <div className="rounded border border-[#d9d2c2] bg-white p-3">
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={timeChartData} margin={{ top: 8, right: 16, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#8a8377" }} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11, fill: "#8a8377" }} unit="s" width={42} />
                  <Tooltip formatter={(v: number) => [`${v}s`, "用时"]} labelFormatter={(l) => `${l} 用时`} />
                  <Line type="monotone" dataKey="time" name="用时" stroke="#1f6fb2" strokeWidth={2} dot={{ r: 3, fill: "#1f6fb2" }} activeDot={{ r: 5 }} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* 逐题简洁列表:题号 / 知识点 / 正误 / 用时 */}
          <div className="px-6 pb-8">
            <h2 className="mb-2 flex items-center gap-2 text-base font-bold text-[#00467F]">
              <span>📋</span> 答题明细
            </h2>
            <div className="overflow-hidden rounded border border-[#d9d2c2] bg-white">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[#d9d2c2] bg-[#f1ead9] text-[#5a5346]">
                    <th className="px-3 py-2 text-left font-normal">题号</th>
                    <th className="px-3 py-2 text-left font-normal">知识点</th>
                    <th className="px-3 py-2 text-left font-normal">正误</th>
                    <th className="px-3 py-2 text-right font-normal">用时</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((d, i) => (
                    <tr
                      key={d.questionId}
                      onClick={() => setOpenItem(d)}
                      className="cursor-pointer border-b border-[#eee] last:border-0 transition-colors hover:bg-[#f5f8fc]"
                      title="点击查看题目详情"
                    >
                      <td className="px-3 py-2 font-bold text-[#b8860b]">Q{i + 1}</td>
                      <td className="px-3 py-2">
                        <span className="inline-block rounded-full px-2 py-0.5 text-[11px] text-white" style={{ background: topicColor(d.topic) }}>
                          {d.topic}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${d.isCorrect ? "bg-[#e8f5e9] text-[#2e7d32]" : d.selected ? "bg-[#fdecea] text-[#c62828]" : "bg-[#f0ead8] text-[#5a5346]"}`}>
                          {d.isCorrect ? "✓ 答对" : d.selected ? "✗ 答错" : "未作答"}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right font-mono tabular-nums text-[#00467F]">
                        {typeof d.timeSpent === "number" && d.timeSpent > 0 ? `${d.timeSpent}s` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 题目详情弹窗:点击答题明细某行打开 */}
          {openItem && (
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
              onClick={() => setOpenItem(null)}
            >
              <div
                className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg bg-white shadow-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="sticky top-0 flex items-center justify-between border-b border-[#eee] bg-[#fbf8f1] px-5 py-3">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[#b8860b]">{openItem.topic}</span>
                    <span className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${openItem.isCorrect ? "bg-[#e8f5e9] text-[#2e7d32]" : openItem.selected ? "bg-[#fdecea] text-[#c62828]" : "bg-[#f0ead8] text-[#5a5346]"}`}>
                      {openItem.isCorrect ? "✓ 答对" : openItem.selected ? "✗ 答错" : "未作答"}
                    </span>
                    {typeof openItem.timeSpent === "number" && openItem.timeSpent > 0 && (
                      <span className="inline-block rounded-full bg-[#eef2f7] px-2 py-0.5 text-[11px] font-medium text-[#00467F]">用时 {openItem.timeSpent}s</span>
                    )}
                  </div>
                  <button
                    onClick={() => setOpenItem(null)}
                    className="rounded-full px-2 py-0.5 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    aria-label="关闭"
                  >
                    ✕
                  </button>
                </div>
                <div className="px-5 py-4">
                  <p className="text-[15px] leading-relaxed text-[#1a1a1a]">{renderRich(openItem.stem)}</p>
                  <div className="mt-3 space-y-1">
                    {openItem.options.map((opt, j) => {
                      const isAns = opt === openItem.answer;
                      const isSel = opt === openItem.selected;
                      return (
                        <div key={j} className={`rounded px-3 py-1.5 text-[14px] ${isAns ? "bg-[#e8f5e9] font-medium text-[#1b3a1d]" : isSel ? "bg-[#fdecea] text-[#5a1a17]" : "text-[#5a5346]"}`}>
                          <span className="mr-1 font-bold text-[#00467F]">{LETTERS[j]}.</span>
                          {renderRich(opt)}
                          {isAns && <span className="ml-2 text-xs text-[#2e7d32]">正确答案</span>}
                          {isSel && !isAns && <span className="ml-2 text-xs text-[#c62828]">你的选择</span>}
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-sm text-[#5a5346]">
                    你的答案: <b className={openItem.selected ? (openItem.isCorrect ? "text-[#2e7d32]" : "text-[#c62828]") : "text-[#8a8377]"}>{openItem.selected || "(未作答)"}</b>
                    <span className="ml-3 text-[#2e7d32]">正确答案: <b>{openItem.answer ?? "—"}</b></span>
                  </p>
                  {openItem.solution && (
                    <div className="mt-3 rounded border border-[#e3d6b0] bg-[#fbf6e9] px-3 py-2.5">
                      <div className="mb-1 flex items-center gap-1.5 text-[13px] font-semibold text-[#8a6d1f]">
                        <span>💡</span><span>解析</span>
                      </div>
                      <div className="whitespace-pre-wrap text-sm leading-relaxed text-[#3a3528]">{renderRich(openItem.solution, { smart: false })}</div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  /* ============ 答题中:试卷风格 ============ */
  if (questions.length === 0) {
    return <p className="py-10 text-center text-sm text-slate-500">该会话没有可用的题目。</p>;
  }
  const q = questions[current];
  const expired = isExam && deadline !== null && remaining !== null && remaining <= 0;
  const remainingStr = remaining === null ? "" : fmt(remaining);

  return (
    <div className="mx-auto max-w-3xl">
      <div className="overflow-hidden rounded-lg bg-[#fbf8f1] shadow-lg ring-1 ring-[#d9d2c2]">
        {/* 试卷头 */}
        <div className="bg-gradient-to-br from-[#00467F] to-[#1f6fb2] px-8 py-5 text-white">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-base font-bold tracking-wide">金瑞升学金鹰系统</h1>
              <p className="mt-0.5 text-xs opacity-90">
                {modeLabel} · 共 {total} 题 · 每题 1 分
                {isExam && <span className="ml-2 rounded bg-white/15 px-2 py-0.5">限时 {deadline ? Math.max(1, Math.ceil((deadline - serverNow()) / 60000)) : ""} 分钟</span>}
              </p>
            </div>
            <div className="text-right">
              {isExam && remaining !== null ? (
                <>
                  <p className={`font-mono text-3xl font-bold tabular-nums ${remaining <= 60 ? "animate-pulse text-amber-300" : ""}`}>{remainingStr}</p>
                  <p className="text-[11px] opacity-80">{remaining <= 60 ? "即将自动交卷" : "剩余时间"}</p>
                </>
              ) : (
                <>
                  <p className="text-3xl font-bold text-white/40">∞</p>
                  <p className="text-[11px] opacity-60">不限时</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* 恢复进度提示:中途退出后再进入本会话时显示,让"自动保存/续做"看得见 */}
        {resumed && (
          <div className="flex items-center gap-2 bg-[#e8f5e9] px-6 py-2 text-[13px] text-[#2e7d32]">
            <span className="font-semibold">↩ 已为你恢复上次作答进度</span>
            <span className="text-[#3f7a45]">已答 {answeredCount} / {total} 题,可继续作答;考试计时已按剩余时间继续。</span>
          </div>
        )}

        {/* 进度条 */}
        <div className="flex items-center gap-3 bg-[#f1ead9] px-6 py-2.5 text-[13px] text-[#5a5346]">
          <span className="shrink-0">已答 {answeredCount} / {total}</span>
          <div className="h-2 flex-1 overflow-hidden rounded bg-[#e0d8c2]">
            <div className="h-full bg-[#00467F] transition-all duration-300" style={{ width: `${total ? (answeredCount / total) * 100 : 0}%` }} />
          </div>
          <span className="shrink-0 text-[#8a8377]">进度 {total ? Math.round((answeredCount / total) * 100) : 0}%</span>
        </div>

        {/* 题号导航网格 */}
        <div className="flex flex-wrap gap-1.5 bg-[#f1ead9] px-6 pb-4">
          {questions.map((qq, i) => {
            const isCur = i === current;
            const hasAns = !!answers[qq.id];
            return (
              <button
                key={qq.id}
                onClick={() => setCurrent(i)}
                className={`flex h-9 w-9 items-center justify-center rounded text-[13px] font-bold transition-all ${
                  isCur
                    ? "bg-[#b8860b] text-white shadow-[0_0_0_3px_rgba(184,134,11,0.35)]"
                    : hasAns
                      ? "bg-[#00467F] text-white"
                      : "border border-[#d9d2c2] bg-white text-[#5a5346] hover:border-[#00467F] hover:text-[#00467F]"
                }`}
              >
                {i + 1}
              </button>
            );
          })}
        </div>

        {/* 题目卡片 */}
        <div className="px-6 py-6">
          <div className="rounded border border-[#d9d2c2] bg-white p-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-bold text-[#b8860b]">Q{current + 1}.</span>
              <span className="rounded-full px-2 py-0.5 text-[11px] text-white" style={{ background: topicColor(q.topic) }}>
                {q.topic}
              </span>
              <span className="text-xs text-[#8a8377]">难度 {q.difficulty}</span>
              <button
                onClick={() => toggleFav(q.id)}
                disabled={favBusy === q.id}
                title={favSet.has(q.id) ? "取消收藏本题" : "收藏本题,供以后查阅"}
                className={`ml-auto flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium transition disabled:opacity-50 ${
                  favSet.has(q.id)
                    ? "bg-amber-100 text-amber-700"
                    : "bg-slate-100 text-slate-500 hover:bg-amber-50 hover:text-amber-600"
                }`}
              >
                {favSet.has(q.id) ? "★ 已收藏" : "☆ 收藏"}
              </button>
            </div>
            <div className="mt-3 text-[15.5px] leading-relaxed text-[#1a1a1a]">{renderRich(q.stem)}</div>
            <div className="mt-4 space-y-1.5">
              {q.options.map((opt, j) => {
                const selected = answers[q.id] === opt;
                return (
                  <label
                    key={j}
                    className={`flex cursor-pointer items-start gap-2.5 rounded border px-3 py-2 text-[15px] transition-all ${
                      selected
                        ? "border-[#00467F] bg-[#e8eef7] shadow-[0_0_0_1px_#00467F]"
                        : "border-[#d9d2c2] bg-[#fdfaf2] hover:bg-[#f6f1e2]"
                    } ${expired ? "pointer-events-none opacity-60" : ""}`}
                  >
                    <input
                      type="radio"
                      name={`q-${current}`}
                      checked={selected}
                      disabled={expired}
                      onChange={() => choose(opt)}
                      className="peer sr-only"
                    />
                    <span className="mt-1.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-[#d9d2c2] bg-white transition peer-checked:border-[#00467F] peer-checked:bg-[#00467F] peer-disabled:border-[#d9d2c2]">
                      <span className="h-1.5 w-1.5 rounded-full bg-white opacity-0 transition peer-checked:opacity-100" />
                    </span>
                    <span className="font-bold text-[#00467F]">{LETTERS[j]}.</span>
                    <span className="leading-relaxed">{renderRich(opt, { smart: false })}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </div>

        {/* 分页导航 */}
        <div className="flex items-center justify-between px-6 pb-5">
          <button
            onClick={() => setCurrent((c) => Math.max(0, c - 1))}
            disabled={current === 0}
            className="rounded bg-[#00467F] px-4 py-2 text-sm text-white hover:bg-[#1f6fb2] disabled:bg-[#9aa3ad]"
          >
            ← 上一题
          </button>
          <span className="text-sm text-[#5a5346]">第 {current + 1} 题 / 共 {total} 题</span>
          {current < total - 1 ? (
            <button
              onClick={() => setCurrent((c) => Math.min(total - 1, c + 1))}
              className="rounded bg-[#00467F] px-4 py-2 text-sm text-white hover:bg-[#1f6fb2]"
            >
              下一题 →
            </button>
          ) : (
            <button
              onClick={() => submit(false)}
              disabled={saving}
              className="rounded bg-[#b8860b] px-5 py-2 text-sm font-semibold text-white hover:bg-[#d4a017] disabled:opacity-60"
            >
              {saving ? "交卷中..." : "交卷"}
            </button>
          )}
        </div>

        {error && <p className="px-6 pb-4 text-sm text-[#c62828]">{error}</p>}
      </div>

      <p className="mt-3 flex items-center justify-center gap-2 text-center text-xs text-[#8a8377]">
        <span className="inline-flex items-center gap-1 rounded-full bg-[#e8f5e9] px-2.5 py-1 font-medium text-[#2e7d32]">
          ✓ 作答已自动保存{savedAt ? ` · ${new Date(savedAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}` : ""}
        </span>
        <span>支持键盘 ← → 切换题目 · 中途退出可回到本页继续</span>
      </p>

      {/* 手写书写板:浮动入口 + 全屏草稿画布 */}
      <button
        onClick={() => setScratchOpen(true)}
        className="fixed bottom-5 right-5 z-40 flex items-center gap-1.5 rounded-full bg-[#00467F] px-4 py-3 text-sm font-medium text-white shadow-xl ring-1 ring-white/20 transition hover:bg-[#1f6fb2]"
        title="打开书写板,在草稿纸上书写/演算"
      >
        <span className="text-base leading-none">✍️</span> 书写
      </button>
      <ScratchPad open={scratchOpen} onClose={() => setScratchOpen(false)} onInteractivityChange={setScratchInteractive} />
    </div>
  );
}
