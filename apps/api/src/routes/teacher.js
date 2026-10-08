import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { parseJsonArray } from "../lib/vision.js";
import { resolveTargetStudents } from "../lib/groups.js";
import { ensureDefaultPlanningTaskForStudent } from "./planning.js";

const router = Router();
// 老师/管理员专用
router.use(requireAuth, requireRole("TEACHER", "ADMIN"));

// 得分口径工具:正确数恒等于 correctCount(每题 1 分,grading 不变量 score===correctCount)。
// score 仅作 legacy 回退;并对 total 做 clamp,任何口径异常都不会让正确率越界 >100%。
function correctOf(s) {
  const total = s.total || 0;
  const cc = s.correctCount != null ? s.correctCount : (s.score != null ? s.score : 0);
  return Math.min(cc, total); // 防御:correct 不会超过 total
}
function rateOf(s) {
  return s.total && s.total > 0 ? Math.min(100, Math.round((correctOf(s) / s.total) * 100)) : 0;
}

// GET /api/teacher/students — 学生列表 + 成绩概览(可搜索)
// ?status=PENDING|APPROVED  按审核状态过滤;缺省默认 APPROVED(已通过,即正常在册学生)
// 注册审核 tab 传 status=PENDING 拉取待审核学生
router.get(
  "/students",
  asyncHandler(async (req, res) => {
    const search = req.query.search ? String(req.query.search).trim() : "";
    const status = req.query.status ? String(req.query.status) : "APPROVED";
    const where = {
      role: "STUDENT",
      status,
      ...(search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] } : {}),
    };
    const students = await prisma.user.findMany({
      where,
      select: { id: true, name: true, email: true, createdAt: true, status: true, reviewedAt: true, reviewNote: true },
      orderBy: { createdAt: "asc" },
    });
    const list = [];
    for (const s of students) {
      const sessions = await prisma.session.findMany({
        where: { studentId: s.id, submittedAt: { not: null } },
        select: { score: true, total: true, correctCount: true, questionIds: true, mode: true, submittedAt: true },
        orderBy: { submittedAt: "desc" },
      });
      const answered = sessions.filter((x) => x.total && x.total > 0 && x.questionIds); // 排除空 questionIds 孤儿会话
      const sumScore = answered.reduce((a, x) => a + correctOf(x), 0);
      const sumTotal = answered.reduce((a, x) => a + (x.total ?? 0), 0);
      const last = sessions[0];
      list.push({
        id: s.id,
        name: s.name,
        email: s.email,
        createdAt: s.createdAt,
        status: s.status,
        reviewedAt: s.reviewedAt,
        reviewNote: s.reviewNote,
        sessionCount: sessions.length,
        avgRate: sumTotal ? Math.min(100, Math.round((sumScore / sumTotal) * 100)) : 0,
        lastSession: last ? { score: last.correctCount ?? last.score, total: last.total, mode: last.mode, submittedAt: last.submittedAt } : null,
      });
    }
    // 按平均正确率降序
    list.sort((a, b) => b.avgRate - a.avgRate);
    ok(res, { list });
  })
);

