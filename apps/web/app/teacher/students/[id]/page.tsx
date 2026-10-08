"use client";

import { useEffect, useMemo, useState, Component, type ReactNode } from "react";
import { useParams } from "next/navigation";
import dynamic from "next/dynamic";
import { api } from "@/lib/api";
import { renderRich } from "@/lib/rich";

// 图表组件以客户端动态加载(ssr:false),避免 recharts 在 Next App Router 下触发客户端异常,
// 并用错误边界隔离:即使单个图表渲染失败,也不至于整页白屏。
const RadarPanel = dynamic(() => import("./RadarPanel"), { ssr: false, loading: () => <div className="h-72" /> });
const TrendPanel = dynamic(() => import("./TrendPanel"), { ssr: false, loading: () => <div className="h-52" /> });

// 成绩趋势「全部」视图下，每种考试类型一条折线，按出现顺序循环取色（白底卡片，固定可读色）。
const TREND_COLORS = ["#6C5CE7", "#F59E0B", "#10B981", "#EF4444", "#3B82F6", "#8B5CF6", "#14B8A6", "#EC4899"];

class ChartErrorBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed) return <>{this.props.fallback}</>;
    return <>{this.props.children}</>;
  }
}

// 页面级兜底:若仍有未捕获的渲染异常(非图表),展示可读错误信息而非 Next 默认白屏,便于定位根因。
class PageErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (this.state.error) {
      const stack = (this.state.error.stack || "").split("\n").slice(0, 8).join("\n");
      return (
        <div className="mx-auto max-w-2xl rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
          <p className="font-semibold">页面渲染出错（已拦截，未白屏）</p>
          <p className="mt-2 whitespace-pre-wrap break-all">{this.state.error.message}</p>
          <pre className="mt-3 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded bg-red-100 p-2 text-[11px] text-red-600">{stack}</pre>
          <p className="mt-3 text-xs text-red-500">请截图此信息反馈；其余功能不受影响。硬刷新(Cmd/Ctrl+Shift+R)后重试。</p>
        </div>
      );
    }
    return <>{this.props.children}</>;
  }
}

interface Detail {
  student: { id: string; name: string; email: string; createdAt: string };
  sessions: {
    id: string; mode: string; score: number | null; total: number | null; correctCount: number | null;
    startedAt: string; submittedAt: string | null;
    assignmentId: string | null;
    paper: { title: string | null; subject: string | null; sourceType: string | null; mode: string | null } | null;
    durationSec: number | null; status: "DONE" | "IN_PROGRESS";
  }[];
  byTopic: { topic: string; attempts: number; correctRate: number }[];
}

// 每生学情高维矩阵(来自 /teacher/stats/students-matrix?studentId=,仅教师端可见)
interface MatrixSpeed {
  meanSec: number | null;
  medianSec: number | null;
  count: number;
  baselineSec?: number | null;
}
interface MatrixStudent {
  id: string;
  name: string;
  email: string;
  sessionCount: number;
  avgRate: number;
  difficulty: { difficulty: number; attempts: number; correctRate: number }[];
  speed: { exam: MatrixSpeed; practice: MatrixSpeed; baselineSec?: number | null };
  speedScore?: number | null;
  trend: { slopePerSession: number | null; firstRate: number | null; lastRate: number | null; direction: string };
  stability: { cv: number | null; meanRate: number | null; label: string };
  modeDivergence: { examRate: number | null; practiceRate: number | null; delta: number | null };
  coverage: { covered: number; total: number; rate: number };
  carelessness: { highBaseAttempts: number; slipCount: number; slipRate: number | null };
  errorProfile?: ErrorProfile;
}

// 错题归因(口径B · 行为推断): 每条错答按优先级唯一归因,桶按条数降序返回
interface ErrSample {
  questionId: string;
  topic: string;
  sourceType: string | null;
  mode: string | null;
  selected: string | null;
  answer: string | null;
  timeSpent: number | null;
  stem?: string | null;
  options?: string[] | null;
  solution?: string | null;
}
interface ErrorProfile {
  wrongTotal: number;
  minSample: number;
  buckets: { key: string; label: string; color: string; count: number; rate: number; samples: ErrSample[] }[];
}

// 班级基准(全体有作答学生聚合),字段结构与 MatrixStudent 的 7 维度一致
interface MatrixBaseline {
  avgRate: number;
  difficulty: { difficulty: number; attempts: number; correctRate: number }[];
  speed: { exam: MatrixSpeed; practice: MatrixSpeed; baselineSec?: number | null };
  speedScore?: number | null;
  trend: { slopePerSession: number | null; direction: string };
  stability: { cv: number | null; meanRate: number | null; label: string };
  modeDivergence: { examRate: number | null; practiceRate: number | null; delta: number | null };
  coverage: { covered: number; total: number; rate: number };
  carelessness: { highBaseAttempts: number; slipCount: number; slipRate: number | null };
  errorShare?: Record<string, number>;
}

interface MatrixResp {
  student: MatrixStudent | null;
  classBaseline: MatrixBaseline | null;
  highBaseQuestionCount: number;
  totalTopicCount: number;
}

