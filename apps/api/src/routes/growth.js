import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth } from "../middleware/auth.js";

const router = Router();

const DAY = 86400000;

function fmtDate(t) {
  const d = new Date(t);
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`;
}

// 计算最大连续打卡天数(基于作答/提交日期)
function maxStreakDays(times) {
  const days = [...new Set(times.map((t) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }))].sort();
  if (days.length === 0) return 0;
  let best = 1, cur = 1;
  for (let i = 1; i < days.length; i++) {
    const prev = new Date(days[i - 1]).getTime();
    const now = new Date(days[i]).getTime();
    if (now - prev === DAY) cur += 1;
    else if (now - prev > DAY) cur = 1;
    if (cur > best) best = cur;
  }
  return best;
}

const SUBJECT_COLORS = ["#6366f1", "#10b981", "#f59e0b", "#ef4444", "#0ea5e9", "#a855f7"];

// GET /api/me/growth — 成长图谱:阶段性表现变化 + 成就/高光节点 + 鼓励与建议
router.get(
  "/growth",
  requireAuth,
  asyncHandler(async (req, res) => {
    const sid = req.user.id;
    const now = Date.now();

    const [records, sessions, runs, wrongs, submits] = await Promise.all([
      prisma.answerRecord.findMany({
        where: { session: { studentId: sid }, isCorrect: { not: null } },
        include: {
          question: { select: { subject: true, topic: true, difficulty: true } },
          session: { select: { mode: true, startedAt: true, submittedAt: true } },
        },
        orderBy: { createdAt: "asc" },
      }),
      prisma.session.findMany({
        where: { studentId: sid, submittedAt: { not: null } },
        select: { id: true, mode: true, score: true, total: true, correctCount: true, startedAt: true, submittedAt: true },
        orderBy: { submittedAt: "asc" },
      }),
      prisma.roguelikeRun.findMany({
        where: { studentId: sid },
        select: { status: true, maxCombo: true, layer: true, createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
      prisma.wrongBook.findMany({
        where: { studentId: sid },
        select: { mastered: true, createdAt: true, updatedAt: true },
      }),
      prisma.assignmentStudent.findMany({
        where: { studentId: sid, status: "SUBMITTED" },
        select: { submittedAt: true, createdAt: true },
        orderBy: { submittedAt: "asc" },
      }),
    ]);

    const recTimes = records.map((r) => new Date(r.createdAt).getTime()).filter((t) => !isNaN(t));
    if (recTimes.length === 0) {
      return ok(res, {
        points: [],
        milestones: [],
        coach: { encouragement: "你还没有作答记录,先做几道题,系统就会为你生成专属的成长图谱。", suggestions: ["从一道简单的题开始,迈出成长第一步。"] },
        summary: { hasData: false },
      });
    }

    const firstT = Math.min(...recTimes);
    const spanDays = (now - firstT) / DAY;
    const byWeek = spanDays <= 84;

    // ---- 时间分桶 ----
    const buckets = [];
    if (byWeek) {
      const start = new Date(firstT);
      start.setHours(0, 0, 0, 0);
      const dow = (start.getDay() + 6) % 7; // 周一=0
      start.setDate(start.getDate() - dow);
      let cur = start.getTime();
      while (cur <= now) {
        const end = cur + 7 * DAY;
        buckets.push({ start: cur, end, label: `${new Date(cur).getMonth() + 1}/${new Date(cur).getDate()}` });
        cur = end;
      }
    } else {
      const start = new Date(firstT);
      start.setDate(1); start.setHours(0, 0, 0, 0);
      let y = start.getFullYear(), m = start.getMonth();
      while (new Date(y, m, 1).getTime() <= now) {
        const s = new Date(y, m, 1).getTime();
        const e = new Date(y, m + 1, 1).getTime();
        buckets.push({ start: s, end: e, label: `${y}年${m + 1}月` });
        m += 1; if (m > 11) { m = 0; y += 1; }
      }
    }

    const SUBJECTS = [...new Set(records.map((r) => r.question.subject || "其他"))];
    const bucketIndex = (t) => {
      for (let i = 0; i < buckets.length; i++) if (t < buckets[i].end) return i;
      return buckets.length - 1;
    };

    // ---- 累计聚合(用于折线图) ----
    const agg = buckets.map(() => ({
      attempts: 0, correct: 0,
      bySubj: Object.fromEntries(SUBJECTS.map((s) => [s, { attempts: 0, correct: 0 }])),
    }));
    for (const r of records) {
      const bi = bucketIndex(new Date(r.createdAt).getTime());
      const correct = r.isCorrect ? 1 : 0;
      for (let i = bi; i < agg.length; i++) {
        agg[i].attempts += 1;
        agg[i].correct += correct;
        const s = r.question.subject || "其他";
        agg[i].bySubj[s].attempts += 1;
        agg[i].bySubj[s].correct += correct;
      }
    }
    const points = buckets.map((b, i) => {
      const a = agg[i];
      const subjects = {};
      SUBJECTS.forEach((s) => {
        const x = a.bySubj[s];
        subjects[s] = x.attempts ? Math.round((x.correct / x.attempts) * 100) : null;
      });
      return {
        period: b.label,
        label: b.label,
        overallRate: a.attempts ? Math.round((a.correct / a.attempts) * 100) : 0,
        subjects,
        attempts: a.attempts,
      };
    });

    // ---- 最终聚合(用于教练建议) ----
    const finalByTopic = new Map();
    const finalBySubject = new Map();
    const finalByMode = new Map();
    const finalByDifficulty = new Map();
    let totalA = 0, totalC = 0;
    for (const r of records) {
      const correct = r.isCorrect ? 1 : 0;
      totalA += 1; totalC += correct;
      const topic = r.question.topic || "未分类";
      let t = finalByTopic.get(topic) || { topic, attempts: 0, correct: 0 };
      t.attempts += 1; t.correct += correct; finalByTopic.set(topic, t);
      const subject = r.question.subject || "其他";
      let s = finalBySubject.get(subject) || { subject, attempts: 0, correct: 0 };
      s.attempts += 1; s.correct += correct; finalBySubject.set(subject, s);
      const mode = r.session?.mode || "PRACTICE";
      let mo = finalByMode.get(mode) || { mode, attempts: 0, correct: 0 };
      mo.attempts += 1; mo.correct += correct; finalByMode.set(mode, mo);
      const diff = r.question.difficulty ?? 3;
      let d = finalByDifficulty.get(diff) || { difficulty: diff, attempts: 0, correct: 0 };
      d.attempts += 1; d.correct += correct; finalByDifficulty.set(diff, d);
    }
    const rate = (o) => (o.attempts ? Math.round((o.correct / o.attempts) * 100) : 0);
    const fbTopic = [...finalByTopic.values()].map((o) => ({ ...o, correctRate: rate(o) }));
    const fbSubject = [...finalBySubject.values()].map((o) => ({ ...o, correctRate: rate(o) }));
    const fbMode = [...finalByMode.values()].map((o) => ({ ...o, correctRate: rate(o) }));
    const fbDifficulty = [...finalByDifficulty.values()].map((o) => ({ ...o, correctRate: rate(o) }));

    // ---- 连续打卡 ----
    const streakTimes = [...recTimes, ...sessions.filter((s) => s.submittedAt).map((s) => new Date(s.submittedAt).getTime())];
    const maxStreak = maxStreakDays(streakTimes);

    // ---- 成就 / 高光节点 ----
    const milestones = [];
    const pushM = (date, type, icon, title, desc, highlight = false) => {
      if (date == null) return;
      const ts = new Date(date).getTime();
      if (isNaN(ts)) return;
      milestones.push({ id: `${type}_${ts}`, date: new Date(ts).toISOString(), type, icon, title, desc, highlight });
    };

    // 学习启程
    pushM(firstT, "start", "🌱", "学习启程", `你于 ${fmtDate(firstT)} 答出了第一道题,成长之路由此开始。`);

    // 首战模考 / 满分一战
    for (const s of sessions) {
      if (s.mode === "EXAM" && s.submittedAt) {
        pushM(s.submittedAt, "exam", "📝", "首战模考", `完成了第一次限时模考,正式演练考试节奏。`);
        break;
      }
    }
    for (const s of sessions) {
      if (s.total && s.total >= 5 && s.correctCount === s.total && s.submittedAt) {
        pushM(s.submittedAt, "perfect", "💯", "满分一战", `在${s.mode === "EXAM" ? "模考" : "练习"}中拿下满分,${s.total} 题全对,状态拉满!`, true);
        break;
      }
    }

    // 正确率里程碑(精确日期:扫描累计正确率)
    let cumA = 0, cumC = 0;
    const thrDates = {};
    for (const r of records) {
      cumA += 1; if (r.isCorrect) cumC += 1;
      const r2 = Math.round((cumC / cumA) * 100);
      for (const thr of [60, 70, 80, 90]) {
        if (!thrDates[thr] && r2 >= thr && cumA >= 5) thrDates[thr] = new Date(r.createdAt).getTime();
      }
    }
    const thrMeta = {
      60: ["正确率突破 60%", "稳步起步,正确率站上 60% 的及格线!"],
      70: ["正确率突破 70%", "正确率突破 70%,基础越来越扎实。"],
      80: ["正确率突破 80%", "正确率突破 80%,你已经进入第一梯队!"],
      90: ["正确率突破 90%", "正确率突破 90%,近乎完美,这就是高手的样子!", true],
    };
    for (const thr of [60, 70, 80, 90]) {
      if (thrDates[thr]) {
        const [t, d, hl] = thrMeta[thr];
        pushM(thrDates[thr], `rate${thr}`, "📈", t, d, !!hl);
      }
    }

    // 学科突破(累计正确率首次 >=80 且 attempts>=8)
    for (const subject of SUBJECTS) {
      let a = 0, c = 0, hit = null;
      for (const r of records) {
        if ((r.question.subject || "其他") !== subject) continue;
        a += 1; if (r.isCorrect) c += 1;
        if (a >= 8 && Math.round((c / a) * 100) >= 80 && !hit) hit = new Date(r.createdAt).getTime();
      }
      if (hit) pushM(hit, `subj_${subject}`, "🎯", `「${subject}」稳步突破`, `${subject} 累计正确率突破 80%,成为你的强势科目。`);
    }

    // 知识点逆袭(早期 <50 → 近 30 天 >=75)
    const topicRecs = new Map();
    for (const r of records) {
      const tp = r.question.topic || "未分类";
      if (!topicRecs.has(tp)) topicRecs.set(tp, []);
      topicRecs.get(tp).push(r);
    }
    let comebackCount = 0;
    for (const [tp, list] of topicRecs) {
      if (comebackCount >= 2) break;
      if (list.length < 6) continue;
      const mid = Math.floor(list.length / 2);
      const early = list.slice(0, mid);
      const earlyRate = Math.round((early.filter((x) => x.isCorrect).length / early.length) * 100);
      const recent = list.filter((x) => new Date(x.createdAt).getTime() >= now - 30 * DAY);
      if (recent.length < 3) continue;
      const recentRate = Math.round((recent.filter((x) => x.isCorrect).length / recent.length) * 100);
      if (earlyRate < 50 && recentRate >= 75) {
        pushM(recent[recent.length - 1].createdAt, `comeback_${tp}`, "🔥", `逆袭 · ${tp}`, `「${tp}」从早期 ${earlyRate}% 提升到近期 ${recentRate}%,越挫越勇!`, true);
        comebackCount += 1;
      }
    }

    // 冒险模式
    for (const r of runs) {
      if (r.status === "WON") { pushM(r.createdAt, "rogue_win", "🏆", "冒险通关", "在冒险模式中成功通关,把知识化作了实战!", true); break; }
    }
    let bestCombo = 0, bestComboDate = null;
    for (const r of runs) {
      if (r.maxCombo > bestCombo) { bestCombo = r.maxCombo; bestComboDate = r.createdAt; }
    }
    if (bestCombo >= 10) pushM(bestComboDate, "rogue_combo", "⚡", "连击大师", `冒险模式最高连击 ${bestCombo} 次,手感火热!`);

    // 错题攻克
    const firstMastered = wrongs.filter((w) => w.mastered).sort((a, b) => new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime())[0];
    if (firstMastered) pushM(firstMastered.updatedAt || firstMastered.createdAt, "master", "✅", "攻克首道错题", "把一道曾经做错的题彻底拿下,错题本开始变薄。");

    // 连续打卡
    if (maxStreak >= 3) pushM(now, "streak", "🔥", `连续打卡 ${maxStreak} 天`, "稳定的节奏是进步的关键,为你骄傲!");

    // 按时交作业
    if (submits.length > 0 && submits[0].submittedAt) {
      pushM(submits[0].submittedAt, "submit", "🎯", "按时交作业", "按时提交首份作业,养成了靠谱的学习习惯。");
    }

    milestones.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    const MAX_MS = 16;
    const shown = milestones.length > MAX_MS ? milestones.slice(milestones.length - MAX_MS) : milestones;

    // ---- 教练:鼓励 + 建议 ----
    const overall = points[points.length - 1]?.overallRate ?? 0;
    const startRate = points[0]?.overallRate ?? overall;
    const delta = overall - startRate;
    let encouragement;
    if (records.length < 8) {
      encouragement = "你刚刚踏上学习之旅,每一道题都是积累。今天的坚持,就是明天的实力——继续保持,成长图谱会越长越精彩!";
    } else if (delta >= 8) {
      encouragement = `太棒了!你的整体正确率从 ${startRate}% 提升到了 ${overall}%,上升 ${delta} 个百分点。持续的努力正在开花结果,这份向上的节奏请务必保持住!`;
    } else if (delta <= -8) {
      encouragement = `最近正确率从 ${startRate}% 回落到 ${overall}%。别担心,这往往是突破瓶颈前的信号——回看错题本、针对性补强,你很快会重新上扬。`;
    } else if (overall >= 80) {
      encouragement = `你的正确率稳定在 ${overall}% 的高位,基础非常扎实。下一步可以尝试更高难度的题目,把优势延展到更具挑战的战场。`;
    } else {
      encouragement = `你的正确率维持在 ${overall}% 左右,步调平稳。保持规律练习,把薄弱项逐一补齐,进步会水到渠成。`;
    }
    const recent = [...shown].reverse().find((m) => new Date(m.date).getTime() >= now - 30 * DAY);
    if (recent) encouragement += ` 最近的高光时刻:${recent.title}。`;

    const suggestions = [];
    const weak = [...fbTopic].filter((t) => t.attempts >= 3 && t.correctRate < 60).sort((a, b) => a.correctRate - b.correctRate).slice(0, 2);
    for (const w of weak) suggestions.push(`重点巩固「${w.topic}」,目前正确率仅 ${w.correctRate}%,建议针对性练习把它变成强项。`);
    const hard = fbDifficulty.filter((d) => d.difficulty >= 4);
    const hardRate = hard.length ? Math.round(hard.reduce((s, d) => s + d.correct, 0) / hard.reduce((s, d) => s + d.attempts, 0) * 100) : null;
    if (hardRate != null && hardRate < 55 && suggestions.length < 4) suggestions.push(`高难度(4–5 星)题目正确率约 ${hardRate}%,先把中低难度练稳,再逐步进阶挑战难题。`);
    const exam = fbMode.find((m) => m.mode === "EXAM");
    const prac = fbMode.find((m) => m.mode !== "EXAM");
    if (exam && prac && prac.correctRate - exam.correctRate >= 15 && suggestions.length < 4) {
      suggestions.push(`模考正确率比练习低 ${prac.correctRate - exam.correctRate} 个百分点,多参加限时模考以适应真实考试的节奏与压力。`);
    }
    if ((exam?.attempts ?? 0) < 2 && suggestions.length < 4) suggestions.push(`完整模考次数还很少,建议多来几次全真模考,提前适应考试的时间分配。`);
    if (!runs.some((r) => r.status === "WON") && suggestions.length < 4) suggestions.push(`去冒险模式挑战一次通关,把知识转化为实战手感,还能解锁连击成就。`);
    if (maxStreak < 3 && suggestions.length < 4) suggestions.push(`保持每周固定的练习节奏,连续打卡能显著提升记忆留存率。`);
    if (suggestions.length === 0) suggestions.push(`保持当前的练习节奏,尝试每周挑战一道更高难度的题目,持续拓宽能力边界。`);

    ok(res, {
      points,
      milestones: shown,
      coach: { encouragement, suggestions },
      summary: {
        hasData: true,
        firstDate: new Date(firstT).toISOString(),
        lastDate: new Date(Math.max(...recTimes)).toISOString(),
        spanDays: Math.round(spanDays),
        totalAnswered: records.length,
        totalSessions: sessions.length,
        peakRate: Math.max(...points.map((p) => p.overallRate)),
        maxStreak,
      },
    });
  })
);

export default router;