// GET /api/teacher/stats/students-matrix
// 每生学情高维矩阵(纯只读聚合,零写操作、零表结构变更)。
// 7 维度:①难度解决力 ②解题速度(EXAM/PRACTICE 双口径) ③进步趋势 ④稳定性 ⑤练习vs模考分化 ⑥知识点覆盖 ⑦粗心
// 鉴权:挂在 teacher 路由下,requireRole("TEACHER","ADMIN") 全局生效 → 仅教师/管理员可见。
// ?studentId=  指定单生(返回 {student});缺省返回全部有作答记录的学生 {students:[...]}。
// ?minSample=  高基题判定所需最少样本数(默认 3),仅影响"粗心"维度。
export const HIGH_BASE_RATE = 0.8; // 全局正确率 ≥ 80% 视为"高基题"(粗心信号基准)
// 错题归因(口径B)可调参数
export const LATE_GUESS_WINDOW_MS = 120000; // "最后一两分钟":交卷前 120s 内作答
export const LATE_GUESS_MAX_TIME = 10; // 且单题耗时 ≤10s 视为"快速乱选"(随机蒙)
export const CONCEPT_REPEAT_MIN = 5; // 深度不足:同一知识点累计错 ≥5 次(原 2 次)
export async function buildStudentsMatrix(studentId, minSample) {
  // 1) 题目基础属性(difficulty / topicIds),并收集全库知识点集合(覆盖维度分母)
  const questions = await prisma.question.findMany({
    select: { id: true, difficulty: true, topicIds: true, sourceType: true, topic: true, answer: true, stem: true, options: true, solution: true },
  });
  const qMap = new Map(questions.map((q) => [q.id, q]));
  const allTopicIds = new Set();
  for (const q of questions) {
    try {
      const arr = q.topicIds ? JSON.parse(q.topicIds) : [];
      if (Array.isArray(arr)) arr.forEach((t) => allTopicIds.add(t));
    } catch {
      /* topicIds 非法 JSON 跳过 */
    }
  }

  // 2) 全部作答记录(含所属会话的 studentId / mode),用于逐生聚合 + 全局题基率预聚合(一次)
  const recs = await prisma.answerRecord.findMany({
    where: { isCorrect: { not: null } },
    select: {
      questionId: true,
      isCorrect: true,
      timeSpent: true,
      selected: true,
      createdAt: true,
      sessionId: true,
      session: { select: { studentId: true, mode: true, submittedAt: true } },
      question: { select: { sourceType: true } },
    },
  });

  // 全局题基率:baseRate_q = correct/total;高基题 = 样本≥minSample 且 baseRate≥0.8
  const qStats = new Map(); // qid -> {n,c}
  for (const r of recs) {
    const s = qStats.get(r.questionId) || { n: 0, c: 0 };
    s.n += 1;
    if (r.isCorrect) s.c += 1;
    qStats.set(r.questionId, s);
  }
  const highBase = new Set();
  for (const [qid, s] of qStats) {
    if (s.n >= minSample && s.c / s.n >= HIGH_BASE_RATE) highBase.add(qid);
  }

  // 按学生分桶
  const byStudent = new Map();
  for (const r of recs) {
    const sid = r.session?.studentId;
    if (!sid) continue;
    if (!byStudent.has(sid)) byStudent.set(sid, []);
    byStudent.get(sid).push(r);
  }

  // 3) 会话表(趋势/稳定性/分化维度用 session.score/total,语义与前端一致)
  const sessions = await prisma.session.findMany({
    where: { submittedAt: { not: null } },
    select: { id: true, studentId: true, mode: true, score: true, total: true, correctCount: true, questionIds: true, submittedAt: true },
  });
  const sessionsByStudent = new Map();
  for (const s of sessions) {
    if (!sessionsByStudent.has(s.studentId)) sessionsByStudent.set(s.studentId, []);
    sessionsByStudent.get(s.studentId).push(s);
  }

  // 目标学生
  const targetIds = studentId ? [studentId] : [...byStudent.keys()];
  const users = await prisma.user.findMany({
    where: { id: { in: targetIds }, role: "STUDENT" },
    select: { id: true, name: true, email: true },
  });
  const userMap = new Map(users.map((u) => [u.id, u]));

  // 工具函数
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const median = (a) => {
    if (!a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    const m = Math.floor(s.length / 2);
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };

  // 题内耗时中位(样本≥3):用于「难题放弃(秒选蒙)」判据 —— 单题耗时 ≤0.4×该题全班中位 ⇒ 基本没读题
  const qTimes = new Map();
  for (const r of recs) {
    if (typeof r.timeSpent === "number" && r.timeSpent > 0) {
      const a = qTimes.get(r.questionId);
      if (a) a.push(r.timeSpent); else qTimes.set(r.questionId, [r.timeSpent]);
    }
  }
  const qMedianTime = new Map();
  for (const [qid, arr] of qTimes) if (arr.length >= 3) qMedianTime.set(qid, median(arr));
  const baseRateOf = (qid) => {
    const s = qStats.get(qid);
    return s && s.n >= minSample ? s.c / s.n : null;
  };

  // 单生聚合函数:返回 7 维度 + 综合得分率(与前端归一化共用,零写操作)
  const matrixOf = (sRecs, ss) => {
    // ①难度解决力
    const diffMap = new Map();
    for (const r of sRecs) {
      const q = qMap.get(r.questionId);
      if (!q) continue;
      const d = q.difficulty;
      const it = diffMap.get(d) || { attempts: 0, correct: 0 };
      it.attempts += 1;
      if (r.isCorrect) it.correct += 1;
      diffMap.set(d, it);
    }
    const difficulty = [...diffMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([d, it]) => ({
        difficulty: d,
        attempts: it.attempts,
        correctRate: it.attempts ? Math.round((it.correct / it.attempts) * 100) : 0,
      }));

    // 考试范围 + 速度基准(TMUA 180s/题, ESAT 80s/题, 按作答量加权混合; 两者皆无则 120s 兜底)
    const scopeSet = new Set();
    let nT = 0, nE = 0;
    for (const r of sRecs) {
      const st = r.question?.sourceType;
      if (st) scopeSet.add(st);
      if (st === "TMUA") nT += 1;
      else if (st === "ESAT") nE += 1;
    }
    const speedBaselineSec = nT + nE > 0 ? Math.round((180 * nT + 80 * nE) / (nT + nE)) : 120;

    // ②解题速度(EXAM / PRACTICE 双口径)
    const examTimes = sRecs
      .filter((r) => r.session?.mode === "EXAM" && typeof r.timeSpent === "number")
      .map((r) => r.timeSpent);
    const pracTimes = sRecs
      .filter((r) => r.session?.mode === "PRACTICE" && typeof r.timeSpent === "number")
      .map((r) => r.timeSpent);
    const speed = {
      exam: { meanSec: examTimes.length ? Math.round(mean(examTimes)) : null, medianSec: median(examTimes), count: examTimes.length },
      practice: { meanSec: pracTimes.length ? Math.round(mean(pracTimes)) : null, medianSec: median(pracTimes), count: pracTimes.length },
      baselineSec: speedBaselineSec,
    };
    // 速度归一化得分(与前端 normSpeed 同式, clamp 0–80)。
    // 满分锚点: 中位 ≤ 考试基准 = 80 分(不再封顶 100); 中位 > 基准时按 80×基准/中位 从 80 往下扣, 最低 0。
    // 主口径: EXAM 每题中位(计时可靠)。PRACTICE 计时系统性不可靠 —— 未交卷/连刷 session 常把每题用时记成占位值(如 1s),
    // 故仅作无 EXAM 数据时的兜底, 且过滤占位计时(<=MIN_PRAC_SEC 视为未采集/秒选, 正常 TMUA/MAT 选择题读题至少需数秒)。
    // 无有效中位 → null(而非前端 50 兜底): 班级均值只对有数据的学生求均值, 避免样本不足者拖低均值。
    const MIN_PRAC_SEC = 5;
    const examValid = examTimes.filter((t) => t > 0);
    const pracValid = pracTimes.filter((t) => t > 0 && t >= MIN_PRAC_SEC);
    const scoreMedian = examValid.length ? median(examValid) : median(pracValid);
    const speedScore =
      scoreMedian == null
        ? null
        : Math.round(Math.max(0, Math.min(80, (80 * speedBaselineSec) / scoreMedian)));

    // ③进步趋势(最小二乘斜率) + ④稳定性(CV)
    const rates = ss.map((s) => rateOf(s));
    let slope = null;
    let direction = "flat";
    if (rates.length >= 2) {
      const xs = rates.map((_, i) => i);
      const mx = mean(xs);
      const my = mean(rates);
      let num = 0;
      let den = 0;
      for (let i = 0; i < rates.length; i++) { num += (xs[i] - mx) * (rates[i] - my); den += (xs[i] - mx) ** 2; }
      slope = den ? num / den : 0;
      direction = Math.abs(slope) < 0.5 ? "flat" : slope > 0 ? "up" : "down";
    }
    const trend = {
      slopePerSession: slope != null ? Math.round(slope * 10) / 10 : null,
      firstRate: rates.length ? Math.round(rates[0]) : null,
      lastRate: rates.length ? Math.round(rates[rates.length - 1]) : null,
      direction,
    };
    let stability = { cv: null, meanRate: null, label: "no-data" };
    if (rates.length >= 2) {
      const m = mean(rates);
      const sd = Math.sqrt(mean(rates.map((r) => (r - m) ** 2)));
      const cv = m ? sd / m : 0;
      stability = {
        cv: Math.round(cv * 1000) / 1000,
        meanRate: Math.round(m),
        label: cv < 0.1 ? "stable" : cv < 0.2 ? "moderate" : "volatile",
      };
    }

    // ⑤练习 vs 模考分化
    const examRates = ss.filter((s) => s.mode === "EXAM").map((s) => rateOf(s));
    const pracRates = ss.filter((s) => s.mode === "PRACTICE").map((s) => rateOf(s));
    const examRate = examRates.length ? Math.round(mean(examRates)) : null;
    const pracRate = pracRates.length ? Math.round(mean(pracRates)) : null;
    const modeDivergence = { examRate, practiceRate: pracRate, delta: examRate != null && pracRate != null ? examRate - pracRate : null };

    // ⑥知识点覆盖(按考试范围圈定分母: 只考 TMUA → 仅数学; TMUA+ESAT → 数学+物理 …)
    const scopeTopicIds = new Set();
    for (const q of questions) {
      if (scopeSet.has(q.sourceType)) {
        try { const arr = q.topicIds ? JSON.parse(q.topicIds) : []; if (Array.isArray(arr)) arr.forEach((t) => scopeTopicIds.add(t)); } catch { /* skip */ }
      }
    }
    const covered = new Set();
    for (const r of sRecs) {
      const q = qMap.get(r.questionId);
      if (!q || !q.topicIds) continue;
      try { const arr = JSON.parse(q.topicIds); if (Array.isArray(arr)) arr.forEach((t) => covered.add(t)); } catch { /* skip */ }
    }
    let coveredInScope = 0;
    for (const t of covered) if (scopeTopicIds.has(t)) coveredInScope += 1;
    const scopeTopicCount = scopeTopicIds.size;
    const coverage = {
      covered: coveredInScope,
      total: scopeTopicCount,
      rate: scopeTopicCount ? Math.round((coveredInScope / scopeTopicCount) * 100) : 0,
    };

    // ⑦粗心(高基题上 isCorrect=false 的比例)
    let slipCount = 0;
    let denom = 0;
    for (const r of sRecs) {
      if (highBase.has(r.questionId)) { denom += 1; if (!r.isCorrect) slipCount += 1; }
    }
    const carelessness = {
      highBaseAttempts: denom,
      slipCount,
      slipRate: denom ? Math.round((slipCount / denom) * 100) : null,
    };

    // ⑧错题归因(口径B · 行为推断:零标签系统、零表结构变更)
    // 判据全部取自库内既有信号: selected 空=未作答 / 题目全班正确率=题难易 / 单题耗时 vs 题内中位 / 本人同知识点重复错
    //   + 新增: 交卷前 LATE_GUESS_WINDOW_MS 内、单题耗时 ≤ LATE_GUESS_MAX_TIME 的已作答错答 => 视为「最后一两分钟快速乱选」归入超时未答
    // 优先级(每条错答唯一归因): 超时未答(含末段乱选) > 难题放弃 > 粗心(高基题已作答仍错) > 深度不足(同知识点错≥CONCEPT_REPEAT_MIN) > 待观察
    // ⚠️ 高基题判定必须排在「重复错」之前: 否则高基题上的粗心错会被 concept 吞掉(离线模拟实测 289→20)。
    // ⚠️ lateGuess(末段乱选)必须排在 abandon/careless/concept 之前,归入 timeout: 它本质是"时间不够随机蒙",提示时间管理而非知识缺口。
    const topicErr = new Map();
    for (const r of sRecs) {
      if (r.isCorrect !== false) continue;
      const q = qMap.get(r.questionId);
      if (!q || !q.topicIds) continue;
      try {
        const arr = JSON.parse(q.topicIds);
        if (Array.isArray(arr)) for (const t of arr) topicErr.set(t, (topicErr.get(t) || 0) + 1);
      } catch { /* topicIds 非法 JSON 跳过 */ }
    }
    const errBuckets = { timeout: [], abandon: [], careless: [], concept: [], watch: [] };
    for (const r of sRecs) {
      if (r.isCorrect !== false) continue;
      const q = qMap.get(r.questionId);
      const rate = baseRateOf(r.questionId);
      const med = qMedianTime.get(r.questionId);
      const unans = r.selected == null || !String(r.selected).trim();
      let topics = [];
      if (q && q.topicIds) {
        try { const a = JSON.parse(q.topicIds); if (Array.isArray(a)) topics = a; } catch { /* skip */ }
      }
      const repeat = topics.some((t) => (topicErr.get(t) || 0) >= CONCEPT_REPEAT_MIN);
      // 末段快速乱选:已作答、判错、单题耗时极短,且作答时间落在交卷前 LATE_GUESS_WINDOW_MS 内
      // => 很可能时间不够随机蒙,归入「超时未答」(与真正未作答同口径,提示时间管理问题而非知识缺口)
      const lateGuess =
        !unans &&
        typeof r.timeSpent === "number" &&
        r.timeSpent <= LATE_GUESS_MAX_TIME &&
        (() => {
          const tEnd = r.session && r.session.submittedAt ? new Date(r.session.submittedAt).getTime() : NaN;
          const tAns = r.createdAt ? new Date(r.createdAt).getTime() : NaN;
          return !isNaN(tEnd) && !isNaN(tAns) && tEnd - tAns <= LATE_GUESS_WINDOW_MS;
        })();
      let key;
      if (unans || lateGuess) key = "timeout";
      else if (rate != null && rate < 0.5 && med != null && typeof r.timeSpent === "number" && r.timeSpent <= 0.4 * med) key = "abandon";
      else if (rate != null && rate >= HIGH_BASE_RATE) key = "careless";
      else if ((rate != null && rate < 0.5) || repeat) key = "concept";
      else key = "watch";
      errBuckets[key].push({ r, q, topics });
    }
    const ERR_META = [
      ["timeout", "超时未答", "#85B7EB"],
      ["abandon", "难题放弃", "#AFA9EC"],
      ["careless", "粗心/看错", "#FAC775"],
      ["concept", "深度不足", "#F0997B"],
      ["watch", "待观察", "#D3D1C7"],
    ];
    const wrongTotal = ERR_META.reduce((n, [k]) => n + errBuckets[k].length, 0);
    const errorProfile = {
      wrongTotal,
      minSample,
      buckets: ERR_META.map(([key, label, color]) => {
        const list = errBuckets[key];
        const seen = new Set();
        const samples = [...list]
          .sort((a, b) => new Date(b.r.createdAt) - new Date(a.r.createdAt))
          .filter((x) => {
            const t = (x.q && x.q.topic) || x.topics[0] || "未标注";
            if (seen.has(t)) return false;
            seen.add(t);
            return true;
          })
          .slice(0, 3)
          .map((x) => ({
            questionId: x.r.questionId,
            topic: (x.q && x.q.topic) || x.topics[0] || "未标注知识点",
            sourceType: (x.q && x.q.sourceType) || null,
            mode: (x.r.session && x.r.session.mode) || null,
            selected: x.r.selected ?? null,
            answer: (x.q && x.q.answer) || null,
            timeSpent: typeof x.r.timeSpent === "number" ? x.r.timeSpent : null,
            stem: (x.q && x.q.stem) || null,
            options: x.q ? parseJsonArray(x.q.options) : [],
            solution: (x.q && x.q.solution) || null,
          }));
        return { key, label, color, count: list.length, rate: wrongTotal ? Math.round((list.length / wrongTotal) * 100) : 0, samples };
      }).sort((a, b) => b.count - a.count),
    };

    const totalAttempts = sRecs.length;
    const correct = sRecs.filter((r) => r.isCorrect).length;
    return {
      avgRate: totalAttempts ? Math.round((correct / totalAttempts) * 100) : 0,
      difficulty, speed, speedScore, trend, stability, modeDivergence, coverage, carelessness, errorProfile,
      scopeTopicCount,
    };
  };

  // 全生矩阵(用于班级基准 + 无 studentId 时返回全体)
  const studentMatrices = new Map();
  for (const sid of byStudent.keys()) {
    const sRecs = byStudent.get(sid) || [];
    const ss = (sessionsByStudent.get(sid) || [])
      .filter((x) => x.total && x.total > 0 && x.questionIds)
      .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
    studentMatrices.set(sid, matrixOf(sRecs, ss));
  }

  // 班级基准(全体有作答学生聚合):量表类维度用全体生均值,避免跨生时序失真
  const allRecs = [];
  for (const arr of byStudent.values()) allRecs.push(...arr);
  const poolMatrix = matrixOf(allRecs, []);
  const avgArr = (a) => (a.length ? Math.round(mean(a) * 10) / 10 : null);
  const slopes = [...studentMatrices.values()].map((m) => m.trend.slopePerSession).filter((x) => x != null);
  const cvs = [...studentMatrices.values()].map((m) => m.stability.cv).filter((x) => x != null);
  const mrs = [...studentMatrices.values()].map((m) => m.stability.meanRate).filter((x) => x != null);
  const eRates = [...studentMatrices.values()].map((m) => m.modeDivergence.examRate).filter((x) => x != null);
  const pRates = [...studentMatrices.values()].map((m) => m.modeDivergence.practiceRate).filter((x) => x != null);
  const avgCv = cvs.length ? Math.round(mean(cvs) * 1000) / 1000 : null;
  // 班级速度分 = 逐生归一化得分的均值(剔除无练习数据者)。
  // ⚠️ 不能用「全班池化练习中位再归一」: 池化中位(实测 60s)远低于考试基准(≈110s),
  //    100×基准/中位 会饱和 clamp 到 100 → 班级均值恒为满分, 不可解释(实测逐生均值 79)。
  const speedScores = [...studentMatrices.values()].map((m) => m.speedScore).filter((x) => x != null);
  const classSpeedScore = speedScores.length ? Math.round(mean(speedScores)) : null;
  const classBaseline = {
    avgRate: poolMatrix.avgRate,
    difficulty: poolMatrix.difficulty,
    speed: poolMatrix.speed,
    speedScore: classSpeedScore,
    trend: {
      slopePerSession: avgArr(slopes),
      direction: avgArr(slopes) == null ? "flat" : Math.abs(avgArr(slopes)) < 0.5 ? "flat" : avgArr(slopes) > 0 ? "up" : "down",
      firstRate: null,
      lastRate: null,
    },
    stability: {
      cv: avgCv,
      meanRate: mrs.length ? Math.round(mean(mrs)) : null,
      label: avgCv == null ? "no-data" : avgCv < 0.1 ? "stable" : avgCv < 0.2 ? "moderate" : "volatile",
    },
    modeDivergence: {
      examRate: eRates.length ? Math.round(mean(eRates)) : null,
      practiceRate: pRates.length ? Math.round(mean(pRates)) : null,
      delta: eRates.length && pRates.length ? Math.round(mean(eRates) - mean(pRates)) : null,
    },
    coverage: poolMatrix.coverage,
    carelessness: poolMatrix.carelessness,
    // 班级错因占比(仅占比,不带代表错题明细 → 避免响应膨胀);键与 student.errorProfile.buckets[].key 一致
    errorShare: Object.fromEntries(poolMatrix.errorProfile.buckets.map((b) => [b.key, b.rate])),
  };

  // 输出
  if (studentId) {
    const sRecs = byStudent.get(studentId) || [];
    const ss = (sessionsByStudent.get(studentId) || [])
      .filter((x) => x.total && x.total > 0 && x.questionIds)
      .sort((a, b) => new Date(a.submittedAt) - new Date(b.submittedAt));
    const m = matrixOf(sRecs, ss);
    const u = userMap.get(studentId) || {};
    return {
      student: { id: studentId, name: u.name || "(未知)", email: u.email || "", sessionCount: (sessionsByStudent.get(studentId) || []).length, ...m },
      classBaseline,
      highBaseQuestionCount: highBase.size,
      totalTopicCount: m.scopeTopicCount ?? allTopicIds.size,
    };
  }
  const out = [...byStudent.keys()].map((sid) => {
    const m = studentMatrices.get(sid);
    const u = userMap.get(sid) || {};
    // 错因代表错题明细仅单生详情页需要 → 列表接口剔除,避免 34 生 × 5 桶 × 3 条 的响应膨胀
    const { errorProfile: _drop, ...slim } = m;
    return { id: sid, name: u.name || "(未知)", email: u.email || "", sessionCount: (sessionsByStudent.get(sid) || []).length, ...slim };
  });
  out.sort((a, b) => b.avgRate - a.avgRate);
  return { students: out, classBaseline, highBaseQuestionCount: highBase.size, totalTopicCount: allTopicIds.size };
}

router.get(
  "/stats/students-matrix",
  asyncHandler(async (req, res) => {
    const studentId = req.query.studentId ? String(req.query.studentId) : null;
    const minSample = Math.max(1, parseInt(String(req.query.minSample || "3"), 10) || 3);
    const matrix = await buildStudentsMatrix(studentId, minSample);
    if (studentId) {
      ok(res, {
        student: matrix.student,
        classBaseline: matrix.classBaseline,
        highBaseQuestionCount: matrix.highBaseQuestionCount,
        totalTopicCount: matrix.totalTopicCount,
      });
    } else {
      ok(res, {
        students: matrix.students,
        classBaseline: matrix.classBaseline,
        highBaseQuestionCount: matrix.highBaseQuestionCount,
        totalTopicCount: matrix.totalTopicCount,
        generatedAt: new Date().toISOString(),
      });
    }
  })
);

// GET /api/teacher/students/:id/stats — 单个学生详情(成绩历史 + 知识点掌握度)
router.get(
  "/students/:id/stats",
  asyncHandler(async (req, res) => {
    const student = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!student || student.role !== "STUDENT") return fail(res, 404, "学生不存在");

    const sessionsRaw = await prisma.session.findMany({
      where: { studentId: student.id },
      orderBy: { startedAt: "desc" },
      select: {
        id: true, mode: true, score: true, total: true, correctCount: true,
        startedAt: true, submittedAt: true, assignmentId: true,
        paper: { select: { title: true, subject: true, sourceType: true } },
      },
    });
    const sessions = sessionsRaw.map((s) => ({
      ...s,
      paper: { ...s.paper, mode: s.mode },
      durationSec: s.submittedAt
        ? Math.round((new Date(s.submittedAt).getTime() - new Date(s.startedAt).getTime()) / 1000)
        : null,
      status: s.submittedAt ? "DONE" : "IN_PROGRESS",
    }));

    const records = await prisma.answerRecord.findMany({
      where: { session: { studentId: student.id }, isCorrect: { not: null } },
      include: { question: { select: { topic: true } } },
    });
    const agg = new Map();
    for (const r of records) {
      const t = r.question.topic || "未分类";
      const item = agg.get(t) || { topic: t, attempts: 0, correct: 0 };
      item.attempts += 1;
      if (r.isCorrect) item.correct += 1;
      agg.set(t, item);
    }
    ok(res, {
      student: { id: student.id, name: student.name, email: student.email, createdAt: student.createdAt },
      sessions,
      byTopic: [...agg.values()].map(({ topic, attempts, correct }) => ({
        topic, attempts, correctRate: attempts ? Math.round((correct / attempts) * 100) : 0,
      })),
    });
  })
);

