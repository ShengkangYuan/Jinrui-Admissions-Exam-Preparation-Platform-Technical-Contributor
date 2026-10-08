"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";

type LQ = {
  id: string;
  examType: string;
  skill: string;
  qType: string;
  part?: number | null;
  groupTitle?: string | null;
  stem: string;
  options: string[];
  audioUrl?: string | null;
  material?: { id: string; title: string | null; content: string } | null;
  wordLimit?: number | null;
};

type Segment = { skill: string; durationMin: number; questionCount: number };

type SessionData = {
  sessionId: string;
  mode: string;
  durationMin: number | null;
  segments: Segment[];
  questions: LQ[];
};

type SessionDetail = {
  id: string;
  examType: string;
  skill: string;
  mode: string;
  durationMin?: number | null;
  score: number | null;
  total: number | null;
  correctCount: number | null;
  band: number | null;
  submittedAt: string | null;
  paper: { id: string; title: string } | null;
  details: {
    questionId: string;
    stem: string;
    options: string[];
    answer?: string | null;
    solution?: string | null;
    audioUrl?: string | null;
    material?: { id: string; title: string | null; content: string } | null;
    selected?: string | null;
    isCorrect?: boolean | null;
    band?: number | null;
    feedback?: string | null;
    recordAudioUrl?: string | null;
    qType: string;
  }[];
};

const SKILL_LABEL: Record<string, string> = { LISTENING: "听力", READING: "阅读", WRITING: "写作", SPEAKING: "口语", FULL: "全真连考" };
const QTYPE_LABEL: Record<string, string> = {
  FILL_BLANK: "填空", SINGLE_CHOICE: "单选", MULTIPLE_CHOICE: "多选", MATCHING: "配对",
  TRUE_FALSE_NG: "判断", HEADING: "段落标题", TASK1: "写作Task1", TASK2: "写作Task2",
  PART1: "口语Part1", PART2: "口语Part2", PART3: "口语Part3",
};
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"];

const fmt = (s: number) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

const isObjective = (q: LQ) => ["FILL_BLANK", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING", "TRUE_FALSE_NG", "YES_NO_NG"].includes(q.qType);

// 计时器颜色: <60s 闪烁红, <5min 红, 其余常规
function timerClass(left: number | null) {
  if (left === null) return "text-slate-700";
  if (left < 60) return "timer-blink text-red-600";
  if (left < 300) return "text-red-500";
  return "text-slate-700";
}

// 口语录音组件
function Recorder({ onUploaded, existingUrl }: { onUploaded: (url: string) => void; existingUrl?: string | null }) {
  const [recording, setRecording] = useState(false);
  const [url, setUrl] = useState<string | null>(existingUrl || null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState("");
  const mediaRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  async function start() {
    setErr("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" });
        const reader = new FileReader();
        reader.onload = async () => {
          setUploading(true);
          try {
            const r = await api.post<{ url: string }>("/language/upload-recording", { filename: "speaking.webm", data: String(reader.result) });
            setUrl(r.url);
            onUploaded(r.url);
          } catch (e) {
            setErr(e instanceof Error ? e.message : "上传失败");
          } finally {
            setUploading(false);
          }
        };
        reader.readAsDataURL(blob);
      };
      mediaRef.current = rec;
      rec.start();
      setRecording(true);
    } catch {
      setErr("无法访问麦克风,请检查浏览器权限或改用文字作答");
    }
  }

  function stop() {
    mediaRef.current?.stop();
    setRecording(false);
  }

  return (
    <div>
      {!recording ? (
        <button
          className="rounded-lg bg-rose-600 px-4 py-2 text-sm font-medium text-white hover:bg-rose-700 disabled:opacity-50"
          onClick={start}
          disabled={uploading}
        >
          {uploading ? "上传中..." : "🎙️ 开始录音"}
        </button>
      ) : (
        <button className="animate-pulse rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white" onClick={stop}>
          ⏹ 停止录音(再点一次结束)
        </button>
      )}
      {url && <audio className="mt-2 block" controls src={url} />}
      {err && <p className="mt-1 text-xs text-red-500">{err}</p>}
    </div>
  );
}

