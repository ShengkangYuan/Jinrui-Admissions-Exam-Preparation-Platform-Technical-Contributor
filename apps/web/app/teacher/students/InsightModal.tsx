"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import dynamic from "next/dynamic";
import type { TrendSeries } from "./[id]/TrendPanel";

// 学情概览弹窗:一张精简信息图卡片,涵盖学生绝大部分学情数据。
// 数据源:学生列表行(StudentRow)+ 高维学情矩阵(/teacher/stats/students-matrix)+ 每次模考序列(/teacher/students/:id/stats)。

// ⚠️ recharts 仅客户端可用:用 dynamic(ssr:false) 包裹,避免服务端渲染报错。
const TrendPanel = dynamic(() => import("./[id]/TrendPanel"), {
  ssr: false,
  loading: () => <div className="h-52" />,
});

interface MatrixSpeed {
  meanSec: number | null;
  medianSec: number | null;
  count: number;
}

export interface InsightRow {
  name: string;
  email: string;
  sessionCount: number;
  avgRate: number;
  lastSession: { score: number; total: number; mode: string; correctCount?: number } | null;
}

export interface InsightMatrix {
  difficulty: { difficulty: number; attempts: number; correctRate: number }[];
  speed: { exam: MatrixSpeed; practice: MatrixSpeed };
  trend: { slopePerSession: number | null; firstRate: number | null; lastRate: number | null; direction: string };
  stability: { cv: number | null; meanRate: number | null; label: string };
  modeDivergence: { examRate: number | null; practiceRate: number | null; delta: number | null };
  coverage: { covered: number; total: number; rate: number };
  carelessness: { highBaseAttempts: number; slipCount: number; slipRate: number | null };
}

// ——— 与详情页一致的卷子类型分类 + 配色(保证两处口径完全相同) ———
const TREND_COLORS = ["#6C5CE7", "#F59E0B", "#10B981", "#EF4444", "#3B82F6", "#8B5CF6", "#14B8A6", "#EC4899"];
function shortDate(s: string) {
  const d = new Date(s);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}
function clamp(v: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, v));
}
const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
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

interface TrendSession {
  id: string;
  mode: string;
  score: number | null;
  total: number | null;
  correctCount: number | null;
  startedAt: string;
  paper: { title: string | null; sourceType: string | null } | null;
}

function rateColor(p: number): string {
  return p >= 70 ? "bg-emerald-500" : p >= 40 ? "bg-amber-500" : "bg-red-500";
}
function rateText(p: number): string {
  return p >= 70 ? "text-emerald-600" : p >= 40 ? "text-amber-600" : "text-red-500";
}

function Tile({ label, value, valueClass, sub }: { label: string; value: React.ReactNode; valueClass?: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 p-3">
      <p className="text-[10px] text-slate-400">{label}</p>
      <p className={`mt-0.5 text-sm font-semibold ${valueClass || "text-slate-700"}`}>{value}</p>
      {sub && <p className="mt-0.5 text-[10px] text-slate-400">{sub}</p>}
    </div>
  );
}