// DELETE /api/teacher/students/:id — 删除学生(级联删除该学生所有相关数据)
// 关联数据:Session(及其 AnswerRecord)、WrongBook、RoguelikeRun、AssignmentStudent、User
router.delete(
  "/students/:id",
  asyncHandler(async (req, res) => {
    const student = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!student || student.role !== "STUDENT") return fail(res, 404, "学生不存在");
    if (student.id === req.user.id) return fail(res, 400, "不能删除自己");

    // 1) 该学生所有会话 → 会话的作答记录
    const sessions = await prisma.session.findMany({ where: { studentId: student.id }, select: { id: true } });
    const sessionIds = sessions.map((s) => s.id);
    if (sessionIds.length) {
      await prisma.answerRecord.deleteMany({ where: { sessionId: { in: sessionIds } } });
      await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
    }
    // 1b) 语言模块:语言会话 → 作答记录
    const langSessions = await prisma.languageSession.findMany({ where: { studentId: student.id }, select: { id: true } });
    const langSessionIds = langSessions.map((s) => s.id);
    if (langSessionIds.length) {
      await prisma.languageAnswerRecord.deleteMany({ where: { sessionId: { in: langSessionIds } } });
      await prisma.languageSession.deleteMany({ where: { id: { in: langSessionIds } } });
    }
    // 2) 作业分发目标
    await prisma.assignmentStudent.deleteMany({ where: { studentId: student.id } });
    // 3) 错题本 / 爬塔记录
    await prisma.wrongBook.deleteMany({ where: { studentId: student.id } });
    await prisma.languageWrongBook.deleteMany({ where: { studentId: student.id } });
    await prisma.roguelikeRun.deleteMany({ where: { studentId: student.id } });
    // 3b) 学生发起的讲评请求
    await prisma.reviewRequest.deleteMany({ where: { studentId: student.id } });
    // 3b) 该学生所在的分组成员关系
    await prisma.groupStudent.deleteMany({ where: { studentId: student.id } });
    // 4) 学生账号
    await prisma.user.delete({ where: { id: student.id } });

    ok(res, { id: student.id }, `已删除学生「${student.name}」及其全部数据`);
  })
);