export default function LanguagePracticePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [data, setData] = useState<SessionData | null>(null);
  const [answers, setAnswers] = useState<Record<string, { selected?: string; text?: string; audioUrl?: string }>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [current, setCurrent] = useState(0);
  const [filter, setFilter] = useState<"ALL" | "UNANSWERED" | "FLAGGED">("ALL");
  const [result, setResult] = useState<{ score: number; total: number; correctCount: number; band: number | null; needsReview: boolean } | null>(null);
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [remaining, setRemaining] = useState<number | null>(null);
  const [segRemaining, setSegRemaining] = useState<number | null>(null);
  const [restoreHint, setRestoreHint] = useState(false);
  const [saveHint, setSaveHint] = useState("");
  const [volume, setVolume] = useState<number>(() => {
    if (typeof window === "undefined") return 1;
    const v = Number(sessionStorage.getItem("lang-audio-volume"));
    return isNaN(v) ? 1 : v;
  });
  const [audioDisabled, setAudioDisabled] = useState(false);

  const submittedRef = useRef(false);
  const segStartRef = useRef(Date.now());
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const answersRef = useRef(answers);
  const pendingRef = useRef<Record<string, boolean>>({});

  // 分段信息:根据题目 skill 切段
  const segmentsInfo = useMemo(() => {
    if (!data || !data.questions.length) return null;
    if (!data.segments?.length) return null;
    const segs: { skill: string; durationMin: number; start: number; end: number }[] = [];
    let start = 0;
    for (const seg of data.segments) {
      let end = start;
      while (end < data.questions.length && data.questions[end].skill === seg.skill) end++;
      if (end === start) end = start + 1; // 兜底
      segs.push({ skill: seg.skill, durationMin: seg.durationMin, start, end });
      start = end;
    }
    return segs;
  }, [data]);

  const currentSegIdx = useMemo(() => {
    if (!segmentsInfo) return -1;
    const i = segmentsInfo.findIndex((s) => current >= s.start && current < s.end);
    return i < 0 ? 0 : i;
  }, [segmentsInfo, current]);

  const currentSeg = segmentsInfo ? segmentsInfo[currentSegIdx] : null;

  // 初始化:读缓存,或从后端恢复已提交会话
  useEffect(() => {
    let cached: SessionData | null = null;
    try {
      const raw = sessionStorage.getItem(`lang-session-${id}`);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed?.sessionId) {
          cached = parsed;
          setData(parsed);
          setRestoreHint(true);
          setTimeout(() => setRestoreHint(false), 4000);
          const restored = parsed.answers || {};
          if (Object.keys(restored).length) {
            setAnswers(restored);
            answersRef.current = restored;
          }
          const restoredFlags = parsed.flags || {};
          if (Object.keys(restoredFlags).length) setFlags(restoredFlags);
        }
      }
    } catch {
      sessionStorage.removeItem(`lang-session-${id}`);
    }

    api.get<SessionDetail>(`/language/sessions/${id}`)
      .then((d) => {
        if (d.submittedAt) {
          setDetail(d);
          setResult({ score: d.score ?? 0, total: d.total ?? 0, correctCount: d.correctCount ?? 0, band: d.band, needsReview: d.details.some((x) => x.qType.startsWith("TASK") || x.qType.startsWith("PART")) });
          setData(null);
          return;
        }
        if (!cached && d.details?.length) {
          const questions: LQ[] = d.details.map((x) => ({
            id: x.questionId, stem: x.stem, options: x.options, qType: x.qType,
            audioUrl: x.audioUrl, material: x.material, skill: d.skill, examType: d.examType,
          }));
          const sd: SessionData = { sessionId: id, mode: d.mode, durationMin: d.durationMin ?? null, segments: [], questions };
          setData(sd);
          sessionStorage.setItem(`lang-session-${id}`, JSON.stringify(sd));
        }
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  // 进入新题时同步音量 & 重置模考音频禁用
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    setAudioDisabled(false);
  }, [current, volume]);

  // 倒计时
  useEffect(() => {
    if (!data || result) return;
    const totalSec = data.durationMin ? data.durationMin * 60 : null;
    if (totalSec && !segmentsInfo) {
      const deadline = Date.now() + totalSec * 1000;
      const iv = setInterval(() => {
        const left = Math.max(0, Math.round((deadline - Date.now()) / 1000));
        setRemaining(left);
        if (left === 0) submit(true);
      }, 1000);
      return () => clearInterval(iv);
    }
  }, [data, result, segmentsInfo]);

  // 分段倒计时
  useEffect(() => {
    if (!data || !currentSeg || !segmentsInfo) return;
    // 进入新段时重置计时起点
    segStartRef.current = Date.now();
    const startKey = currentSeg.start;
    const endKey = currentSeg.end;
    const dur = currentSeg.durationMin * 60;
    const iv = setInterval(() => {
      const elapsed = (Date.now() - segStartRef.current) / 1000;
      const left = Math.max(0, dur - Math.round(elapsed));
      setSegRemaining(left);
      if (left <= 0 && current >= startKey && current < endKey) {
        const nextIdx = endKey;
        if (nextIdx < data.questions.length) {
          segStartRef.current = Date.now();
          setCurrent(nextIdx);
        } else {
          submit(true);
        }
      }
    }, 1000);
    return () => clearInterval(iv);
  }, [data, currentSeg, segmentsInfo, current]);

  // 自动保存心跳:2s 防抖批量回传脏数据
  useEffect(() => {
    if (!data || result) return;
    const iv = setInterval(async () => {
      const keys = Object.keys(pendingRef.current);
      if (!keys.length) return;
      setSaveHint("● 正在自动保存...");
      for (const qid of keys) {
        const v = answersRef.current[qid];
        if (!v) continue;
        try {
          if (v.text !== undefined || v.audioUrl !== undefined) {
            await api.post(`/language/sessions/${id}/answer/text`, { questionId: qid, text: v.text, audioUrl: v.audioUrl });
          } else {
            await api.post(`/language/sessions/${id}/answer`, { questionId: qid, selected: v.selected });
          }
        } catch {
          // 静默,下次心跳重试(不清除脏标记)
          return;
        }
      }
      pendingRef.current = {};
      setSaveHint("✓ 已自动保存");
    }, 2000);
    return () => clearInterval(iv);
  }, [data, result, id]);

  const q = data?.questions[current];

  // 写入本地 state 并标记脏,交给心跳回传
  function queueSave(qid: string, val: { selected?: string; text?: string; audioUrl?: string }) {
    setAnswers((p) => {
      const next = { ...p, [qid]: val };
      answersRef.current = next;
      return next;
    });
    pendingRef.current[qid] = true;
    setSaveHint("● 有未保存的改动");
    if (data) {
      sessionStorage.setItem(`lang-session-${id}`, JSON.stringify({ ...data, answers: answersRef.current, flags }));
    }
  }

  function saveAnswer(qid: string, selected?: string, text?: string, audioUrl?: string) {
    queueSave(qid, { selected, text, audioUrl });
  }

  function toggleFlag(qid: string) {
    setFlags((p) => {
      const next = { ...p, [qid]: !p[qid] };
      if (data) sessionStorage.setItem(`lang-session-${id}`, JSON.stringify({ ...data, answers: answersRef.current, flags: next }));
      return next;
    });
  }

  // 阅读高亮:用 mark 包裹当前选区(仅视觉,不持久化)
  function highlightSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const mark = document.createElement("mark");
    mark.className = "reading-mark";
    try {
      sel.getRangeAt(0).surroundContents(mark);
      sel.removeAllRanges();
    } catch {
      window.alert("请选择同一段落内的连续文本进行高亮");
    }
  }

  const submit = useCallback(async (auto = false) => {
    if (submittedRef.current) return;
    if (!auto && !window.confirm("确认交卷?交卷后将无法修改答案。")) return;
    submittedRef.current = true;
    setSaving(true);
    setError("");
    try {
      const r = await api.post<{ score: number; total: number; correctCount: number; band: number | null; needsReview: boolean }>(`/language/sessions/${id}/submit`);
      setResult(r);
      const d = await api.get<SessionDetail>(`/language/sessions/${id}`);
      setDetail(d);
      sessionStorage.removeItem(`lang-session-${id}`);
    } catch (e) {
      submittedRef.current = false;
      setError(e instanceof Error ? e.message : "交卷失败");
    } finally {
      setSaving(false);
    }
  }, [id]);

  // —— 结果视图 ——
  if (result && detail) {
    return (
      <div className="mx-auto max-w-3xl">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-bold text-slate-800">作答结果</h1>
          <button className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200" onClick={() => router.push("/app/language")}>返回语言学习</button>
        </div>
        <div className="mb-4 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          {detail.band !== null && detail.band !== undefined ? (
            <>
              <p className="text-5xl font-bold text-indigo-600">Band {detail.band}</p>
              <p className="mt-1 text-sm text-slate-500">雅思(折算)分数</p>
            </>
          ) : result.needsReview ? (
            <p className="text-lg font-medium text-amber-600">已交卷 · 写作/口语部分待教师批改</p>
          ) : (
            <p className="text-lg font-medium text-slate-700">已交卷</p>
          )}
          <p className="mt-3 text-sm text-slate-500">客观题 {detail.correctCount}/{detail.total} 正确</p>
        </div>
        <div className="space-y-4">
          {detail.details.map((d) => {
            const isObj = isObjective({ qType: d.qType } as LQ);
            return (
              <div key={d.questionId} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="mb-1 flex flex-wrap items-center gap-1.5">
                  <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-600">{QTYPE_LABEL[d.qType] || d.qType}</span>
                  {isObj && (
                    <span className={`rounded-md px-1.5 py-0.5 text-xs ${d.isCorrect ? "bg-emerald-50 text-emerald-600" : "bg-red-50 text-red-600"}`}>
                      {d.isCorrect ? "正确" : "错误"}
                    </span>
                  )}
                  {d.band !== null && d.band !== undefined && <span className="rounded-md bg-emerald-50 px-1.5 py-0.5 text-xs text-emerald-600">Band {d.band}</span>}
                </div>
                <p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{d.stem}</p>
                {d.material && <div className="mt-2 max-h-40 overflow-y-auto rounded bg-slate-50 p-2 text-xs text-slate-500 whitespace-pre-wrap">{d.material.content}</div>}
                {d.audioUrl && <audio className="mt-2" controls src={d.audioUrl} />}
                {isObj ? (
                  <>
                    <div className="mt-2 text-sm">
                      <span className="text-slate-400">我的答案: </span>
                      <b className={d.isCorrect ? "text-emerald-600" : "text-red-600"}>{d.selected || "(未答)"}</b>
                      {!d.isCorrect && <span className="ml-3 text-slate-400">正确答案: <b className="text-emerald-600">{d.answer}</b></span>}
                    </div>
                    {d.solution && <p className="mt-2 whitespace-pre-wrap rounded bg-slate-50 px-3 py-2 text-xs text-slate-500">解析: {d.solution}</p>}
                  </>
                ) : (
                  <>
                    <div className="mt-2 rounded bg-[#f6f1e2] p-3 text-sm whitespace-pre-wrap text-slate-800">{d.selected || "(未作答)"}</div>
                    {d.recordAudioUrl && <audio className="mt-2" controls src={d.recordAudioUrl} />}
                    {d.band !== null && d.band !== undefined && (
                      <div className="mt-2 rounded bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                        教师评分: Band {d.band}{d.feedback ? ` · ${d.feedback}` : ""}
                      </div>
                    )}
                    {!d.band && <p className="mt-2 text-xs text-amber-600">等待教师批改</p>}
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  // —— 加载中 ——
  if (loading || !data) {
    return <p className="py-10 text-center text-slate-400">{loading ? "加载中..." : "会话不存在"}</p>;
  }

  if (!q) return null;

  const isObj = isObjective(q);
  const curAnswer = answers[q.id] || {};
  const isDone = !!(curAnswer.selected || curAnswer.text || curAnswer.audioUrl);
  const answeredCount = data.questions.filter((item) => {
    const a = answers[item.id];
    return !!(a?.selected || a?.text || a?.audioUrl);
  }).length;

  const navItems = data.questions
    .map((item, i) => ({ item, i }))
    .filter(({ item }) => {
      if (filter === "ALL") return true;
      const a = answers[item.id];
      const done = !!(a?.selected || a?.text || a?.audioUrl);
      if (filter === "UNANSWERED") return !done;
      return !!flags[item.id];
    });

  // —— 作答视图 ——
  return (
    <div className="mx-auto max-w-4xl">
      <style>{`.timer-blink{animation:tmblink 1s steps(2,start) infinite}@keyframes tmblink{50%{opacity:.25}}.reading-mark{background:#fde68a;color:inherit;border-radius:2px}`}</style>

      {/* 顶部栏 */}
      <div className="sticky top-0 z-10 mb-4 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">{SKILL_LABEL[q.skill] || q.skill}</span>
            <span className="text-xs text-slate-500">{q.groupTitle || QTYPE_LABEL[q.qType] || q.qType}</span>
          </div>
          <div className="flex items-center gap-3">
            {segmentsInfo && currentSeg && (
              <span className={`text-xs ${timerClass(segRemaining)}`}>
                {SKILL_LABEL[currentSeg.skill]}段 · {segRemaining !== null ? fmt(segRemaining) : "--"}
              </span>
            )}
            {remaining !== null && !segmentsInfo && <span className={`text-sm font-bold ${timerClass(remaining)}`}>{fmt(remaining)}</span>}
            <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50" onClick={() => submit()} disabled={saving}>
              {saving ? "交卷中..." : "交卷"}
            </button>
          </div>
        </div>
        {/* 分段进度条 */}
        {segmentsInfo && (
          <div className="mt-2">
            <div className="flex gap-1.5">
              {segmentsInfo.map((s, i) => (
                <div key={i} className="flex-1">
                  <div
                    className="h-1.5 rounded-full"
                    style={{
                      background: i === currentSegIdx ? "#4f46e5" : i < currentSegIdx ? "#a5b4fc" : "#e2e8f0",
                      transition: "background-color 0.5s ease",
                    }}
                  />
                  <div className={`mt-1 text-center text-[10px] ${i === currentSegIdx ? "font-semibold text-indigo-600" : "text-slate-400"}`}>
                    {SKILL_LABEL[s.skill] || s.skill}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        {restoreHint && (
          <p className="mt-2 text-center text-xs text-amber-600">📥 已从本地恢复上次作答进度</p>
        )}
        {saveHint && (
          <p className="mt-1 text-right text-[11px] text-slate-400">{saveHint}</p>
        )}
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1.5">
          {data.questions.map((item, i) => {
            const a = answers[item.id];
            const done = !!(a?.selected || a?.text || a?.audioUrl);
            const flagged = !!flags[item.id];
            return (
              <button
                key={item.id}
                onClick={() => setCurrent(i)}
                title={flagged ? "已标记" : undefined}
                className={`relative h-8 w-8 rounded-lg text-xs font-medium transition ${i === current ? "bg-indigo-600 text-white" : done ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}
              >
                {i + 1}
                {flagged && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-amber-400 ring-1 ring-white" />}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-slate-400">已答 {answeredCount}/{data.questions.length}</span>
          <div className="flex overflow-hidden rounded-lg border border-slate-200">
            {(["ALL", "UNANSWERED", "FLAGGED"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-2 py-1 ${filter === f ? "bg-indigo-50 text-indigo-600" : "text-slate-500 hover:bg-slate-50"}`}
              >
                {f === "ALL" ? "全部" : f === "UNANSWERED" ? "未作答" : "已标记"}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 阅读分屏:材料 + 题目 */}
      <div className={q.skill === "READING" && q.material ? "grid gap-4 lg:grid-cols-2" : ""}>
        {q.skill === "READING" && q.material && (
          <div className="max-h-[70vh] overflow-y-auto rounded-2xl border border-slate-200 bg-[#fbfaf7] p-5 shadow-sm">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-medium text-slate-400">阅读材料</span>
              <button className="rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-700 hover:bg-amber-100" onClick={highlightSelection}>🖍 高亮选中</button>
            </div>
            {q.material.title && <p className="mb-2 text-sm font-bold text-slate-700">{q.material.title}</p>}
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{q.material.content}</p>
          </div>
        )}

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {/* 听力音频 + 音量 */}
          {q.skill === "LISTENING" && q.audioUrl && (
            <div className="mb-3 rounded-xl bg-slate-50 p-3">
              {!audioDisabled ? (
                <audio
                  ref={audioRef}
                  className="w-full"
                  controls
                  src={q.audioUrl}
                  onEnded={() => { if (data.mode === "EXAM") setAudioDisabled(true); }}
                />
              ) : (
                <div className="rounded-lg bg-slate-200 px-3 py-2 text-xs text-slate-600">模考音频仅可播放一次,本段音频已结束</div>
              )}
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-slate-500">音量</span>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={volume}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setVolume(v);
                    if (audioRef.current) audioRef.current.volume = v;
                    sessionStorage.setItem("lang-audio-volume", String(v));
                  }}
                  className="w-32"
                />
                <span className="text-xs text-slate-400">{Math.round(volume * 100)}%</span>
              </div>
            </div>
          )}
          {/* 写作/口语材料(任务描述/提示卡) */}
          {(q.skill === "WRITING" || q.skill === "SPEAKING") && q.material && (
            <div className="mb-3 rounded-xl bg-[#fbfaf7] p-3">
              {q.material.title && <p className="mb-1 text-sm font-bold text-slate-700">{q.material.title}</p>}
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{q.material.content}</p>
            </div>
          )}
          <p className="mb-4 whitespace-pre-wrap text-base leading-relaxed text-slate-800">{q.stem}</p>

          {isObj ? (
            q.qType === "FILL_BLANK" ? (
              <input
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-indigo-400 focus:outline-none"
                placeholder="输入答案(如 analysis)"
                value={curAnswer.selected || ""}
                onChange={(e) => saveAnswer(q.id, e.target.value)}
              />
            ) : (
              <div className="space-y-2">
                {q.options.map((opt, i) => (
                  <label key={i} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${curAnswer.selected === LETTERS[i] ? "border-indigo-500 bg-indigo-50" : "border-slate-200 hover:bg-slate-50"}`}>
                    <input
                      type="radio"
                      name={q.id}
                      checked={curAnswer.selected === LETTERS[i]}
                      onChange={() => saveAnswer(q.id, LETTERS[i])}
                      className="mt-1"
                    />
                    <span className="flex-1 text-sm text-slate-700"><b className="mr-1 text-slate-400">{LETTERS[i]}.</b>{opt}</span>
                  </label>
                ))}
              </div>
            )
          ) : (
            <div>
              {q.skill === "SPEAKING" && (
                <Recorder existingUrl={curAnswer.audioUrl} onUploaded={(url) => saveAnswer(q.id, undefined, curAnswer.text, url)} />
              )}
              <textarea
                className="mt-3 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm leading-relaxed focus:border-indigo-400 focus:outline-none"
                rows={q.skill === "WRITING" ? 12 : 6}
                placeholder={q.skill === "WRITING" ? "在此输入你的作答..." : "可补充文字作答(选填)"}
                value={curAnswer.text || ""}
                onChange={(e) => saveAnswer(q.id, undefined, e.target.value, curAnswer.audioUrl)}
              />
              {q.skill === "WRITING" && (
                <p className="mt-1 text-right text-xs text-slate-400">
                  当前 {((curAnswer.text || "").match(/\S+/g) || []).length} 词{q.wordLimit ? ` / 要求 ≥${q.wordLimit} 词` : ""}
                </p>
              )}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
            <button
              onClick={() => toggleFlag(q.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-medium ${flags[q.id] ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-500 hover:bg-slate-200"}`}
            >
              {flags[q.id] ? "★ 已标记" : "☆ 标记此题"}
            </button>
            <span className="text-xs text-slate-400">第 {current + 1} / {data.questions.length} 题</span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button className="rounded-lg bg-slate-100 px-4 py-2 text-sm text-slate-600 hover:bg-slate-200 disabled:opacity-30" disabled={current === 0} onClick={() => setCurrent(current - 1)}>上一题</button>
        {current < data.questions.length - 1 ? (
          <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700" onClick={() => setCurrent(current + 1)}>下一题</button>
        ) : (
          <button className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50" onClick={() => submit()} disabled={saving}>{saving ? "交卷中..." : "提交试卷"}</button>
        )}
      </div>

      {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
