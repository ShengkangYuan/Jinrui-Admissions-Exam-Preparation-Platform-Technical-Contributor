"use client";
// 个人空间 - 学情分析·语言成长:全部以雅思 9 分(Band)标准呈现
// 真实 Band 用教师评分;无评分时按正确率估算(带 * 标记),写作/口语以教师评分 Band 为准
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LineChart, Line, BarChart, Bar, Cell, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from "recharts";

export type LangSession = {
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

export type LangAssignment = {
  id: string;
  title: string;
  note: string | null;
  mode: string;
  dueAt: string | null;
  status: string;
  submittedAt: string | null;
  isLanguage?: boolean;
  paper: {
    title: string; examType?: string | null; skill?: string | null; mode?: string; durationMin?: number | null;
  } | null;
};

const EXAM_LABEL: Record<string, string> = { IELTS: "雅思", TOEFL: "托福", KET_PET: "剑桥KET/PET", OTHER: "其他语言" };
const SKILL_LABEL: Record<string, string> = { LISTENING: "听力", READING: "阅读", WRITING: "写作", SPEAKING: "口语", FULL: "全真连考" };
const SKILL_ICON: Record<string, string> = { LISTENING: "🎧", READING: "📖", WRITING: "✍️", SPEAKING: "🗣️", FULL: "🎯" };
const SKILL_COLOR: Record<string, string> = {
  LISTENING: "#1f6fb2", READING: "#2e6f40", WRITING: "#b8860b", SPEAKING: "#7a3b8f", FULL: "#a14a3a",
};

type Milestone = { id: string; title: string; desc: string; date: string; icon: string; highlight: boolean };

// 正确率 → 雅思 Band(9 分制)估算
function estimateBand(correct: number | null | undefined, total: number | null | undefined): number | null {
  if (correct == null || !total || total <= 0) return null;
  const r = correct / total;
  if (r >= 0.9) return 9;
  if (r >= 0.85) return 8.5;
  if (r >= 0.8) return 8;
  if (r >= 0.75) return 7.5;
  if (r >= 0.7) return 7;
  if (r >= 0.65) return 6.5;
  if (r >= 0.6) return 6;
  if (r >= 0.55) return 5.5;
  if (r >= 0.5) return 5;
  if (r >= 0.45) return 4.5;
  if (r >= 0.4) return 4;
  return 3;
}

const bandColor = (b: number | null) => (b == null ? "#94a3b8" : b >= 7 ? "#059669" : b >= 5.5 ? "#d97706" : "#dc2626");

export default function LangGrowthPanel({
  sessions,
  assignments,
  onStart,
}: {
  sessions: LangSession[];
  assignments?: LangAssignment[];
  onStart?: (a: LangAssignment) => void;
}) {
  const router = useRouter();
  const [hlOpen, setHlOpen] = useState(true);

  // 已提交的语言练习/模考(有成绩),并给出有效 Band(真实评分优先,否则按正确率估算)
  const done = useMemo(
    () =>
      sessions
        .filter((s) => s.submittedAt)
        .map((s) => {
          // est 非空表示 Band 为按正确率估算(真实评分时置 null)
          const est = s.band != null ? null : estimateBand(s.correctCount, s.total);
          const band = s.band != null ? s.band : est;
          return { ...s, band, est };
        }),
    [sessions],
  );

  // 概览统计(全部以 Band 为准)
  const overview = useMemo(() => {
    let bandSum = 0, bandCount = 0, best = 0, mock = 0;
    for (const s of done) {
      if (s.band != null) { bandSum += s.band; bandCount += 1; best = Math.max(best, s.band); }
      if (s.mode === "EXAM") mock += 1;
    }
    return {
      count: done.length,
      avgBand: bandCount ? +(bandSum / bandCount).toFixed(1) : null,
      bestBand: best || null,
      mock,
    };
  }, [done]);

  // 成长图谱:全部会话的 Band 轨迹(最近 20 次,按时间正序)
  const bandTrend = useMemo(
    () =>
      done
        .slice()
        .reverse()
        .slice(-20)
        .reverse()
        .map((s, i) => ({
          name: `${i + 1}`,
          band: s.band,
          est: s.est != null,
          mode: s.mode === "EXAM" ? "模考" : "练习",
          skill: SKILL_LABEL[s.skill] || s.skill,
          title: s.paper?.title || `${EXAM_LABEL[s.examType] || s.examType || "语言"}·${SKILL_LABEL[s.skill] || s.skill || "练习"}`,
        })),
    [done],
  );

  // 各技能聚合(平均 Band)
  const bySkill = useMemo(() => {
    const map = new Map<string, { skill: string; sessions: number; bandSum: number; bandCount: number }>();
    for (const s of done) {
      if (s.band == null) continue;
      const cur = map.get(s.skill) || { skill: s.skill, sessions: 0, bandSum: 0, bandCount: 0 };
      cur.sessions += 1;
      cur.bandSum += s.band;
      cur.bandCount += 1;
      map.set(s.skill, cur);
    }
    return Array.from(map.values())
      .map((x) => ({
        skill: x.skill,
        label: SKILL_LABEL[x.skill] || x.skill,
        sessions: x.sessions,
        avgBand: x.bandCount ? +(x.bandSum / x.bandCount).toFixed(1) : null,
      }))
      .sort((a, b) => (b.avgBand ?? -1) - (a.avgBand ?? -1));
  }, [done]);

  // 听说读写(+全真连考)四板块学情分析(按 Band)
  const skillCards = useMemo(
    () =>
      ["LISTENING", "READING", "WRITING", "SPEAKING", "FULL"].map((skill) => {
        const list = done
          .filter((s) => s.skill === skill && s.band != null)
          .slice()
          .sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
        const stat = bySkill.find((b) => b.skill === skill);
        const trend = list.slice(-8).map((s) => s.band);
        const hasAny = done.some((s) => s.skill === skill);
        let advice: string;
        if (!hasAny) advice = "还没有练习记录,从一次练习开始积累。";
        else if (!stat || stat.avgBand == null) advice = "已有练习,等待教师评分后查看 Band。";
        else if (stat.avgBand >= 7) advice = `平均 ${stat.avgBand} Band,已进入高分区间,继续保持。`;
        else if (stat.avgBand >= 6) advice = `平均 ${stat.avgBand} Band,表现稳定,可冲刺 7 分段。`;
        else if (stat.avgBand >= 5) advice = `平均 ${stat.avgBand} Band,有进步空间,建议专项强化并复盘错题。`;
        else advice = `平均 ${stat.avgBand} Band,建议夯实基础,加强训练。`;
        return { skill, label: SKILL_LABEL[skill] || skill, icon: SKILL_ICON[skill] || "📘", stat, trend, advice };
      }),
    [done, bySkill],
  );

  // 成长教练:规则生成的鼓励 + 建议(按 Band)
  const coach = useMemo(() => {
    if (done.length === 0) return null;
    const avg = (arr: number[]) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const recent = done.slice().reverse().slice(0, 5).map((s) => s.band).filter((b): b is number => b != null);
    const earlier = done.slice().reverse().slice(5, 10).map((s) => s.band).filter((b): b is number => b != null);
    let encouragement: string;
    if (recent.length >= 3 && earlier.length >= 3 && avg(recent) > avg(earlier) + 0.5) {
      encouragement = `最近 ${recent.length} 次平均 ${avg(recent).toFixed(1)} Band,状态明显提升,保持这个节奏!`;
    } else if (overview.avgBand != null && overview.avgBand >= 7) {
      encouragement = `平均 ${overview.avgBand} 分(雅思标准)的表现很棒,已接近目标分数,继续打磨薄弱板块即可。`;
    } else {
      encouragement = `已累计 ${overview.count} 次语言练习,平均 ${overview.avgBand == null ? "—" : overview.avgBand + " Band"}。坚持练习、及时复盘错题,分数一定会稳步上升。`;
    }
    const suggestions: string[] = [];
    for (const s of bySkill) {
      if (s.avgBand != null && s.avgBand < 6) suggestions.push(`${s.label}平均 ${s.avgBand} Band,建议专项强化,并回看该板块错题。`);
    }
    for (const sk of ["LISTENING", "READING", "WRITING", "SPEAKING"]) {
      const x = bySkill.find((b) => b.skill === sk);
      if (!x) suggestions.push(`${SKILL_LABEL[sk]}还没有练习记录,建议开始第一次${SKILL_LABEL[sk]}练习。`);
      else if (x.sessions < 3) suggestions.push(`${x.label}只练习了 ${x.sessions} 次,建议增加频次形成习惯。`);
    }
    if (overview.avgBand != null && overview.avgBand < 6) suggestions.push("当前平均 Band 低于 6.0,建议以 6.0 为近期目标,按听说读写逐项突破。");
    const full = bySkill.find((b) => b.skill === "FULL");
    if (!full || full.sessions === 0) suggestions.push("建议定期参加全真连考模考,熟悉真实考试节奏。");
    if (suggestions.length > 4) suggestions.length = 4;
    return { encouragement, suggestions };
  }, [done, bySkill, overview]);

  // 成就 & 高光时刻:以 Band 里程碑为主
  const milestones = useMemo<Milestone[]>(() => {
    const sorted = done.slice().sort((a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime());
    const ms: Milestone[] = [];
    const reachedBand = new Set<number>();
    const skillFirst = new Set<string>();
    const skillQualified = new Set<string>();
    let bestBand: number | null = null;
    let examFirst = false;
    sorted.forEach((s, i) => {
      const date = s.startedAt;
      const skillLabel = SKILL_LABEL[s.skill] || s.skill || "语言";
      if (i === 0) ms.push({ id: "first", title: "首次语言练习", desc: `完成了第一次${skillLabel}练习,成长从这里开始。`, date, icon: "🎉", highlight: false });
      if (s.mode === "EXAM" && !examFirst) {
        examFirst = true;
        ms.push({ id: "exam1", title: "首次模拟考", desc: `第一次参加语言模拟考(${skillLabel})。`, date, icon: "📝", highlight: false });
      }
      if (!skillFirst.has(s.skill)) {
        skillFirst.add(s.skill);
        ms.push({ id: `sk_${s.skill}`, title: `开启${skillLabel}`, desc: `第一次进行${skillLabel}练习。`, date, icon: "📚", highlight: false });
      }
      if (s.band != null) {
        for (const t of [6, 6.5, 7, 7.5, 8]) {
          if (s.band >= t && !reachedBand.has(t)) {
            reachedBand.add(t);
            const est = s.est != null && s.band === s.est ? "（按正确率估算）" : "";
            ms.push({ id: `band${t}`, title: `Band ${t} 达成${est}`, desc: `估分达到 ${t},离目标更近一步。`, date, icon: "🏅", highlight: t >= 7 });
          }
        }
        if (bestBand != null && s.band > bestBand) {
          ms.push({ id: `up_${s.id}`, title: "Band 提升", desc: `Band 从 ${bestBand} 提升到 ${s.band}。`, date, icon: "📈", highlight: false });
        }
        bestBand = bestBand == null ? s.band : Math.max(bestBand, s.band);
      }
      if (s.band != null && s.band >= 6.5 && !skillQualified.has(s.skill)) {
        skillQualified.add(s.skill);
        ms.push({ id: `sq_${s.skill}`, title: `${skillLabel}达到 6.5 分`, desc: `${skillLabel}评分达到 ${s.band} Band。`, date, icon: "🎯", highlight: false });
      }
    });
    for (const c of [10, 20, 30, 50]) {
      if (sorted.length >= c) ms.push({ id: `n${c}`, title: `累计 ${c} 次语言练习`, desc: `已累计完成 ${c} 次语言练习。`, date: sorted[c - 1].startedAt, icon: "🏆", highlight: false });
    }
    return ms;
  }, [done]);
  const highlightMs = milestones.filter((m) => m.highlight);
  const otherMs = milestones.filter((m) => !m.highlight);

  // 动态记录(时间线,倒序,以 Band 呈现)
  const timeline = useMemo(
    () =>
      done
        .slice()
        .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime())
        .map((s) => ({
          ...s,
          examLabel: EXAM_LABEL[s.examType] || s.examType || "语言",
          skillLabel: SKILL_LABEL[s.skill] || s.skill || "练习",
        })),
    [done],
  );

  const pending = assignments?.filter((a) => a.status === "PENDING" || a.status === "IN_PROGRESS") || [];
  const past = assignments?.filter((a) => !pending.includes(a)) || [];

  const fmtTime = (s?: string | null) => {
    if (!s) return "";
    const d = new Date(s);
    return d.toLocaleString("zh-CN", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  };

  if (done.length === 0 && (!assignments || assignments.length === 0)) {
    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-10 text-center shadow-sm">
        <p className="text-4xl">🗣️</p>
        <p className="mt-3 text-sm font-medium text-slate-700">还没有语言学习记录</p>
        <p className="mt-1 text-xs text-slate-400">去做一次雅思/托福听力、阅读、写作或口语练习，这里就会记录你的语言成长（以雅思 Band 呈现）。</p>
        <button
          onClick={() => router.push("/app/language")}
          className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
        >
          去语言学习 →
        </button>
      </div>
    );
  }

  const overviewCards = [
    { label: "累计练习", value: `${overview.count}`, unit: "次", color: "text-indigo-600", bg: "bg-indigo-50" },
    { label: "平均 Band", value: overview.avgBand == null ? "—" : `${overview.avgBand}`, unit: "", color: "text-amber-600", bg: "bg-amber-50" },
    { label: "最高 Band", value: overview.bestBand == null ? "—" : `${overview.bestBand}`, unit: "", color: "text-emerald-600", bg: "bg-emerald-50" },
    { label: "模考次数", value: `${overview.mock}`, unit: "次", color: "text-rose-600", bg: "bg-rose-50" },
  ];

  return (
    <div className="space-y-6">
      {/* 概览卡 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {overviewCards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs text-slate-500">{c.label}</p>
            <p className={`mt-1 text-xl font-bold ${c.color}`}>
              {c.value}
              {c.unit && <span className="ml-0.5 text-xs font-medium text-slate-400">{c.unit}</span>}
            </p>
          </div>
        ))}
      </div>

      {/* 成长图谱 · Band 轨迹 */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-slate-700">成长图谱 · Band 轨迹</h2>
          <span className="text-xs text-slate-400">
            {done.length} 次练习 · 最高 {overview.bestBand == null ? "—" : `${overview.bestBand} Band`}
            <span className="ml-2 text-slate-300">* 为按正确率估算</span>
          </span>
        </div>
        <p className="mt-1 text-xs text-slate-400">每次语言练习/模考的雅思 Band 变化（最近 20 次，0–9 分制）</p>
        <div className="mt-3 h-56">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={bandTrend} margin={{ top: 8, right: 12, bottom: 0, left: -18 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 9]} tick={{ fontSize: 11 }} />
              <Tooltip
                formatter={(v: number) => [`${v} Band`, "Band"]}
                labelFormatter={(l, payload) => {
                  const p = payload?.[0]?.payload;
                  return p ? `${p.title} · ${p.skill} · ${p.mode}${p.est ? "（估算）" : ""}` : `第 ${l} 次`;
                }}
              />
              <Line type="monotone" dataKey="band" name="Band" stroke="#b8860b" strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} connectNulls />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* 听说读写四板块学情分析(按 Band) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">听说读写 · 板块学情分析（雅思 Band）</h2>
        <p className="mt-0.5 text-xs text-slate-400">按听力 / 阅读 / 写作 / 口语 / 全真连考 分别分析评分情况与建议</p>

        {/* 平均 Band 对比 */}
        {bySkill.length > 0 && (
          <div className="mt-3 h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={bySkill} margin={{ top: 8, right: 12, bottom: 0, left: -22 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis domain={[0, 9]} tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number) => [`${v} Band`, "平均 Band"]}
                  labelFormatter={(l) => `${l}`}
                />
                <Bar dataKey="avgBand" name="平均 Band" radius={[6, 6, 0, 0]}>
                  {bySkill.map((e) => (
                    <Cell key={e.skill} fill={SKILL_COLOR[e.skill] || "#94a3b8"} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* 四板块卡片 */}
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {skillCards.map((c) => (
            <div key={c.skill} className="rounded-xl border border-slate-100 bg-slate-50/60 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <span className="text-base">{c.icon}</span>
                  {c.label}
                </p>
                {c.stat && c.stat.sessions > 0 ? (
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">{c.stat.sessions} 次</span>
                ) : (
                  <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-medium text-slate-300 ring-1 ring-slate-100">未开始</span>
                )}
              </div>

              <div className="mt-2 flex items-baseline gap-3">
                <p className="text-lg font-bold" style={{ color: bandColor(c.stat?.avgBand ?? null) }}>
                  {c.stat && c.stat.avgBand != null ? `${c.stat.avgBand}` : "—"}
                  {c.stat && c.stat.avgBand != null && <span className="text-xs font-medium text-slate-400"> Band</span>}
                </p>
              </div>

              {/* 迷你 Band 趋势(最近 8 次,0-9) */}
              <div className="mt-2 flex h-10 items-end gap-1">
                {c.trend.length === 0 ? (
                  <span className="text-[11px] text-slate-300">暂无评分</span>
                ) : (
                  c.trend.map((b, i) => (
                    <div key={i} className="flex flex-1 flex-col items-center gap-0.5">
                      <span className="text-[9px] text-slate-400">{b == null ? "·" : b}</span>
                      <div
                        className={`w-full rounded-t ${b == null ? "bg-slate-100" : ""}`}
                        style={{ background: b == null ? undefined : bandColor(b), height: b == null ? 4 : Math.max(6, (b / 9) * 28) }}
                      />
                    </div>
                  ))
                )}
              </div>
              <p className="mt-2 text-xs leading-relaxed text-slate-500">{c.advice}</p>
            </div>
          ))}
        </div>
      </div>

      {/* 成长教练 */}
      {coach && (
        <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 to-white p-5 shadow-sm">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-indigo-700">💡 成长教练</h2>
          {coach.encouragement && <p className="mt-2 text-sm leading-relaxed text-slate-700">{coach.encouragement}</p>}
          {coach.suggestions.length > 0 && (
            <ul className="mt-3 space-y-2">
              {coach.suggestions.map((sg, i) => (
                <li key={i} className="flex items-start gap-2 rounded-xl bg-white/70 px-3 py-2 text-sm text-slate-700">
                  <span className="mt-0.5 shrink-0 font-bold text-indigo-500">✓</span>
                  <span>{sg}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* 成就 & 高光时刻 */}
      {milestones.length > 0 && (
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-sm font-semibold text-slate-700">成就 & 高光时刻 ({milestones.length})</h2>
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

      {/* 我的语言作业已移至个人空间「我的作业」tab(按试卷分区显示) */}

      {/* 动态记录(时间线,以 Band 呈现) */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-slate-700">学习动态记录</h2>
        <p className="mt-0.5 text-xs text-slate-400">按时间倒序，每一次语言练习 / 模考 / 评分都在这里留下成长足迹（* 为按正确率估算 Band）</p>
        <div className="mt-4 space-y-0">
          {timeline.map((s, idx) => (
            <div key={s.id} className="relative flex gap-3 pb-5 last:pb-0">
              {/* 时间轴 */}
              <div className="flex flex-col items-center">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-white" style={{ background: bandColor(s.band) }} />
                {idx < timeline.length - 1 && <span className="mt-1 w-px flex-1 bg-slate-200" />}
              </div>
              <div className="min-w-0 flex-1 rounded-xl border border-slate-100 bg-slate-50/60 p-3">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">{fmtTime(s.startedAt)}</span>
                  <span className="rounded-md px-1.5 py-0.5 text-[11px] font-medium text-white" style={{ background: SKILL_COLOR[s.skill] || "#666" }}>
                    {s.examLabel}·{s.skillLabel}
                  </span>
                  <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-500 ring-1 ring-slate-200">{s.mode === "EXAM" ? "模考" : "练习"}</span>
                  {s.band != null ? (
                    <span className={`rounded px-1.5 py-0.5 text-[11px] font-bold ${s.band >= 7 ? "bg-emerald-100 text-emerald-700" : s.band >= 5.5 ? "bg-amber-100 text-amber-700" : "bg-rose-100 text-rose-700"}`}>
                      {s.band} Band{s.est != null ? "*" : ""}
                    </span>
                  ) : (
                    <span className="rounded bg-white px-1.5 py-0.5 text-[11px] font-medium text-slate-400 ring-1 ring-slate-200">待评分</span>
                  )}
                </div>
                <p className="mt-1.5 truncate text-sm font-medium text-slate-700">{s.paper?.title || `${s.examLabel} · ${s.skillLabel}`}</p>
                {s.correctCount != null && s.total ? (
                  <p className="mt-0.5 text-xs text-slate-500">答对 <b className="text-slate-700">{s.correctCount}/{s.total}</b> 题</p>
                ) : (
                  <p className="mt-0.5 text-xs text-slate-400">写作/口语 · 教师评分</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