// 级联删除学生及其全部关联数据(供「删除」与「拒绝注册」复用)
async function deleteStudentCascade(studentId) {
  const sessions = await prisma.session.findMany({ where: { studentId }, select: { id: true } });
  const sessionIds = sessions.map((s) => s.id);
  if (sessionIds.length) {
    await prisma.answerRecord.deleteMany({ where: { sessionId: { in: sessionIds } } });
    await prisma.session.deleteMany({ where: { id: { in: sessionIds } } });
  }
  const langSessions = await prisma.languageSession.findMany({ where: { studentId }, select: { id: true } });
  const langSessionIds = langSessions.map((s) => s.id);
  if (langSessionIds.length) {
    await prisma.languageAnswerRecord.deleteMany({ where: { sessionId: { in: langSessionIds } } });
    await prisma.languageSession.deleteMany({ where: { id: { in: langSessionIds } } });
  }
  await prisma.assignmentStudent.deleteMany({ where: { studentId } });
  await prisma.wrongBook.deleteMany({ where: { studentId } });
  await prisma.languageWrongBook.deleteMany({ where: { studentId } });
  await prisma.roguelikeRun.deleteMany({ where: { studentId } });
  await prisma.favorite.deleteMany({ where: { studentId } });
  await prisma.reviewRequest.deleteMany({ where: { studentId } });
  await prisma.groupStudent.deleteMany({ where: { studentId } });
  await prisma.user.delete({ where: { id: studentId } });
}