export default function InsightModal({ studentId, row, m, onClose }: { studentId: string; row: InsightRow; m: InsightMatrix | undefined; onClose: () => void }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", h);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", h);
      document.body.style.overflow = prev;
    };
  }, [onClose]);

  // ——— 拉取该生每次模考序列(供分类折线趋势) ———
  const [sessions, setSessions] = useState<TrendSession[] | null>(null);
  const [trendKind, setTrendKind] = useState<string>("ALL");
  useEffect(() => {
    let alive = true;
    setSessions(null);
    api
      .get<{ sessions: TrendSession[] }>(`/teacher/students/${studentId}/stats`)
      .then((d) => {
        if (alive) setSessions(d.sessions || []);
      })
      .catch(() => {
        if (alive) setSessions([]);
      });
    return () => {
      alive = false;
    };
  }, [studentId]);

  const trend = m?.trend;
  const trendArrow = trend?.direction === "up" ? "↑" : trend?.direction === "down" ? "↓" : "→";
  const trendColor = trend?.direction === "up" ? "text-emerald-600" : trend?.direction === "down" ? "text-red-500" : "text-slate-400";
  const stab = m?.stability;
  const stabLabel = stab ? (stab.label === "stable" ? "稳定" : stab.label === "moderate" ? "中等" : stab.label === "no-data" ? "样本不足" : "波动") : "—";
  const stabClass = stab?.label === "stable" ? "text-emerald-600" : stab?.label === "moderate" ? "text-amber-600" : stab?.label === "no-data" ? "text-slate-400" : "text-red-500";
  const div = m?.modeDivergence;
  const slip = m?.carelessness;

  // ——— 分类折线趋势(与详情页同口径:仅 EXAM 会话,按卷子类型分色) ———
  const examSessions = useMemo(
    () =>
      (sessions ?? [])
        .filter((s) => s.mode === "EXAM" && s.correctCount != null && s.total)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt)),
    [sessions]
  );
  const trendKinds = useMemo(() => {
    const map = new Map<string, number>();
    for (const s of examSessions) {
      const k = paperKindOf(s.paper);
      map.set(k, (map.get(k) || 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([kind, count]) => ({ kind, count }));
  }, [examSessions]);
  const activeKind = trendKind !== "ALL" && trendKinds.some((k) => k.kind === trendKind) ? trendKind : "ALL";
  const trendChart = useMemo(() => {
    const rateOf = (s: TrendSession) => clamp(Math.round(((s.correctCount ?? s.score ?? 0) / (s.total || 1)) * 100));
    if (activeKind === "ALL") {
      const byDay = new Map<string, Map<string, number[]>>();
      // 每个「日期标签」的最早时间戳，用于时间轴排序（⚠️ 字典序会让 "9/3" 排到 "9/18" 后面）
      const dayTs = new Map<string, number>();
      for (const s of examSessions) {
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
      const series: TrendSeries[] = trendKinds.map((k, i) => ({ key: k.kind, color: TREND_COLORS[i % TREND_COLORS.length] }));
      return { data: multi, series, interval: "preserveStartEnd" as const, multi: true };
    }
    const line = examSessions
      .filter((s) => paperKindOf(s.paper) === activeKind)
      .map((s) => ({ x: shortDate(s.startedAt), 得分率: rateOf(s) }));
    const rates = line.map((d) => d.得分率);
    let tr: (number | null)[] = rates.map(() => null);
    if (rates.length >= 2) {
      const xs = rates.map((_, i) => i);
      const mx = mean(xs)!, my = mean(rates)!;
      let num = 0, den = 0;
      for (let i = 0; i < rates.length; i++) { num += (xs[i] - mx) * (rates[i] - my); den += (xs[i] - mx) ** 2; }
      const slope = den ? num / den : 0;
      const intercept = my - slope * mx;
      tr = rates.map((_, i) => Math.round(intercept + slope * i));
    }
    const data = line.map((d, i) => ({ ...d, 趋势: tr[i] }));
    const series: TrendSeries[] = [
      { key: "得分率", color: "#6C5CE7" },
      { key: "趋势", color: "#F59E0B", dash: true },
    ];
    return { data, series, interval: 0 as const, multi: false };
  }, [examSessions, trendKinds, activeKind]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-sm overflow-y-auto overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="学情概览"
      >
        {/* 头部:渐变信息条 */}
        <div className="relative bg-gradient-to-br from-indigo-600 via-indigo-500 to-violet-500 px-5 py-4 text-white">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 flex h-7 w-7 items-center justify-center rounded-full bg-white/20 text-sm leading-none text-white hover:bg-white/30"
            aria-label="关闭"
          >
            ✕
          </button>
          <p className="text-base font-bold">{row.name}</p>
          <p className="mt-0.5 truncate text-[10px] text-indigo-100">{row.email}</p>
          <div className="mt-3 flex items-end justify-between">
            <div>
              <p className="text-3xl font-bold leading-none">
                {row.avgRate}
                <span className="text-base font-medium">%</span>
              </p>
              <p className="mt-1 text-[10px] text-indigo-100">平均正确率</p>
            </div>
            <div className="text-right text-[10px] leading-relaxed text-indigo-100">
              <p>刷题 {row.sessionCount} 场</p>
              <p>
                最近:{row.lastSession ? `${row.lastSession.score ?? row.lastSession.correctCount}/${row.lastSession.total}(${row.lastSession.mode === "EXAM" ? "模考" : "练习"})` : "—"}
              </p>
            </div>
          </div>
        </div>

        {!m ? (
          <div className="px-5 py-10 text-center text-sm text-slate-400">暂无学情数据,学生开始刷题后生成。</div>
        ) : (
          <div className="space-y-3 px-4 py-4">
            {/* 难度解决力:五档正确率柱状 */}
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-slate-400">难度解决力(各难度正确率)</p>
                <p className="text-[9px] text-slate-300">柱下为作答题数</p>
              </div>
              <div className="mt-2 flex items-end gap-2">
                {Array.from({ length: 5 }, (_, i) => {
                  const d = m.difficulty.find((x) => x.difficulty === i + 1);
                  const rate = d ? d.correctRate : 0;
                  const has = !!d;
                  return (
                    <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
                      <span className={`text-[10px] font-semibold ${has ? rateText(rate) : "text-slate-300"}`}>{has ? `${rate}%` : "—"}</span>
                      <div className="flex h-16 w-full items-end overflow-hidden rounded-t-md bg-white/70">
                        <div className={`w-full rounded-t-md ${has ? rateColor(rate) : "bg-slate-100"}`} style={{ height: `${Math.max(has ? rate : 0, has ? 4 : 2)}%` }} />
                      </div>
                      <span className="text-[10px] text-slate-400">D{i + 1}</span>
                      <span className="text-[9px] text-slate-300">{has ? `${d!.attempts}题` : "无样本"}</span>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 成绩趋势:每次模考分类折线(不同考试类型不同颜色) */}
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="flex items-center justify-between">
                <p className="text-[10px] text-slate-400">成绩趋势(每次模考·按类型分色)</p>
                <p className="text-[9px] text-slate-300">{examSessions.length} 场模考</p>
              </div>
              {sessions === null ? (
                <p className="mt-3 text-center text-[10px] text-slate-400">加载中…</p>
              ) : examSessions.length >= 2 ? (
                <>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <button
                      onClick={() => setTrendKind("ALL")}
                      className={`rounded-full px-2 py-0.5 text-[10px] ${activeKind === "ALL" ? "bg-indigo-600 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}
                    >
                      全部 {examSessions.length}次
                    </button>
                    {trendKinds.map((k, i) => (
                      <button
                        key={k.kind}
                        onClick={() => setTrendKind(k.kind)}
                        className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] ${activeKind === k.kind ? "bg-indigo-600 text-white" : "bg-white text-slate-500 ring-1 ring-slate-200"}`}
                      >
                        <span className="inline-block h-2 w-2 rounded-full" style={{ background: TREND_COLORS[i % TREND_COLORS.length] }} />
                        {k.kind} {k.count}次
                      </button>
                    ))}
                  </div>
                  <div className="mt-1">
                    <TrendPanel data={trendChart.data} series={trendChart.series} interval={trendChart.interval} />
                  </div>
                </>
              ) : (
                <p className="mt-3 text-[10px] text-slate-400">模考场次不足 2 场,暂无法绘制趋势。</p>
              )}
            </div>

            {/* 六维指标瓦片 */}
            <div className="grid grid-cols-2 gap-2">
              <Tile
                label="解题速度(中位)"
                value={
                  <>
                    模考 {m.speed.exam.medianSec != null ? `${Math.round(m.speed.exam.medianSec)}s` : "—"}
                    <span className="mx-1 text-slate-300">·</span>
                    练习 {m.speed.practice.medianSec != null ? `${Math.round(m.speed.practice.medianSec)}s` : "—"}
                  </>
                }
              />
              <Tile
                label="进步趋势"
                value={
                  <span className={trendColor}>
                    {trendArrow} {trend?.slopePerSession != null ? trend.slopePerSession : "—"}
                    <span className="ml-1 text-[10px] font-normal text-slate-400">百分点/场</span>
                  </span>
                }
                sub={trend?.firstRate != null && trend?.lastRate != null ? `${trend.firstRate}% → ${trend.lastRate}%` : undefined}
              />
              <Tile label="稳定性" value={stabLabel} valueClass={stabClass} sub={stab?.cv != null ? `CV ${stab.cv}% · 均值 ${stab.meanRate ?? "—"}%` : undefined} />
              <Tile
                label="模考分化(模考−练习)"
                value={div?.delta == null ? "—" : `Δ ${div.delta > 0 ? "+" : ""}${div.delta}`}
                valueClass={div?.delta == null ? "text-slate-400" : div.delta > 0 ? "text-emerald-600" : div.delta < 0 ? "text-red-500" : "text-slate-400"}
                sub={div?.examRate != null || div?.practiceRate != null ? `模考 ${div?.examRate ?? "—"}% · 练习 ${div?.practiceRate ?? "—"}%` : undefined}
              />
              <Tile
                label="知识点覆盖"
                value={
                  <span>
                    {m.coverage.covered}
                    <span className="text-slate-400">/{m.coverage.total}</span>
                  </span>
                }
                sub={`覆盖率 ${m.coverage.rate}%`}
              />
              <Tile
                label="粗心失误"
                value={slip?.slipRate == null ? "样本不足" : `${slip.slipRate}%`}
                valueClass={slip?.slipRate == null ? "text-slate-400" : slip.slipRate === 0 ? "text-emerald-600" : slip.slipRate < 20 ? "text-amber-600" : "text-red-500"}
                sub={slip?.slipRate != null ? `高基题 ${slip.highBaseAttempts} 题 · 失误 ${slip.slipCount} 次` : undefined}
              />
            </div>
          </div>
        )}

        {/* 底部注脚 */}
        <div className="bg-slate-50 px-4 py-2 text-center text-[10px] text-slate-400">
          教师端学情概览 · {new Date().toLocaleDateString("zh-CN")} 生成 · 点「查看」进入完整学情报告
        </div>
      </div>
    </div>
  );
}