function fmtDur(sec: number | null) {
  if (sec == null) return "—";
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}分${s}秒` : `${s}秒`;
}
function fmtTime(done: string | null, started: string) {
  const v = done || started;
  return new Date(v).toLocaleString("zh-CN") + (done ? "" : " (进行中)");
}
function classifyPaper(title: string | null): string {
  if (!title) return "其他";
  if (/TMUA\s*Paper\s*1/i.test(title)) return "TMUA Paper 1";
  if (/TMUA\s*Paper\s*2/i.test(title)) return "TMUA Paper 2";
  if (/ESAT\s*数学\s*1/i.test(title)) return "ESAT 数学1";
  if (/ESAT\s*数学\s*2/i.test(title)) return "ESAT 数学2";
  if (/^MAT/i.test(title)) return "MAT";
  if (/^NSAA/i.test(title)) return "NSAA";
  if (/^ENGAA/i.test(title)) return "ENGAA";
  return "其他";
}
function shortDate(s: string) {
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);

// ——— 卷子类型分类（把「模考」按考试 + 卷号拆开） ———
// 动机：TMUA P1 与 P2 题型/难度分布不同（P2 含逻辑论证），混在一条趋势线上会互相抵消，
// 看不出任一卷的真实进退。故按卷子类型分列统计。
// 判据只用库内既有字段：paper.sourceType（TMUA/ESAT/NSAA）+ paper.title（含 "Paper 1/2"、"数学1/2"、"Physics"）。
// ⚠️ 顺序敏感：先判 P2 / 数学2，否则子串会被 P1 / 数学1 先命中（"Paper 2" 不含 "Paper 1"，但仍统一按长优先写）。
function paperKindOf(p: { title?: string | null; sourceType?: string | null } | null | undefined): string {
  const t = p?.title ?? "";
  const st = p?.sourceType ?? "";
  if (st === "TMUA") {
    if (/paper\s*2|卷\s*2|\bp2\b/i.test(t)) return "TMUA P2";
    if (/paper\s*1|卷\s*1|\bp1\b/i.test(t)) return "TMUA P1";
    return "TMUA 其他";
  }
  if (st === "ESAT") {
    if (/数学\s*2|maths?\s*2|\bm2\b/i.test(t)) return "ESAT M2";
    if (/數學\s*2/i.test(t)) return "ESAT M2";
    if (/数学\s*1|maths?\s*1|\bm1\b/i.test(t)) return "ESAT M1";
    if (/物理|physics/i.test(t)) return "ESAT 物理";
    return "ESAT 其他";
  }
  if (st === "NSAA") return "NSAA";
  return st || "其他";
}

// 难度档 → 知识点色阶(5 级)
function heatColor(p: number): string {
  if (p >= 90) return "#6BCB96";
  if (p >= 75) return "#9BDCB4";
  if (p >= 60) return "#CDEBD3";
  if (p >= 45) return "#FBE3B8";
  return "#F6C6C6";
}

// ——— 归一化(0–100,越高越优;一律取整,避免 95.49071618037135 这类原始浮点外泄) ———
// 速度按考试基准归一: TMUA 180s/题、ESAT 80s/题; median≤baseline → 80(满锚点改为 80,不再封顶 100), 越慢越低
// 注: 该式仅用于单生展示兜底; 班级均值必须用后端逐生 speedScore 均值(teacher.js classBaseline.speedScore),
//     否则池化中位再归一会饱和(2026-09-19 修复,见 CHANGELOG)。
const normSpeed = (median: number | null, baselineSec?: number | null) =>
  median == null ? 50 : Math.round(baselineSec ? clamp((80 * baselineSec) / median, 0, 80) : clamp(100 - median * 2));
const normCare = (slip: number | null) => (slip == null ? 50 : Math.round(clamp(100 - slip)));
const trendScoreOf = (dir: string) => (dir === "up" ? 85 : dir === "down" ? 25 : 55);
const stabScoreOf = (label: string) =>
  label === "stable" ? 100 : label === "moderate" ? 65 : label === "volatile" ? 30 : 50;
const examScoreOf = (delta: number | null) => (delta == null ? 50 : Math.round(clamp(50 + delta)));

// 迷你 sparkline(纯 SVG,无依赖);data 为空则渲染 null(诚实:无历史序列的 KPI 不画假趋势)
function Sparkline({ data, color }: { data: readonly number[]; color: string }) {
  if (!data.length) return null;
  const W = 118, H = 26;
  const mn = Math.min(...data), mx = Math.max(...data);
  const span = mx - mn || 1;
  const pts = data.map((v, i) => {
    const x = data.length === 1 ? W : (i / (data.length - 1)) * W;
    const y = H - 2 - ((v - mn) / span) * (H - 4);
    return [Number(x.toFixed(1)), Number(y.toFixed(1))];
  });
  const line = pts.map((p) => `${p[0]},${p[1]}`).join(" ");
  const area = `0,${H} ${line} ${W},${H}`;
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={26} preserveAspectRatio="none" style={{ display: "block" }}>
      <polygon points={area} fill={color} fillOpacity={0.1} />
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={last[0]} cy={last[1]} r={2.4} fill={color} />
    </svg>
  );
}

// 概要 KPI 卡片
// ⚠️ 布局不变量（2026-09-17 溢出事故沉淀）：
// 教师端 <main> 是 max-w-5xl（内容区恒 ≤992px），所以 KPI 网格**不能按视口断点开 8 列**——
// 一旦开到 8 列，每格内容宽只剩 ~91px，"188.5(62px) + s + ▲8.5s(34px)" 塞不下，
// 差值 span 会被 flex 压到 min-content 并在**内部折行**（▲ 留第一行、8.5s 掉第二行）⇒ 看起来"超出方格"。
// 故：① 列数上限 4（见概要约 div 的 grid-cols）；② 差值 shrink-0 + whitespace-nowrap，放不下就整块下移，
//     绝不拆字；③ 卡片 flex-col + 曲线 mt-auto，副标题允许折行 → 同排卡片等高、内容不越界。
function Kpi({
  label, value, unit, delta, deltaUnit, higherBetter, sub, spark, color, tip,
}: {
  label: string; value: string; unit?: string; delta: number | null; deltaUnit?: string; higherBetter: boolean;
  sub: string; spark: readonly number[]; color: string; tip?: string;
}) {
  const hasDelta = delta != null && !Number.isNaN(delta);
  const good = hasDelta ? (higherBetter ? delta! > 0 : delta! < 0) : null;
  const arrow = !hasDelta ? "→" : delta! > 0 ? "▲" : delta! < 0 ? "▼" : "→";
  const deltaCls = good == null ? "text-slate-400" : good ? "text-emerald-600" : "text-red-500";
  const mag = hasDelta ? (Math.abs(delta!) < 10 ? Math.abs(delta!).toFixed(1) : String(Math.round(Math.abs(delta!)))) : "";
  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
      <div className="flex min-w-0 items-center gap-1 text-[10.5px] text-slate-500">
        <span className="truncate">{label}</span>
        <span className="shrink-0 text-slate-300" title={tip}>ⓘ</span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span className="shrink-0 text-[23px] font-bold leading-none tracking-tight text-slate-800">{value}</span>
        {unit && <span className="shrink-0 text-[11.5px] font-semibold text-slate-400">{unit}</span>}
        {hasDelta && (
          <span className={`ml-auto shrink-0 whitespace-nowrap text-[10.5px] font-semibold ${deltaCls}`}>
            {arrow} {mag}{deltaUnit ?? ""}
          </span>
        )}
      </div>
      <div className="mt-1 text-[10.5px] leading-snug text-slate-400">{sub}</div>
      <div className="mt-auto pt-1">{spark.length > 0 ? <Sparkline data={spark} color={color} /> : <div className="h-[26px]" />}</div>
    </div>
  );
}

export default function StudentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState("");
  const [modeF, setModeF] = useState<"ALL" | "EXAM" | "PRACTICE">("ALL");
  const [matrix, setMatrix] = useState<MatrixStudent | null>(null);
  const [baseline, setBaseline] = useState<MatrixBaseline | null>(null);
  const [highBaseQuestionCount, setHighBaseQuestionCount] = useState(0);
  const [totalTopicCount, setTotalTopicCount] = useState(0);
  const [drill, setDrill] = useState<ErrSample | null>(null);
  // 「做题情况」面板折叠态。默认折叠(false),点击标题行展开。
  // ⚠️ 必须与其它 useState 同处 early return 之前,否则触发 Rules of Hooks 白屏。
  const [sessionsOpen, setSessionsOpen] = useState(false);
  // 成绩趋势的「卷子类型」筛选（"ALL" | "TMUA P1" | "TMUA P2" | …）。默认全部。
  // ⚠️ 同样必须在 early return 之前，理由同上。
  const [trendKind, setTrendKind] = useState<string>("ALL");

  useEffect(() => {
    api.get<Detail>(`/teacher/students/${id}/stats`).then(setDetail).catch((e) => setError(e.message));
    api.get<MatrixResp>(`/teacher/stats/students-matrix?studentId=${id}`).then((d) => {
      setMatrix(d.student);
      setBaseline(d.classBaseline);
      setHighBaseQuestionCount(d.highBaseQuestionCount);
      setTotalTopicCount(d.totalTopicCount);
    }).catch(() => {});
  }, [id]);

  // ⚠️ Rules of Hooks：所有 Hook 必须在任何 early return 之前调用。
  // 旧版把 `if (error) return` / `if (!detail) return 加载中` 放在下面这些 useMemo 之前，
  // 导致首屏只执行 8 个 Hook、数据到达后再渲染要执行 15 个 Hook，
  // React 直接抛 "Rendered more hooks than during the previous render"
  // → 整页 "Application error: a client-side exception has occurred"（子组件错误边界拦不住）。
  // 修法：用 `detail?.sessions ?? []` 做空值保护，把 early return 统一挪到所有 Hook 之后。

  // ——— 历史序列(供 KPI sparkline 与 成绩趋势) ———
  const histAll = useMemo(() => {
    const ss = detail?.sessions ?? [];
    return ss
      .filter((s) => s.total && s.total > 0 && s.submittedAt)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((s) => clamp(Math.round(((s.correctCount ?? s.score ?? 0) / s.total!) * 100)));
  }, [detail]);
  const histExam = useMemo(() => {
    const ss = detail?.sessions ?? [];
    return ss
      .filter((s) => s.mode === "EXAM" && s.total && s.total > 0 && s.submittedAt)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((s) => clamp(Math.round(((s.correctCount ?? s.score ?? 0) / s.total!) * 100)));
  }, [detail]);
  const histPrac = useMemo(() => {
    const ss = detail?.sessions ?? [];
    return ss
      .filter((s) => s.mode === "PRACTICE" && s.total && s.total > 0 && s.submittedAt)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      .map((s) => clamp(Math.round(((s.correctCount ?? s.score ?? 0) / s.total!) * 100)));
  }, [detail]);

  // ——— L1 八 KPI(本人 vs 班级基准) ———
  const kpis = matrix
    ? (() => {
        const b = baseline;
        const d = (a: number | null, c: number | null) => (a == null || c == null ? null : Number((a - c).toFixed(1)));
        return [
          { label: "综合得分率", value: String(matrix.avgRate), unit: "%", delta: d(matrix.avgRate, b?.avgRate ?? null), higherBetter: true, sub: `近 ${matrix.sessionCount} 次作答加权`, spark: histAll, color: "#6C5CE7" },
          { label: "模考得分率", value: matrix.modeDivergence.examRate != null ? String(matrix.modeDivergence.examRate) : "—", unit: "%", delta: d(matrix.modeDivergence.examRate, b?.modeDivergence.examRate ?? null), higherBetter: true, sub: "模考口径", spark: histExam, color: "#6C5CE7" },
          { label: "练习得分率", value: matrix.modeDivergence.practiceRate != null ? String(matrix.modeDivergence.practiceRate) : "—", unit: "%", delta: d(matrix.modeDivergence.practiceRate, b?.modeDivergence.practiceRate ?? null), higherBetter: true, sub: "练习口径", spark: histPrac, color: "#F59E0B" },
          // ⚠️ 速度差值的基准选择：班级池化练习中位会混入 ESAT/MAT/NSAA 快刷题（实测全班 60s vs 本生 188.5s），
          // 跨题型相减会得到 +130s 这种既无单位又不可解释的大数。故速度卡片改为「中位耗时 − 考试基准」，
          // 同类（同为 TMUA 生）的归一化对比放在「维度排行」的速度维度里。
          { label: "解题速度中位", value: matrix.speed.practice.medianSec != null ? String(matrix.speed.practice.medianSec) : "—", unit: "s", delta: d(matrix.speed.practice.medianSec, matrix.speed.baselineSec ?? null), deltaUnit: "s", higherBetter: false, sub: `基准 ${matrix.speed.baselineSec ?? 120}s · 模考 ${matrix.speed.exam.medianSec != null ? Math.round(matrix.speed.exam.medianSec) + "s" : "—"}`, tip: `差值 = 练习中位耗时 − 考试基准（TMUA 180s/题、ESAT 80s/题，按作答量加权）：正 = 比基准慢，负 = 比基准快。全班池化练习中位 ${b?.speed.practice.medianSec != null ? Math.round(b.speed.practice.medianSec) : "—"}s 混入 ESAT/MAT 等快刷题，跨题型不可比，不参与该差值。`, spark: [], color: "#0EA5A4" },
          { label: "稳定性 CV", value: matrix.stability.cv != null ? String(matrix.stability.cv) : "—", unit: "", delta: d(matrix.stability.cv, b?.stability.cv ?? null), higherBetter: false, sub: `等级 ${matrix.stability.label === "stable" ? "稳定" : matrix.stability.label === "moderate" ? "中等" : matrix.stability.label === "volatile" ? "波动" : "样本不足"}`, spark: [], color: "#6C5CE7" },
          { label: "知识点覆盖", value: `${matrix.coverage.covered}/${matrix.coverage.total}`, unit: "", delta: d(matrix.coverage.rate, b?.coverage.rate ?? null), higherBetter: true, sub: `已覆盖 ${matrix.coverage.rate}%`, tip: `分母 = 该生作答涉及考试范围下的知识点总数（纯 TMUA 生 → 仅数学知识点）；分子 = 其中已作答到的个数。`, spark: [], color: "#16A34A" },
          { label: "粗心率", value: matrix.carelessness.slipRate != null ? String(matrix.carelessness.slipRate) : "—", unit: "%", delta: d(matrix.carelessness.slipRate, b?.carelessness.slipRate ?? null), higherBetter: false, sub: `高基题 ${matrix.carelessness.highBaseAttempts} · 失 ${matrix.carelessness.slipCount}`, tip: `仅粗心维度：在全班正确率 ≥ 75% 的「高基题」上仍答错的比例，考察非知识性失分。`, spark: [], color: "#F59E0B" },
          { label: "进步斜率", value: matrix.trend.slopePerSession != null ? `${matrix.trend.slopePerSession > 0 ? "+" : ""}${matrix.trend.slopePerSession}` : "—", unit: "/场", delta: d(matrix.trend.slopePerSession, b?.trend.slopePerSession ?? null), higherBetter: true, sub: `首 ${matrix.trend.firstRate ?? "—"}% → 末 ${matrix.trend.lastRate ?? "—"}%`, spark: [], color: "#16A34A" },
        ] as const;
      })()
    : [];

  // ——— L2 雷达(本人 vs 班级) + 维度排行 ———
  const norm = useMemo(() => {
    if (!matrix) return null;
    const b = baseline;
    const sDiff = matrix.difficulty.length
      ? Math.round(matrix.difficulty.reduce((a, x) => a + x.correctRate, 0) / matrix.difficulty.length)
      : 0;
    const cDiff = b && b.difficulty.length
      ? Math.round(b.difficulty.reduce((a, x) => a + x.correctRate, 0) / b.difficulty.length)
      : sDiff;
    // 速度分: 优先后端逐生归一化得分(speedScore); 班级均值 = 逐生得分均值(后端算好)。
    // ⚠️ 不能拿「全班池化练习中位」再 normSpeed —— 池化中位远低于考试基准会饱和 clamp 到 100(班级均值恒满分)。
    const sSpeed = matrix.speedScore ?? normSpeed(matrix.speed.practice.medianSec, matrix.speed.baselineSec);
    const cSpeed = b?.speedScore ?? normSpeed(b?.speed.practice.medianSec ?? null, b?.speed.baselineSec ?? null);
    const sTrend = trendScoreOf(matrix.trend.direction);
    const cTrend = trendScoreOf(b?.trend.direction ?? "flat");
    const sStab = stabScoreOf(matrix.stability.label);
    const cStab = stabScoreOf(b?.stability.label ?? "no-data");
    const sExam = examScoreOf(matrix.modeDivergence.delta);
    const cExam = examScoreOf(b?.modeDivergence.delta ?? null);
    const sCov = matrix.coverage.rate;
    const cCov = b?.coverage.rate ?? matrix.coverage.rate;
    const sCare = normCare(matrix.carelessness.slipRate);
    const cCare = normCare(b?.carelessness.slipRate ?? null);
    const dims = [
      { dim: "难度", s: sDiff, c: cDiff },
      { dim: "速度", s: sSpeed, c: cSpeed },
      { dim: "趋势", s: sTrend, c: cTrend },
      { dim: "稳定", s: sStab, c: cStab },
      { dim: "模考发挥", s: sExam, c: cExam },
      { dim: "覆盖", s: sCov, c: cCov },
      { dim: "细心", s: sCare, c: cCare },
    ];
    const radar = dims.map((x) => ({ dim: x.dim, 本人: Math.round(x.s), 班级: Math.round(x.c) }));
    const ranking = [...dims].sort((a, b) => b.s - a.s).map((x) => ({ dim: x.dim, v: Math.round(x.s), c: Math.round(x.c), delta: Math.round(x.s - x.c) }));
    return { radar, ranking };
  }, [matrix, baseline]);

  const chips = useMemo(() => {
    if (!norm) return { good: [] as string[], bad: [] as string[] };
    const sorted = [...norm.ranking].sort((a, b) => b.delta - a.delta);
    return {
      good: sorted.filter((x) => x.delta > 0).slice(0, 3).map((x) => `${x.dim} ${Math.round(x.v)}`),
      bad: sorted.filter((x) => x.delta < 0).slice(-3).reverse().map((x) => `${x.dim} ${Math.round(x.v)}`),
    };
  }, [norm]);

  // ——— L3 成绩趋势(模考得分率 + 线性趋势 · 按「卷子类型」分列) ———
  // 动机：TMUA P1 / P2、ESAT M1 / M2 / 物理 的题型结构不同，混成一条线会互相抵消趋势。
  const examSessionsAll = useMemo(() => {
    const ss = detail?.sessions ?? [];
    return ss
      .filter((s) => s.mode === "EXAM" && s.correctCount != null && s.total)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  }, [detail]);
  // 该生出现过的卷子类型（按场次降序），供筛选 chip 使用
  const trendKinds = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of examSessionsAll) {
      const k = paperKindOf(s.paper);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return Array.from(m.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([kind, count]) => ({ kind, count }));
  }, [examSessionsAll]);
  // 当前生效的类型：若选中的类型在本生数据里不存在（如切换到别的学生），自动回落「全部」，避免空白图
  const activeKind = trendKind !== "ALL" && trendKinds.some((k) => k.kind === trendKind) ? trendKind : "ALL";
  // 趋势图数据 + 序列定义：
  //  - 全部视图：每种考试类型一条彩色折线（按日期对齐，同日同类型多场取均值）；不画单一趋势虚线。
  //  - 单类型视图：一条「得分率」实线 + 一条「趋势」虚线（线性拟合），与原版一致。
  const trendChart = useMemo(() => {
    const rateOf = (s: (typeof examSessionsAll)[number]) =>
      clamp(Math.round(((s.correctCount ?? s.score ?? 0) / s.total!) * 100));
    if (activeKind === "ALL") {
      const byDay = new Map<string, Map<string, number[]>>();
      // 每个「日期标签」的最早时间戳，用于时间轴排序（⚠️ 字典序会让 "9/3" 排到 "9/18" 后面）
      const dayTs = new Map<string, number>();
      for (const s of examSessionsAll) {
        const k = paperKindOf(s.paper);
        const d = shortDate(s.startedAt);
        const ts = new Date(s.startedAt).getTime();
        if (!Number.isNaN(ts) && ts < (dayTs.get(d) ?? Infinity)) dayTs.set(d, ts);
        if (!byDay.has(d)) byDay.set(d, new Map());
        const col = byDay.get(d)!;
        if (!col.has(k)) col.set(k, []);
        col.get(k)!.push(rateOf(s));
      }
      const multi = Array.from(byDay.entries())
        .sort((a, b) => (dayTs.get(a[0]) ?? 0) - (dayTs.get(b[0]) ?? 0))
        .map(([d, col]) => {
          const row: Record<string, number | string | null> = { x: d };
          for (const k of trendKinds) {
            const arr = col.get(k.kind);
            row[k.kind] = arr ? Math.round(arr.reduce((p, c) => p + c, 0) / arr.length) : null;
          }
          return row;
        });
      const series = trendKinds.map((k, i) => ({ key: k.kind, color: TREND_COLORS[i % TREND_COLORS.length] }));
      return { data: multi, series, interval: "preserveStartEnd" as const };
    }
    const line: { x: string; 得分率: number }[] = examSessionsAll
      .filter((s) => paperKindOf(s.paper) === activeKind)
      .map((s) => ({ x: shortDate(s.startedAt), 得分率: rateOf(s) }));
    const rates = line.map((d) => d.得分率);
    let trend: (number | null)[] = rates.map(() => null);
    if (rates.length >= 2) {
      const xs = rates.map((_, i) => i);
      const mx = mean(xs)!, my = mean(rates)!;
      let num = 0, den = 0;
      for (let i = 0; i < rates.length; i++) { num += (xs[i] - mx) * (rates[i] - my); den += (xs[i] - mx) ** 2; }
      const slope = den ? num / den : 0;
      const intercept = my - slope * mx;
      trend = rates.map((_, i) => Math.round(intercept + slope * i));
    }
    const data = line.map((d, i) => ({ ...d, 趋势: trend[i] }));
    const series = [
      { key: "得分率", color: "#6C5CE7" },
      { key: "趋势", color: "#F59E0B", dash: true },
    ];
    return { data, series, interval: 0 as const };
  }, [examSessionsAll, trendKinds, activeKind]);

  // ——— L3 每次测验用时分布(用 session.durationSec 直方图) ———
  // 超时口径：按「试卷类型官方时长」判定 —— TMUA=75 / ESAT=40 / NSAA=30（分钟）。
  // 分箱随参考卷时长自适应（5 等分 + 末档「>卷面」）；红＝该区间含「超过本卷官方时长」的场次。
  const durBuckets = useMemo(() => {
    const OFFICIAL_LIMIT: Record<string, number> = { TMUA: 75, ESAT: 40, NSAA: 30 };
    const limOf = (st: string): number | null => OFFICIAL_LIMIT[st] ?? null;
    const sessions = (detail?.sessions ?? []).filter((s) => s.durationSec != null);

    // 参考卷：带官方时长的源类型中「场次最多」者（并列取时长更长者）；无则默认 TMUA 75。
    const freq = new Map<string, number>();
    let refSource = "";
    let refLimit = 75;
    let refCount = 0;
    for (const s of sessions) {
      const st = s.paper?.sourceType ?? "";
      const lim = limOf(st);
      if (lim == null) continue;
      const n = (freq.get(st) ?? 0) + 1;
      freq.set(st, n);
      if (n > refCount || (n === refCount && lim > refLimit)) { refSource = st; refLimit = lim; refCount = n; }
    }

    const step = refLimit / 5;
    const defs: { label: string; max: number; red: boolean }[] = [];
    for (let i = 0; i < 5; i++) {
      defs.push({
        label: i === 0 ? `<${step}` : `${step * i}–${step * (i + 1)}`,
        max: step * (i + 1) * 60,
        red: false,
      });
    }
    defs.push({ label: `>${refLimit}分`, max: Infinity, red: true });

    const counts = defs.map(() => 0);
    const binOver = defs.map(() => false);
    let overCount = 0;
    for (const s of sessions) {
      const lim = limOf(s.paper?.sourceType ?? "");
      const sec = s.durationSec as number;
      const over = lim != null && sec > lim * 60;
      if (over) overCount += 1;
      for (let i = 0; i < defs.length; i++) {
        if (sec < defs[i].max) {
          counts[i] += 1;
          if (over) binOver[i] = true;
          break;
        }
      }
    }
    const max = Math.max(1, ...counts);
    const buckets = defs.map((d, i) => ({
      label: d.label,
      red: d.red || binOver[i],
      count: counts[i],
      h: Math.round((counts[i] / max) * 120) + (counts[i] ? 4 : 0),
    }));
    return { buckets, refSource, refLimit, overCount, total: sessions.length };
  }, [detail]);

  // ✅ 以上所有 Hook 均已无条件调用完毕 —— 现在才允许提前 return。
  if (error) return <p className="text-sm text-red-600">{error}</p>;
  if (!detail) return <p className="text-sm text-slate-500">加载中...</p>;

  // ——— 派生数据(此处 detail 一定非空) ———

  // ——— L3 难度 × 正确率 矩阵(诚实:仅 5 档聚合,无逐次分列) ———
  const diffRows = matrix
    ? [1, 2, 3, 4, 5].map((dd) => matrix.difficulty.find((x) => x.difficulty === dd) || { difficulty: dd, attempts: 0, correctRate: 0 })
    : [];

  // ——— L3 知识点掌握热力网格 ———
  const uncoveredCount = Math.max(0, (totalTopicCount || 0) - detail.byTopic.length);

  // ——— L3 模考 vs 练习 明细 ———
  const mvp = matrix
    ? (() => {
        const examMed = matrix.speed.exam.medianSec;
        const pracMed = matrix.speed.practice.medianSec;
        const diffWeighted = matrix.difficulty.length
          ? Number((matrix.difficulty.reduce((a, x) => a + x.difficulty * x.attempts, 0) / matrix.difficulty.reduce((a, x) => a + x.attempts, 0)).toFixed(2))
          : null;
        return {
          examRate: matrix.modeDivergence.examRate,
          practiceRate: matrix.modeDivergence.practiceRate,
          deltaRate: matrix.modeDivergence.delta,
          examMed, pracMed,
          deltaMed: examMed != null && pracMed != null ? examMed - pracMed : null,
          cv: matrix.stability.cv,
          diffMean: diffWeighted,
          slipRate: matrix.carelessness.slipRate,
        };
      })()
    : null;

  const filtered = detail.sessions.filter((s) => modeF === "ALL" || s.mode === modeF);

  // ——— L3 错题归因派生量(口径B · 行为推断) ———
  // 知识性失分 = 深度不足 + 难题放弃(可回补的知识漏洞); 其余为技术性失误(未作答/粗心)
  const errProfile = matrix?.errorProfile ?? null;
  const errBuckets = (errProfile?.buckets ?? []).filter((b) => b.count > 0);
  const conceptCount = errBuckets
    .filter((b) => b.key === "concept" || b.key === "abandon")
    .reduce((n, b) => n + b.count, 0);
  const conceptRate = errProfile && errProfile.wrongTotal ? Math.round((conceptCount / errProfile.wrongTotal) * 100) : 0;

  return (
    <PageErrorBoundary>
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{detail.student.name}</h1>
          <p className="mt-0.5 text-sm text-slate-500">{detail.student.email}</p>
        </div>
        <span className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-1.5 text-[11px] text-amber-700">
          教师端 · 数据基于现有答卷实时聚合；速度按模考/练习双口径；仅教师可见
        </span>
      </div>

      {/* L0 控制条 */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5">
        <span className="rounded-md border border-slate-200 px-2.5 py-1 text-[11.5px] text-slate-600">学生 <b className="font-semibold text-slate-800">{detail.student.name}</b> ▾</span>
        <div className="inline-flex rounded-md bg-slate-100 p-0.5 text-[11.5px]">
          {([["近30天", "近30天"], ["本学期", "本学期"], ["全部", "全部"]] as const).map(([v], i) => (
            <span key={v} className={`rounded px-2.5 py-1 ${i === 2 ? "bg-white font-semibold text-slate-800 shadow-sm" : "text-slate-500"}`}>{v}</span>
          ))}
        </div>
        <div className="inline-flex rounded-md bg-slate-100 p-0.5 text-[11.5px]">
          {([["EXAM", "模考"], ["PRACTICE", "练习"], ["ALL", "合并"]] as const).map(([v, l], i) => (
            <button key={v} onClick={() => setModeF(v)} className={`rounded px-2.5 py-1 ${modeF === v ? "bg-white font-semibold text-slate-800 shadow-sm" : "text-slate-500"}`}>{l}</button>
          ))}
        </div>
        <span className="rounded-md border border-slate-200 px-2.5 py-1 text-[11.5px] text-slate-600">对比 <b className="font-semibold text-slate-800">班级均值</b> ▾</span>
        <span className="rounded-md border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-[11.5px] text-indigo-700">科目 数学 ▾</span>
        <span className="flex-1" />
        <button className="rounded-md border border-slate-200 bg-white px-3 py-1 text-[11.5px] text-slate-600">导出报告</button>
        <button className="rounded-md bg-indigo-600 px-3 py-1 text-[11.5px] font-semibold text-white">生成讲评</button>
      </div>

      {/* L1 概要带 */}
      <div>
        <p className="mb-2 text-[11px] font-bold tracking-[1.2px] text-slate-400">概 要</p>
        {/* ⚠️ 最多 4 列：外层 <main> 锁死在 max-w-5xl(≤992px)，8 列会让每格内容宽仅 ~91px 而挤爆卡片。
            内容宽 = min(视口, 992) − 32；4 列时每格 ≥120px，"188.5 s ▲8.5s" 可完整单行显示。 */}
        <div className="grid grid-cols-2 gap-2.5 md:grid-cols-4">
          {kpis.map((k) => (
            <Kpi key={k.label} {...k} />
          ))}
          {!matrix && <p className="col-span-full text-sm text-slate-400">高维矩阵加载中...</p>}
        </div>
      </div>

      {/* L2 维度诊断 */}
      <div>
        <p className="mb-2 text-[11px] font-bold tracking-[1.2px] text-slate-400">维度诊断</p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-2">
            <h3 className="text-[12.5px] font-semibold text-slate-700">能力雷达</h3>
            <p className="mb-2 text-[10.5px] text-slate-400">本人 vs 班级均值 · 归一化 0–100</p>
            <div className="mb-1 flex flex-wrap gap-3 text-[10.5px] text-slate-500">
              <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-indigo-600 align-middle" />本人</span>
              <span><span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-sm bg-slate-400 align-middle" />班级均值</span>
            </div>
            {norm && (
              <ChartErrorBoundary fallback={<div className="h-72 flex items-center justify-center text-[11px] text-slate-400">雷达图暂不可用</div>}>
                <RadarPanel data={norm.radar} />
              </ChartErrorBoundary>
            )}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {chips.good.map((c) => <span key={c} className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10.5px] text-emerald-700">强项 {c}</span>)}
              {chips.bad.map((c) => <span key={c} className="rounded-full bg-red-50 px-2 py-0.5 text-[10.5px] text-red-700">弱项 {c}</span>)}
            </div>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-3">
            <h3 className="text-[12.5px] font-semibold text-slate-700">维度排行</h3>
            <p className="mb-2 text-[10.5px] text-slate-400">横条＝本人；灰色刻度＝班级均值；右侧为相对班级差值</p>
            {norm && (
              <div className="space-y-1">
                {norm.ranking.map((r) => (
                  <div key={r.dim} className="grid grid-cols-[56px_1fr_54px] items-center gap-2.5 py-1">
                    <span className="text-[11.5px] text-slate-600">{r.dim}</span>
                    <div className="relative h-2.5 rounded bg-slate-100">
                      <div className="absolute inset-y-0 left-0 rounded bg-gradient-to-r from-indigo-400 to-indigo-600" style={{ width: `${clamp(r.v)}%` }} />
                      <div className="absolute -top-[3px] bottom-[-3px] w-0.5 rounded bg-slate-400" style={{ left: `${clamp(r.c)}%` }} />
                    </div>
                    <span className="text-right text-[12px] font-semibold tabular-nums text-slate-800">
                      {r.v}
                      <span className={`ml-1 text-[10px] font-semibold ${r.delta > 0 ? "text-emerald-600" : r.delta < 0 ? "text-red-500" : "text-slate-400"}`}>
                        {r.delta > 0 ? "+" : ""}{r.delta}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* L3 精细化分析(bento 12 列) */}
      <div>
        <p className="mb-2 text-[11px] font-bold tracking-[1.2px] text-slate-400">精细化分析</p>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          {/* 成绩趋势（可按卷子类型分列：TMUA P1 / P2、ESAT M1 / M2 / 物理 …） */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-6">
            <h3 className="text-[12.5px] font-semibold text-slate-700">成绩趋势</h3>
            <p className="mb-2 text-[10.5px] text-slate-400">
              {activeKind === "ALL" ? "每次模考得分率" : `${activeKind} 每次得分率`}（虚线＝线性趋势）
            </p>
            {trendKinds.length > 1 && (
              <div className="mb-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  onClick={() => setTrendKind("ALL")}
                  className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition ${activeKind === "ALL" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                >
                  全部 {examSessionsAll.length}次
                </button>
                {trendKinds.map((k) => (
                  <button
                    key={k.kind}
                    type="button"
                    onClick={() => setTrendKind(k.kind)}
                    className={`rounded-md px-1.5 py-0.5 text-[10.5px] font-medium transition ${activeKind === k.kind ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}
                  >
                    {k.kind} {k.count}次
                  </button>
                ))}
              </div>
            )}
            {trendChart.data.length > 0 ? (
              <ChartErrorBoundary fallback={<div className="h-52 flex items-center justify-center text-[11px] text-slate-400">趋势图暂不可用</div>}>
                <TrendPanel data={trendChart.data} series={trendChart.series} interval={trendChart.interval} />
              </ChartErrorBoundary>
            ) : <p className="text-sm text-slate-400">暂无模考成绩记录</p>}
          </div>

          {/* 难度 × 正确率 矩阵 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-6">
            <h3 className="text-[12.5px] font-semibold text-slate-700">难度 × 正确率 矩阵</h3>
            <p className="mb-2 text-[10.5px] text-slate-400">行＝难度档；色越红＝正确率越低（按 5 档聚合）</p>
            <div className="grid grid-cols-[60px_1fr_64px] gap-x-3 gap-y-1.5 text-[11px]">
              <div className="text-[10px] text-slate-400">难度档</div>
              <div className="text-[10px] text-slate-400 text-center">正确率</div>
              <div className="text-[10px] text-slate-400 text-right">题量</div>
              {diffRows.map((r) => (
                <FragmentRow key={r.difficulty} d={r.difficulty} rate={r.correctRate} attempts={r.attempts} />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-400">
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "#F6C6C6" }} />&lt;45%</span>
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "#FBE3B8" }} />45–60%</span>
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "#CDEBD3" }} />60–75%</span>
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "#9BDCB4" }} />75–90%</span>
              <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "#6BCB96" }} />&gt;90%</span>
            </div>
          </div>

          {/* 知识点掌握热力网格 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-7">
            <h3 className="text-[12.5px] font-semibold text-slate-700">知识点掌握热力网格</h3>
            <p className="mb-2 text-[10.5px] text-slate-400">
              {detail.byTopic.length} 个已覆盖 · 颜色＝正确率 · 灰＝未覆盖（共 {totalTopicCount || "?"} 个知识点）
            </p>
            {detail.byTopic.length > 0 ? (
              <>
                <div className="grid grid-cols-10 gap-1">
                  {detail.byTopic.map((t) => (
                    <div
                      key={t.topic}
                      title={`${t.topic} · 正确率 ${t.correctRate}% · 作答 ${t.attempts}`}
                      className="flex aspect-square items-center justify-center rounded text-[9.5px] tabular-nums"
                      style={{ background: heatColor(t.correctRate), color: "#1E2130" }}
                    >
                      {t.correctRate}
                    </div>
                  ))}
                  {Array.from({ length: uncoveredCount }).map((_, i) => (
                    <div key={`u${i}`} title="未覆盖" className="flex aspect-square items-center justify-center rounded bg-slate-100 text-[9.5px] text-slate-400">—</div>
                  ))}
                </div>
                <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-slate-400">
                  <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "#F6C6C6" }} />薄弱 &lt;45%</span>
                  <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "#FBE3B8" }} />待加强</span>
                  <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "#9BDCB4" }} />良好</span>
                  <span><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: "#EEF1F5" }} />未覆盖（{uncoveredCount}）</span>
                </div>
              </>
            ) : <p className="text-sm text-slate-400">暂无知识点作答记录</p>}
          </div>

          {/* 错题归因(口径B · 行为推断: 判据全部取自库内既有信号,未接入外部标签系统) */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-5">
            <h3 className="text-[12.5px] font-semibold text-slate-700">错题归因</h3>
            <p className="mb-2 text-[10.5px] text-slate-400">
              失分构成 · 共 {errProfile?.wrongTotal ?? 0} 次错答 · 判据＝题基率 / 单题耗时 / 知识点重复错
            </p>
            {errProfile && errProfile.wrongTotal > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center gap-4">
                  <Donut pct={conceptRate} color="#D85A30" />
                  <div className="text-[11px] text-slate-500">
                    <p>知识性失分占比 <b className="text-slate-800">{conceptRate}%</b></p>
                    <p>深度不足 + 难题放弃 <b className="text-slate-800">{conceptCount}</b> / {errProfile.wrongTotal} 次</p>
                    <p className="text-[10px] text-slate-400">其余为技术性失误（未作答 / 粗心）</p>
                  </div>
                </div>

                <div className="flex h-3 overflow-hidden rounded-full">
                  {errBuckets.map((b) => (
                    <div
                      key={b.key}
                      style={{ flex: `${b.count} 0 0`, background: b.color }}
                      title={`${b.label} ${b.count} 次 · ${b.rate}%`}
                    />
                  ))}
                </div>

                <div className="space-y-2">
                  {errBuckets.map((b) => (
                    <div key={b.key}>
                      <div className="flex items-center gap-2 text-[11px]">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: b.color }} />
                        <span className="text-slate-600">{b.label}</span>
                        <span className="text-slate-400">{b.count} 次</span>
                        <b className="ml-auto tabular-nums text-slate-800">{b.rate}%</b>
                        <span className="w-14 text-right text-[10px] text-slate-400">班 {baseline?.errorShare?.[b.key] ?? "—"}%</span>
                      </div>
                      {b.samples.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1.5 pl-4">
                          {b.samples.map((s) => (
                            <button
                              type="button"
                              key={s.questionId}
                              onClick={() => setDrill(s)}
                              title={[
                                s.topic,
                                s.sourceType,
                                s.mode === "EXAM" ? "模考" : s.mode === "PRACTICE" ? "练习" : null,
                                s.timeSpent != null ? `耗时 ${s.timeSpent}s` : null,
                                s.selected ? `所选 ${s.selected}` : "未作答",
                                "点击查看完整题目 / 解析",
                              ].filter(Boolean).join(" · ")}
                              className="max-w-full truncate rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-left text-[10px] text-slate-500 transition hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-600"
                            >
                              {s.topic}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <p className="text-sm text-slate-400">暂无错答记录</p>
            )}
          </div>

          {/* 每次测验用时分布 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-6">
            <h3 className="text-[12.5px] font-semibold text-slate-700">每次测验用时分布</h3>
            <p className="mb-2 text-[10.5px] text-slate-400">
              共 {durBuckets.total} 次有效测验 · 红＝超时（超过本卷官方时长：TMUA 75 / ESAT 40 / NSAA 30 分）
              {durBuckets.refSource ? ` · 本页参考卷 ${durBuckets.refSource} ${durBuckets.refLimit} 分` : ""}
              {durBuckets.overCount > 0 ? ` · 本页超时 ${durBuckets.overCount} 次` : ""}
            </p>
            <div className="flex h-[150px] items-end gap-3">
              {durBuckets.buckets.map((b) => (
                <div key={b.label} className="flex flex-1 flex-col items-center gap-1">
                  <span className="text-[10px] text-slate-500 tabular-nums">{b.count}</span>
                  <div
                    className="w-full rounded-t"
                    style={{ height: `${b.h}px`, background: b.red ? "#EF4444" : "#6C5CE7", opacity: 0.88 }}
                  />
                  <span className="text-[9.5px] text-slate-400">{b.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* 模考 vs 练习 明细 */}
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm lg:col-span-6">
            <h3 className="text-[12.5px] font-semibold text-slate-700">模考 vs 练习 明细</h3>
            <p className="mb-2 text-[10.5px] text-slate-400">逐维度双口径对比（得分率/中位耗时为真实双口径；稳定性/难度/高基题为整体口径）</p>
            {mvp && (
              <table className="w-full text-[11.5px]">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-[10.5px] font-semibold text-slate-400">
                    <th className="pb-1.5 font-normal">维度</th>
                    <th className="pb-1.5 text-right font-normal">模考</th>
                    <th className="pb-1.5 text-right font-normal">练习</th>
                    <th className="pb-1.5 text-right font-normal">Δ</th>
                  </tr>
                </thead>
                <tbody className="text-slate-600">
                  <MvpRow label="得分率" exam={`${mvp.examRate ?? "—"}%`} prac={`${mvp.practiceRate ?? "—"}%`} delta={mvp.deltaRate} higherBetter />
                  <MvpRow label="中位耗时" exam={mvp.examMed != null ? `${mvp.examMed}s` : "—"} prac={mvp.pracMed != null ? `${mvp.pracMed}s` : "—"} delta={mvp.deltaMed} lowerBetter unit="s" />
                  <MvpRow label="稳定性 CV" exam={mvp.cv != null ? String(mvp.cv) : "—"} prac={mvp.cv != null ? String(mvp.cv) : "—"} delta={null} />
                  <MvpRow label="难度均值" exam={mvp.diffMean != null ? String(mvp.diffMean) : "—"} prac={mvp.diffMean != null ? String(mvp.diffMean) : "—"} delta={null} />
                  <MvpRow label="高基题失误率" exam={mvp.slipRate != null ? `${mvp.slipRate}%` : "—"} prac={mvp.slipRate != null ? `${mvp.slipRate}%` : "—"} delta={null} />
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* 做题情况表(沿用真实接口,受 L0 模考/练习筛选控制)
          ⚠️ 布局不变量：本面板**默认折叠**(sessionsOpen 初值 false),点击标题行才展开;
          折叠态仍保留筛选按钮,且点击任一筛选会自动展开 —— 否则会出现「点了筛选没反应」的困惑。 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            onClick={() => setSessionsOpen((v) => !v)}
            aria-expanded={sessionsOpen}
            aria-controls="sessions-detail"
            title={sessionsOpen ? "点击折叠做题明细" : "点击展开做题明细"}
            className="flex items-center gap-1.5 rounded-md px-1 py-0.5 text-left transition hover:bg-slate-50"
          >
            <span className={`inline-block text-[9px] leading-none text-slate-400 transition-transform duration-150 ${sessionsOpen ? "rotate-90" : ""}`}>▶</span>
            <span className="text-[12.5px] font-semibold text-slate-700">做题情况（{detail.sessions.length}）</span>
            {!sessionsOpen && filtered.length > 0 && (
              <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{filtered.length} 条明细</span>
            )}
            <span className="text-[11px] text-slate-400">{sessionsOpen ? "收起" : "展开"}</span>
          </button>
          <div className="flex gap-1">
            {([["ALL", "合并"], ["EXAM", "模考"], ["PRACTICE", "练习"]] as const).map(([v, l]) => (
              <button key={v} onClick={() => { setModeF(v); setSessionsOpen(true); }} className={`rounded-md px-2 py-1 text-xs font-medium ${modeF === v ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>{l}</button>
            ))}
          </div>
        </div>
        <div id="sessions-detail" hidden={!sessionsOpen}>
        {detail.sessions.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">暂无做题记录</p>
        ) : filtered.length === 0 ? (
          <p className="mt-3 text-sm text-slate-400">该筛选下暂无记录</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[680px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-slate-400">
                  <th className="pb-2 font-normal">来源</th>
                  <th className="pb-2 font-normal">类型</th>
                  <th className="pb-2 font-normal">完成时间</th>
                  <th className="pb-2 font-normal">完成用时</th>
                  <th className="pb-2 font-normal">得分</th>
                  <th className="pb-2 font-normal">正确率</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s) => {
                  const isAssignment = !!s.assignmentId;
                  const src = s.paper?.title || (s.mode === "EXAM" ? "模拟考" : "练习");
                  return (
                    <tr key={s.id} className="border-b border-slate-50">
                      <td className="py-2.5">
                        <div className="font-medium text-slate-800">{src}</div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1">
                          {s.paper?.subject && <span className="rounded bg-slate-100 px-1 py-0.5 text-xs text-slate-500">{s.paper.subject}</span>}
                          {s.paper?.sourceType && <span className="rounded bg-teal-50 px-1 py-0.5 text-xs text-teal-700">{s.paper.sourceType}</span>}
                        </div>
                      </td>
                      <td className="py-2.5">
                        <span className={`rounded-md px-1.5 py-0.5 text-xs font-medium ${s.mode === "EXAM" ? "bg-indigo-50 text-indigo-700" : "bg-emerald-50 text-emerald-700"}`}>{s.mode === "EXAM" ? "模拟考" : "练习"}</span>
                        <span className={`ml-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${isAssignment ? "bg-amber-50 text-amber-700" : "bg-slate-50 text-slate-500"}`}>{isAssignment ? "作业" : "自主"}</span>
                      </td>
                      <td className="py-2.5 text-slate-500">{fmtTime(s.submittedAt, s.startedAt)}</td>
                      <td className="py-2.5 text-slate-500">{s.status === "DONE" ? fmtDur(s.durationSec) : "进行中"}</td>
                      <td className="py-2.5">{s.correctCount ?? s.score} / {s.total}</td>
                      <td className="py-2.5">{s.total ? Math.min(100, Math.round(((s.correctCount ?? s.score ?? 0) / s.total) * 100)) : 0}%</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        </div>
      </div>
    </div>
    {drill && <QuestionDrillDown sample={drill} onClose={() => setDrill(null)} />}
    </PageErrorBoundary>
  );
}

// 难度矩阵行
function FragmentRow({ d, rate, attempts }: { d: number; rate: number; attempts: number }) {
  return (
    <>
      <div className="flex items-center justify-center rounded bg-slate-50 text-[11px] text-slate-600">难度 {d}</div>
      <div className="rounded text-center text-[11px] tabular-nums text-slate-700" style={{ background: heatColor(rate), padding: "6px 0" }}>{attempts ? rate : "—"}</div>
      <div className="text-right text-[11px] tabular-nums text-slate-500">{attempts || "—"}</div>
    </>
  );
}

// 模考vs练习明细行
function MvpRow({ label, exam, prac, delta, higherBetter, lowerBetter, unit }: {
  label: string; exam: string; prac: string; delta: number | null; higherBetter?: boolean; lowerBetter?: boolean; unit?: string;
}) {
  const has = delta != null && !Number.isNaN(delta);
  const good = has ? (higherBetter ? delta! > 0 : lowerBetter ? delta! < 0 : false) : null;
  const cls = good == null ? "text-slate-400" : good ? "text-emerald-600" : "text-red-500";
  return (
    <tr className="border-b border-slate-50">
      <td className="py-1.5 text-slate-700">{label}</td>
      <td className="py-1.5 text-right tabular-nums">{exam}</td>
      <td className="py-1.5 text-right tabular-nums">{prac}</td>
      <td className={`py-1.5 text-right tabular-nums ${cls}`}>{has ? `${delta! > 0 ? "+" : ""}${unit ? delta!.toFixed(1) + unit : Math.round(delta!)}` : "—"}</td>
    </tr>
  );
}

// 错题归因「代表错题」下钻：点击 chip 弹出完整题干 / 选项 / 正确答案 / 解析
function QuestionDrillDown({ sample, onClose }: { sample: ErrSample; onClose: () => void }) {
  const opts = sample.options && sample.options.length ? sample.options : [];
  const letters = "ABCDEFGH";
  const meta = [
    sample.sourceType,
    sample.mode === "EXAM" ? "模考" : sample.mode === "PRACTICE" ? "练习" : null,
    sample.timeSpent != null ? `耗时 ${sample.timeSpent}s` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate text-sm font-semibold text-slate-800">{sample.topic}</h3>
            <p className="mt-0.5 text-[11px] text-slate-400">
              {meta}
              {" · "}
              {sample.selected ? `学生所选：${sample.selected}` : "未作答"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-md px-2 py-1 text-xs text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
          >
            关闭 ✕
          </button>
        </div>

        <div className="rounded-lg bg-slate-50 p-3 text-[13px] leading-relaxed text-slate-700">
          {sample.stem ? renderRich(sample.stem) : <span className="text-slate-400">（题干缺失）</span>}
        </div>

        {opts.length > 0 && (
          <div className="mt-3 space-y-1.5">
            {opts.map((opt, i) => {
              const isCorrect = sample.answer != null && opt === sample.answer;
              const isSel = sample.selected != null && opt === sample.selected;
              const cls = isCorrect
                ? "border-emerald-300 bg-emerald-50"
                : isSel
                ? "border-red-300 bg-red-50"
                : "border-slate-200 bg-white";
              return (
                <div key={i} className={`flex gap-2 rounded-md border px-2.5 py-1.5 text-[13px] ${cls}`}>
                  <span className="font-medium text-slate-500">{letters[i] ?? i + 1})</span>
                  <span className="flex-1 text-slate-700">{renderRich(opt)}</span>
                  {isCorrect && <span className="shrink-0 text-[11px] font-medium text-emerald-600">✓ 正确答案</span>}
                  {isSel && !isCorrect && <span className="shrink-0 text-[11px] font-medium text-red-500">✗ 学生所选</span>}
                  {isSel && isCorrect && <span className="shrink-0 text-[11px] font-medium text-emerald-600">✓ 学生答对</span>}
                </div>
              );
            })}
          </div>
        )}

        {sample.solution && (
          <div className="mt-4">
            <h4 className="mb-1 text-[12px] font-semibold text-slate-600">解析</h4>
            <div className="rounded-lg bg-amber-50 p-3 text-[13px] leading-relaxed text-slate-700">
              {renderRich(sample.solution)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// 粗心率环形图
function Donut({ pct, color = "#F59E0B" }: { pct: number; color?: string }) {
  const r = 26, c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    <svg width="64" height="64" viewBox="0 0 64 64">
      <circle cx="32" cy="32" r={r} fill="none" stroke="#F1F5F9" strokeWidth="8" />
      <circle cx="32" cy="32" r={r} fill="none" stroke={color} strokeWidth="8" strokeDasharray={c} strokeDashoffset={off} strokeLinecap="round" transform="rotate(-90 32 32)" />
      <text x="32" y="36" textAnchor="middle" fontSize="14" fontWeight="700" fill="#1E2130">{pct}%</text>
    </svg>
  );
}