// POST /api/teacher/students/:id/approve — 审核通过(学生账号生效)
router.post(
  "/students/:id/approve",
  asyncHandler(async (req, res) => {
    const r = await prisma.user.updateMany({
      where: { id: req.params.id, role: "STUDENT", status: "PENDING" },
      data: { status: "APPROVED", reviewedBy: req.user.id, reviewedAt: new Date(), reviewNote: null },
    });
    if (!r.count) return fail(res, 404, "学生不存在或状态已变更");
    // 新注册学生默认获得一次「提交升学档案」任务
    try { await ensureDefaultPlanningTaskForStudent(prisma, req.params.id, req.user.id); } catch (e) { console.error("[planning] 默认任务创建失败", e); }
    ok(res, null, "已通过该学生的注册申请");
  })
);

// POST /api/teacher/students/:id/reject — 拒绝注册(删除账号,邮箱释放可重新注册)
router.post(
  "/students/:id/reject",
  asyncHandler(async (req, res) => {
    const student = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!student || student.role !== "STUDENT") return fail(res, 404, "学生不存在");
    if (student.status !== "PENDING") return fail(res, 400, "仅待审核的学生可被拒绝");
    if (student.id === req.user.id) return fail(res, 400, "不能拒绝自己");
    await deleteStudentCascade(student.id);
    ok(res, null, `已拒绝「${student.name}」的注册申请，账号已删除`);
  })
);

// POST /api/teacher/students/batch-approve — 批量通过
router.post(
  "/students/batch-approve",
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) return fail(res, 400, "请选择要通过的学生");
    const r = await prisma.user.updateMany({
      where: { id: { in: ids }, role: "STUDENT", status: "PENDING" },
      data: { status: "APPROVED", reviewedBy: req.user.id, reviewedAt: new Date(), reviewNote: null },
    });
    // 新注册学生默认获得一次「提交升学档案」任务(幂等:已有任务者跳过)
    const approved = await prisma.user.findMany({ where: { id: { in: ids }, status: "APPROVED" }, select: { id: true } });
    for (const u of approved) {
      try { await ensureDefaultPlanningTaskForStudent(prisma, u.id, req.user.id); } catch (e) { console.error("[planning] 默认任务创建失败", u.id, e); }
    }
    ok(res, null, `已通过 ${r.count} 名学生`);
  })
);

// POST /api/teacher/students/batch-reject — 批量拒绝(删除账号)
router.post(
  "/students/batch-reject",
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) return fail(res, 400, "请选择要拒绝的学生");
    const r = await prisma.user.deleteMany({
      where: { id: { in: ids }, role: "STUDENT", status: "PENDING" },
    });
    ok(res, null, `已拒绝并删除 ${r.count} 名学生账号`);
  })
);

// ——— 作业分发 ———
// GET /api/teacher/assignments — 作业列表(含每份作业的完成统计);?mode=PRACTICE 只列作业
router.get(
  "/assignments",
  asyncHandler(async (req, res) => {
    const list = await prisma.assignment.findMany({
      where: { teacherId: req.user.id, ...(req.query.mode ? { mode: String(req.query.mode) } : {}) },
      include: {
        paper: { select: { title: true, subject: true, sourceType: true } },
        languagePaper: { select: { id: true, title: true, examType: true, skill: true } },
        targets: { select: { status: true, submittedAt: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    ok(res, {
      list: list.map((a) => {
        const total = a.targets.length;
        const submitted = a.targets.filter((t) => t.status === "SUBMITTED").length;
        const inProgress = a.targets.filter((t) => t.status === "IN_PROGRESS").length;
        return {
          id: a.id, title: a.title, note: a.note, mode: a.mode, dueAt: a.dueAt, status: a.status, createdAt: a.createdAt, durationMin: a.durationMin,
          paper: a.paper ? { title: a.paper.title, subject: a.paper.subject, sourceType: a.paper.sourceType } : null,
          languagePaper: a.languagePaper ? { id: a.languagePaper.id, title: a.languagePaper.title, examType: a.languagePaper.examType, skill: a.languagePaper.skill } : null,
          stats: { total, submitted, inProgress, pending: total - submitted - inProgress },
        };
      }),
    });
  })
);

// POST /api/teacher/assignments — 创建作业/考试分发(选试卷 + 选学生 + 可选 DDL)
// paperId: 学科卷;languagePaperId: 语言卷(雅思等)。二者选一
router.post(
  "/assignments",
  asyncHandler(async (req, res) => {
    const { paperId, languagePaperId, title, note, studentIds, groupIds, dueAt, mode, durationMin } = req.body || {};
    if (!paperId && !languagePaperId) return fail(res, 400, "请选择试卷");
    // 支持"按组布置":把选中的组内学生展开,与逐选学生合并去重
    const finalStudentIds = await resolveTargetStudents({ studentIds, groupIds, teacherId: req.user.id });
    if (finalStudentIds.length === 0) return fail(res, 400, "请选择至少一名学生(或选择一个分组)");

    let paperTitle = "";
    if (paperId) {
      const paper = await prisma.paper.findUnique({ where: { id: paperId } });
      if (!paper) return fail(res, 404, "试卷不存在");
      paperTitle = paper.title;
    }
    let languagePaper = null;
    if (languagePaperId) {
      languagePaper = await prisma.languagePaper.findUnique({ where: { id: languagePaperId } });
      if (!languagePaper) return fail(res, 404, "语言试卷不存在");
      paperTitle = languagePaper.title;
    }

    // 校验学生存在、都是 STUDENT 且已通过审核(待审核学生不能接收作业/考试)
    const students = await prisma.user.findMany({ where: { id: { in: finalStudentIds }, role: "STUDENT", status: "APPROVED" } });
    if (students.length !== finalStudentIds.length) return fail(res, 400, "存在无效或未通过审核的学生");

    // 模式:显式传入优先(作业分发/考试管理由前端选择 练习 或 模考);未传时按语言卷模式兜底,缺省为练习。
    // 注意:套题(Paper)本身不再携带模式,模式完全由分发/考试时决定。
    const aMode =
      mode === "EXAM" ? "EXAM" :
      mode === "PRACTICE" ? "PRACTICE" :
      languagePaper?.mode === "EXAM" ? "EXAM" : "PRACTICE";
    const parsedDue = dueAt ? new Date(dueAt) : null;
    if (parsedDue && Number.isNaN(parsedDue.getTime())) return fail(res, 400, "截止时间格式不正确");
    // 模考/考试时长(分钟):由老师分发或考试管理时设置;非 EXAM 或为空则置空
    const aDuration = aMode === "EXAM" && durationMin ? Math.round(Number(durationMin)) : null;
    if (aMode === "EXAM" && !aDuration) return fail(res, 400, "模考/考试必须设置限时(分钟)");

    // 记录"按组布置"的分组 id(去重);逐生布置时为空,存 null
    const gids = Array.isArray(groupIds) ? [...new Set(groupIds.filter(Boolean).map(String))] : [];
    const assignment = await prisma.assignment.create({
      data: {
        teacherId: req.user.id,
        paperId: paperId || null,
        languagePaperId: languagePaperId || null,
        title: String(title || "").trim() || paperTitle,
        note: note ? String(note).trim() : null,
        mode: aMode,
        durationMin: aDuration,
        dueAt: parsedDue,
        groupIds: gids.length ? JSON.stringify(gids) : null,
        targets: { create: finalStudentIds.map((sid) => ({ studentId: sid })) },
      },
    });
    ok(res, { id: assignment.id }, `已向 ${students.length} 名学生布置「${assignment.title}」`);
  })
);

// DELETE /api/teacher/assignments/:id — 删除作业(撤回分发)
router.delete(
  "/assignments/:id",
  asyncHandler(async (req, res) => {
    const assignment = await prisma.assignment.findUnique({ where: { id: req.params.id } });
    if (!assignment || assignment.teacherId !== req.user.id) return fail(res, 404, "作业不存在");
    await prisma.assignmentStudent.deleteMany({ where: { assignmentId: assignment.id } });
    // 学生已开的作业会话保留(不删作答记录),仅解除作业关联
    await prisma.session.updateMany({ where: { assignmentId: assignment.id }, data: { assignmentId: null } });
    await prisma.languageSession.updateMany({ where: { assignmentId: assignment.id }, data: { assignmentId: null } });
    await prisma.assignment.delete({ where: { id: assignment.id } });
    ok(res, { id: assignment.id }, "作业已删除");
  })
);

// GET /api/teacher/assignments/:id — 作业详情(含每个学生的完成状态)
router.get(
  "/assignments/:id",
  asyncHandler(async (req, res) => {
    const assignment = await prisma.assignment.findUnique({
      where: { id: req.params.id },
      include: {
        paper: { select: { title: true, subject: true, sourceType: true } },
        languagePaper: { select: { id: true, title: true, examType: true, skill: true } },
        targets: {
          include: { student: { select: { id: true, name: true, email: true } } },
        },
      },
    });
    if (!assignment || assignment.teacherId !== req.user.id) return fail(res, 404, "作业不存在");
    // 统计每个学生已完成(已作答)的具体题目数量:通过 assignmentStudent.sessionId 关联会话
    const sessionIds = assignment.targets.map((t) => t.sessionId).filter(Boolean);
    const answeredMap = {};
    const totalMap = {};
    if (sessionIds.length) {
      const groups = await prisma.answerRecord.groupBy({
        by: ["sessionId"],
        where: { sessionId: { in: sessionIds }, selected: { not: null } },
        _count: { _all: true },
      });
      groups.forEach((g) => { answeredMap[g.sessionId] = g._count._all; });
      const sessRows = await prisma.session.findMany({
        where: { id: { in: sessionIds } },
        select: { id: true, total: true },
      });
      sessRows.forEach((s) => { totalMap[s.id] = s.total ?? 0; });
    }
    ok(res, {
      id: assignment.id, title: assignment.title, note: assignment.note, mode: assignment.mode, dueAt: assignment.dueAt,
      durationMin: assignment.durationMin,
      status: assignment.status, createdAt: assignment.createdAt,
      paper: assignment.paper,
      languagePaper: assignment.languagePaper,
      targets: assignment.targets.map((t) => ({
        studentId: t.studentId, name: t.student.name, email: t.student.email,
        status: t.status, submittedAt: t.submittedAt, lateSubmit: t.lateSubmit,
        answeredCount: t.sessionId ? (answeredMap[t.sessionId] ?? 0) : 0,
        total: t.sessionId ? (totalMap[t.sessionId] ?? 0) : 0,
      })),
    });
  })
);

// GET /api/teacher/assignments/:id/students/:studentId/wrongs — 某学生在该作业中的错题
router.get(
  "/assignments/:id/students/:studentId/wrongs",
  asyncHandler(async (req, res) => {
    const assignment = await prisma.assignment.findUnique({
      where: { id: req.params.id },
      select: { id: true, teacherId: true, paperId: true, languagePaperId: true },
    });
    if (!assignment || assignment.teacherId !== req.user.id) return fail(res, 404, "作业不存在");
    const target = await prisma.assignmentStudent.findUnique({
      where: { assignmentId_studentId: { assignmentId: assignment.id, studentId: req.params.studentId } },
    });
    if (!target) return fail(res, 404, "该学生不在此作业分发范围内");

    const questions = [];
    if (assignment.paperId) {
      const session = await prisma.session.findFirst({
        where: { assignmentId: assignment.id, studentId: req.params.studentId },
        select: { id: true },
        orderBy: { startedAt: "desc" },
      });
      if (session) {
        const records = await prisma.answerRecord.findMany({
          where: { sessionId: session.id, isCorrect: false },
          include: {
            question: {
              select: {
                id: true, subject: true, sourceType: true, type: true,
                stem: true, options: true, answer: true, solution: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        });
        for (const r of records) {
          questions.push({
            id: r.question.id,
            subject: r.question.subject,
            sourceType: r.question.sourceType,
            qType: r.question.type,
            stem: r.question.stem,
            options: parseJsonArray(r.question.options),
            answer: r.question.answer,
            solution: r.question.solution,
            selected: r.selected,
          });
        }
      }
    } else if (assignment.languagePaperId) {
      const session = await prisma.languageSession.findFirst({
        where: { assignmentId: assignment.id, studentId: req.params.studentId },
        select: { id: true },
        orderBy: { startedAt: "desc" },
      });
      if (session) {
        const records = await prisma.languageAnswerRecord.findMany({
          where: { sessionId: session.id, isCorrect: false },
          include: {
            question: {
              select: {
                id: true, examType: true, skill: true, qType: true,
                stem: true, options: true, answer: true, solution: true,
              },
            },
          },
          orderBy: { createdAt: "asc" },
        });
        for (const r of records) {
          questions.push({
            id: r.question.id,
            examType: r.question.examType,
            skill: r.question.skill,
            qType: r.question.qType,
            stem: r.question.stem,
            options: parseJsonArray(r.question.options),
            answer: r.question.answer,
            solution: r.question.solution,
            selected: r.selected,
          });
        }
      }
    }
    ok(res, { questions });
  })
);

// GET /api/teacher/stats/overview — 班级学情总览(学生数/刷题量/薄弱知识点 TOP)
router.get(
  "/stats/overview",
  asyncHandler(async (req, res) => {
    const [students, pendingCount, sessions, records] = await Promise.all([
      prisma.user.count({ where: { role: "STUDENT", status: "APPROVED" } }),
      prisma.user.count({ where: { role: "STUDENT", status: "PENDING" } }),
      prisma.session.count({ where: { submittedAt: { not: null } } }),
      prisma.answerRecord.findMany({
        where: { isCorrect: { not: null } },
        include: { question: { select: { topic: true } } },
      }),
    ]);
    const agg = new Map();
    for (const r of records) {
      const t = r.question.topic || "未分类";
      const item = agg.get(t) || { topic: t, attempts: 0, correct: 0 };
      item.attempts += 1;
      if (r.isCorrect) item.correct += 1;
      agg.set(t, item);
    }
    ok(res, {
      students,
      pendingCount,
      sessions,
      totalAnswered: records.length,
      byTopic: [...agg.values()]
        .map(({ topic, attempts, correct }) => ({ topic, attempts, correctRate: attempts ? Math.round((correct / attempts) * 100) : 0 }))
        .sort((a, b) => a.correctRate - b.correctRate),
    });
  })
);

/* ============ 学生原创题审核 ============ */
// GET /api/teacher/student-questions — 学生原创题列表(含出题学生姓名),?status= 过滤
router.get(
  "/student-questions",
  asyncHandler(async (req, res) => {
    const status = req.query.status ? String(req.query.status) : "PENDING_REVIEW";
    const list = await prisma.question.findMany({
      where: { source: "学生原创题", status },
      orderBy: { createdAt: "desc" },
    });
    const userIds = [...new Set(list.map((q) => q.createdBy).filter(Boolean))];
    const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true, email: true } });
    const userMap = new Map(users.map((u) => [u.id, u]));
    ok(res, {
      list: list.map((q) => ({
        id: q.id,
        subject: q.subject,
        topic: q.topic,
        difficulty: q.difficulty,
        stem: q.stem,
        options: parseJsonArray(q.options),
        answer: q.answer,
        solution: q.solution,
        status: q.status,
        reviewNote: q.reviewNote,
        createdAt: q.createdAt,
        studentName: userMap.get(q.createdBy)?.name || "未知",
        studentEmail: userMap.get(q.createdBy)?.email || "",
      })),
    });
  })
);

// POST /api/teacher/student-questions/batch-approve — 批量通过(入库,PUBLISHED)
router.post(
  "/student-questions/batch-approve",
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) return fail(res, 400, "请选择要通过的题目");
    const r = await prisma.question.updateMany({
      where: { id: { in: ids }, source: "学生原创题", status: "PENDING_REVIEW" },
      data: { status: "PUBLISHED", reviewedBy: req.user.id, reviewedAt: new Date(), reviewNote: null },
    });
    ok(res, null, `已通过 ${r.count} 题并入题库`);
  })
);

// POST /api/teacher/student-questions/batch-reject — 批量驳回
router.post(
  "/student-questions/batch-reject",
  asyncHandler(async (req, res) => {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) return fail(res, 400, "请选择要驳回的题目");
    const reason = String(req.body?.reason || "").trim() || "未说明原因";
    const r = await prisma.question.updateMany({
      where: { id: { in: ids }, source: "学生原创题", status: "PENDING_REVIEW" },
      data: { status: "REJECTED", reviewedBy: req.user.id, reviewedAt: new Date(), reviewNote: reason },
    });
    ok(res, null, `已驳回 ${r.count} 题`);
  })
);

// POST /api/teacher/student-questions/:id/approve — 单题通过
router.post(
  "/student-questions/:id/approve",
  asyncHandler(async (req, res) => {
    const r = await prisma.question.updateMany({
      where: { id: req.params.id, source: "学生原创题", status: "PENDING_REVIEW" },
      data: { status: "PUBLISHED", reviewedBy: req.user.id, reviewedAt: new Date(), reviewNote: null },
    });
    if (!r.count) return fail(res, 404, "题目不存在或状态已变更");
    ok(res, null, "已通过并入题库");
  })
);

// POST /api/teacher/student-questions/:id/reject — 单题驳回(带原因)
router.post(
  "/student-questions/:id/reject",
  asyncHandler(async (req, res) => {
    const reason = String(req.body?.reason || "").trim() || "未说明原因";
    const r = await prisma.question.updateMany({
      where: { id: req.params.id, source: "学生原创题", status: "PENDING_REVIEW" },
      data: { status: "REJECTED", reviewedBy: req.user.id, reviewedAt: new Date(), reviewNote: reason },
    });
    if (!r.count) return fail(res, 404, "题目不存在或状态已变更");
    ok(res, null, "已驳回");
  })
);

export default router;
