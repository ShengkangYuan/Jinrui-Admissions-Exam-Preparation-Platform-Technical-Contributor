import { Router } from "express";
import { prisma } from "../lib/db.js";
import { ok, fail, asyncHandler } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { parseIds, recalcPaper } from "../lib/paper-set.js";
import { buildSubjectFilter } from "../lib/subject-filter.js";
import { applyTeacherPerms, expandSourceType } from "../lib/teacherPerms.js";

const router = Router();

function parseJsonIds(str) {
  if (!str) return [];
  try {
    const v = JSON.parse(str);
    return Array.isArray(v) ? v.filter(id => id != null) : [];
  } catch {
    return [];
  }
}

// 一次性算出多张卷的审核分布,避免逐卷查库(N+1)
async function statsForPapers(papers) {
  const allIds = [...new Set(papers.flatMap((p) => parseIds(p)))];
  const rows = allIds.length
    ? await prisma.question.findMany({ where: { id: { in: allIds } }, select: { id: true, status: true } })
    : [];
  const statusOf = new Map(rows.map((r) => [r.id, r.status]));
  const out = new Map();
  for (const p of papers) {
    const ids = parseIds(p);
    const c = { PUBLISHED: 0, PENDING_REVIEW: 0, REJECTED: 0, DRAFT: 0, ARCHIVED: 0 };
    let missing = 0;
    for (const id of ids) {
      const s = statusOf.get(id);
      if (!s) missing++;
      else if (c[s] !== undefined) c[s]++;
    }
    out.set(p.id, {
      total: ids.length,
      published: c.PUBLISHED,
      pending: c.PENDING_REVIEW,
      rejected: c.REJECTED,
      draft: c.DRAFT,
      archived: c.ARCHIVED,
      missing,
    });
  }
  return out;
}

// POST /api/papers/generate — 组卷(老师/管理员)
router.post(
  "/generate",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const { title, subject, sourceTypes, topics, difficulties, count } = req.body || {};
    if (!title || !subject) return fail(res, 400, "title、subject 必填");
    const where = { status: "PUBLISHED" };
    Object.assign(where, buildSubjectFilter(subject));
    // 题源多选:sourceTypes 数组非空时限定题目题源
    // ESAT 家族展开:勾选 ESAT 时同时纳入 ENGAA / NSAA 的题(不改数据库原始值)
    if (Array.isArray(sourceTypes) && sourceTypes.length) {
      const sts = [...new Set(
        sourceTypes.flatMap((s) => expandSourceType(String(s).trim())).filter(Boolean)
      )];
      if (sts.length) where.sourceType = { in: sts };
    }
    if (Array.isArray(topics) && topics.length) {
      const selectedNames = new Set(topics.map((t) => String(t).trim()).filter(Boolean));
      const selectedKps = await prisma.knowledgePoint.findMany({
        where: { subject, name: { in: [...selectedNames] } },
        select: { id: true },
      });
      const selectedIds = selectedKps.map((k) => k.id);
      if (selectedIds.length === 0) {
        return fail(res, 400, `选择的知识点不存在或不属于科目「${subject}」。`);
      }
      // topicIds 是 JSON 字符串，用 OR + contains 匹配任一选中的知识点 id
      where.OR = selectedIds.map((id) => ({ topicIds: { contains: id } }));
    }
    if (Array.isArray(difficulties) && difficulties.length) where.difficulty = { in: difficulties.map(Number) };
    const total = Math.max(1, Number(count) || 10);
    const all = await prisma.question.findMany({ where, select: { id: true } });
    if (all.length === 0) {
      // 逐层回溯,精确告诉老师是哪个条件把题目筛空了
      const subjectPool = await prisma.question.findMany({
        where: { status: "PUBLISHED", subject },
        select: { topicIds: true, difficulty: true },
      });
      if (subjectPool.length === 0) {
        const others = await prisma.question.groupBy({
          by: ["subject"],
          where: { status: "PUBLISHED" },
          _count: { _all: true },
        });
        const hint = others.length
          ? `目前有已发布题目的科目:${others.map((o) => `${o.subject}(${o._count._all}道)`).join("、")}`
          : "题库中还没有任何已发布题目,请先到「题库管理」审核通过题目";
        return fail(res, 400, `科目「${subject}」下没有已发布的题目。${hint}`);
      }
      const availTopicIds = new Set();
      for (const q of subjectPool) {
        for (const id of parseJsonIds(q.topicIds)) availTopicIds.add(id);
      }
      const availKps = await prisma.knowledgePoint.findMany({
        where: { subject, id: { in: [...availTopicIds] } },
        select: { name: true },
      });
      const availTopics = availKps.map((k) => k.name);
      const availDiffs = [...new Set(subjectPool.map((q) => q.difficulty).filter((d) => d != null))].sort((a, b) => a - b);
      const parts = [];
      if (where.OR) parts.push(`知识点(可选:${availTopics.join("、") || "无"})`);
      if (where.difficulty) parts.push(`难度(可选:${availDiffs.join("、") || "无"})`);
      return fail(
        res,
        400,
        `科目「${subject}」有 ${subjectPool.length} 道已发布题目,但被${parts.join("和")}筛选条件排除了。请放宽或清空这些条件。`
      );
    }
    const picked = all.sort(() => Math.random() - 0.5).slice(0, Math.min(total, all.length));
    const paper = await prisma.paper.create({
      data: {
        title,
        subject,
        // 手动组卷的卷题源:只选了一个题源时带上,多选/不选留空(可在详情设置里改)
        sourceType: Array.isArray(sourceTypes) && sourceTypes.length === 1 ? String(sourceTypes[0]).trim() : null,
        questionIds: JSON.stringify(picked.map((q) => q.id)),
        origin: "MANUAL",
        kind: "CUSTOM", // 手动组卷 = 组卷套题
      },
    });
    // 手动组卷只从已发布题目中抽取,推导后应为 READY;仍走一遍重算保证口径统一
    await recalcPaper(paper.id);
    ok(res, {
      id: paper.id, title: paper.title, subject: paper.subject,
      questionCount: picked.length,
    }, "组卷成功");
  })
);

// GET /api/papers — 试卷列表
// 学生:只返回 READY(卷内每道题都已审核发布)的卷
// 老师:返回全部,并附带审核进度统计,便于判断还差多少题没审
router.get(
  "/",
  requireAuth,
  asyncHandler(async (req, res) => {
    const isTeacher = ["TEACHER", "ADMIN"].includes(req.user.role);
    // 共享卷库不含学生自建卷(origin=STUDENT),学生自建卷只在「我的试卷」(/papers/mine)里出现
    const where = isTeacher ? { origin: { not: "STUDENT" } } : { status: "READY", origin: { not: "STUDENT" } };
    if (isTeacher && req.query.status) where.status = String(req.query.status);
    if (isTeacher && req.query.origin) where.origin = String(req.query.origin);
    // 按学科筛选(老师可用;学生端默认只看已开放卷,不受此影响)
    if (isTeacher && req.query.subject) where.subject = String(req.query.subject);
    // 套题类型筛选:OFFICIAL 官方原版 / CUSTOM 组卷套题
    if (isTeacher && req.query.kind) where.kind = String(req.query.kind);
    // 教师可见范围权限:仅当 role=TEACHER 且配置了白名单时,将列表限制为白名单内
    applyTeacherPerms(where, req.user);
    // 不再限制 take:老师端「试卷管理」需要全量列表来做 Tab 计数与前端分页;
    // 学生端只返回 READY 卷,数量本就有限,不受此影响
    const list = await prisma.paper.findMany({ where, orderBy: { createdAt: "desc" } });

    if (!isTeacher) {
      return ok(res, {
        list: list.map((p) => ({
          id: p.id, title: p.title, subject: p.subject, sourceType: p.sourceType,
          questionCount: parseIds(p).length, createdAt: p.createdAt,
          kind: p.kind, origin: p.origin, source: p.source,
        })),
      });
    }
    const statsMap = await statsForPapers(list);
    ok(res, {
      list: list.map((p) => {
        const stats = statsMap.get(p.id);
        return {
          id: p.id, title: p.title, subject: p.subject, sourceType: p.sourceType,
          questionCount: stats.total,
          source: p.source, origin: p.origin, kind: p.kind, status: p.status,
          stats, createdAt: p.createdAt,
        };
      }),
    });
  })
);

// GET /api/papers/facets — 组卷可选项(必须在 /:id 之前注册,否则会被当作 id 匹配)
// 返回各科目已发布题数 + 指定科目下真实存在的知识点/难度,供前端渲染成可点选项
router.get(
  "/facets",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const subject = req.query.subject || undefined;
    const bySubject = await prisma.question.groupBy({
      by: ["subject"],
      where: { status: "PUBLISHED" },
      _count: { _all: true },
    });
    const subjects = bySubject
      .map((s) => ({ subject: s.subject, count: s._count._all }))
      .sort((a, b) => b.count - a.count);

    let topics = [];
    let difficulties = [];
    let combos = [];
    let total = 0;
    if (subject) {
      // 多值知识点：一道题可归属多个知识点，计数与筛选都应基于 topicIds 展开
      const kps = await prisma.knowledgePoint.findMany({
        where: { subject },
        select: { id: true, name: true },
      });
      const kpNameById = new Map(kps.map((k) => [k.id, k.name]));
      const pool = await prisma.question.findMany({
        where: { status: "PUBLISHED", subject },
        select: { topicIds: true, difficulty: true },
      });
      total = pool.length;
      const tMap = new Map();
      const dMap = new Map();
      const cMap = new Map();
      for (const q of pool) {
        const ids = parseJsonIds(q.topicIds).filter((id) => kpNameById.has(id));
        for (const id of ids) {
          const name = kpNameById.get(id);
          tMap.set(name, (tMap.get(name) || 0) + 1);
          if (q.difficulty != null) {
            const key = `${name}\u0000${q.difficulty}`;
            cMap.set(key, (cMap.get(key) || 0) + 1);
          }
        }
        if (q.difficulty != null) dMap.set(q.difficulty, (dMap.get(q.difficulty) || 0) + 1);
      }
      topics = [...tMap.entries()]
        .map(([topic, count]) => ({ topic, count }))
        .sort((a, b) => a.topic.localeCompare(b.topic));
      difficulties = [...dMap.entries()].map(([difficulty, count]) => ({ difficulty, count })).sort((a, b) => a.difficulty - b.difficulty);
      // combos 供前端精确预览「当前知识点+难度组合」能匹配多少题
      combos = [...cMap.entries()].map(([key, count]) => {
        const [t, d] = key.split("\u0000");
        return { topic: t || null, difficulty: d === "" ? null : Number(d), count };
      });
    }
    ok(res, { subjects, subject: subject || null, total, topics, difficulties, combos });
  })
);

// ——— 学生自建卷(我的试卷,origin=STUDENT,仅创建者可见) ———
// GET /api/papers/mine — 我的试卷列表(自建卷 + 从试卷库收藏的副本)
router.get(
  "/mine",
  requireAuth,
  asyncHandler(async (req, res) => {
    const list = await prisma.paper.findMany({
      where: { origin: "STUDENT", createdBy: req.user.id },
      orderBy: { createdAt: "desc" },
    });
    ok(res, {
      list: list.map((p) => {
        // 收藏副本:sourceKey 形如 collect:<原卷id>:<学生id>
        let collectedFrom = null;
        if (p.sourceKey && p.sourceKey.startsWith("collect:")) {
          const parts = p.sourceKey.split(":");
          collectedFrom = parts[1] || null;
        }
        return {
          id: p.id,
          title: p.title,
          subject: p.subject,
          questionCount: parseIds(p).length,
          source: p.source,
          createdAt: p.createdAt,
          collectedFrom,
        };
      }),
    });
  })
);

// POST /api/papers/mine/collect — 把试卷库中的套卷收藏到「我的试卷」
// 生成一份个人副本(origin=STUDENT,sourceKey 唯一键),同一套卷每个学生只能收藏一次
router.post(
  "/mine/collect",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { paperId } = req.body || {};
    if (!paperId) return fail(res, 400, "缺少试卷参数");
    const paper = await prisma.paper.findUnique({ where: { id: paperId } });
    if (!paper || paper.origin === "STUDENT") return fail(res, 404, "试卷不存在");
    if (paper.status !== "READY") return fail(res, 400, "该试卷尚未「可作答」,暂不能收藏");
    const key = `collect:${paper.id}:${req.user.id}`;
    const existed = await prisma.paper.findFirst({ where: { sourceKey: key } });
    if (existed) return fail(res, 400, "该套卷已在你的「我的试卷」中");
    const copy = await prisma.paper.create({
      data: {
        title: paper.title,
        subject: paper.subject,
        sourceType: paper.sourceType,
        questionIds: paper.questionIds,
        source: "收藏自试卷库",
        origin: "STUDENT",
        kind: paper.kind === "OFFICIAL" ? "OFFICIAL" : "CUSTOM",
        status: "READY",
        createdBy: req.user.id,
        sourceKey: key,
      },
    });
    ok(res, { id: copy.id }, `已将「${paper.title}」加入「我的试卷」`);
  })
);

// POST /api/papers/student — 学生自建卷(随机组卷 / 错题组卷),仅创建者可见
router.post(
  "/student",
  requireAuth,
  asyncHandler(async (req, res) => {
    const { title, source, subject, knowledgePointId, difficulty, count, topics } = req.body || {};
    const sourceKind = source === "wrongbook" ? "wrongbook" : "random";

    let picked = [];
    if (sourceKind === "wrongbook") {
      // 从学生错题本中选已发布题目(支持按科目 / 知识点多选过滤)
      const wb = await prisma.wrongBook.findMany({
        where: { studentId: req.user.id },
        include: { question: { select: { id: true, subject: true, status: true, topic: true, topicIds: true } } },
      });
      let list = wb.map((w) => w.question).filter((q) => q.status === "PUBLISHED");
      if (subject) list = list.filter((q) => q.subject === subject);
      if (Array.isArray(topics) && topics.length) {
        const selected = new Set(topics.map((t) => String(t).trim()).filter(Boolean));
        const kps = await prisma.knowledgePoint.findMany({ select: { id: true, name: true } });
        const kpNameById = new Map(kps.map((k) => [k.id, k.name]));
        list = list.filter((q) => {
          if (selected.has(q.topic)) return true;
          try {
            const qIds = JSON.parse(q.topicIds || "[]");
            return qIds.some((id) => selected.has(kpNameById.get(id)));
          } catch {
            return false;
          }
        });
      }
      if (list.length === 0) return fail(res, 400, "当前筛选条件下错题本中没有可组卷的已发布题目");
      const n = Number(count);
      picked = (n && n > 0 ? list.sort(() => Math.random() - 0.5).slice(0, n) : list).map((q) => q.id);
    } else {
      // 随机组卷:已发布题目 + 筛选(TMUA/ESAT 按 sourceType 过滤)
      const where = { status: "PUBLISHED" };
      Object.assign(where, buildSubjectFilter(subject));
      if (knowledgePointId) where.topicIds = { contains: String(knowledgePointId) };
      if (difficulty) where.difficulty = Number(difficulty);
      const all = await prisma.question.findMany({ where, select: { id: true } });
      if (all.length === 0) return fail(res, 400, "当前条件下没有可组卷的已发布题目,请调整筛选条件");
      const n = Math.min(Math.max(Number(count) || 10, 1), 50);
      picked = all.sort(() => Math.random() - 0.5).slice(0, n).map((q) => q.id);
    }
    if (picked.length < 2) return fail(res, 400, "组卷题目不足(至少 2 道)");

    // 推断学科:优先用户选择,否则取多数
    const qs = await prisma.question.findMany({ where: { id: { in: picked } }, select: { subject: true } });
    const bySubj = new Map();
    for (const q of qs) bySubj.set(q.subject, (bySubj.get(q.subject) || 0) + 1);
    const subj = subject || [...bySubj.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";

    const paper = await prisma.paper.create({
      data: {
        title: String(title || "").trim() || `${sourceKind === "wrongbook" ? "错题组卷" : "随机组卷"} ${new Date().toLocaleString("zh-CN", { hour12: false })}`,
        subject: subj,
        sourceType: null,
        questionIds: JSON.stringify(picked),
        source: sourceKind === "wrongbook" ? "我的错题" : "学生自建·随机",
        origin: "STUDENT",
        kind: "CUSTOM",
        status: "READY",
        createdBy: req.user.id,
      },
    });
    ok(res, { id: paper.id }, `已生成「${paper.title}」(${picked.length} 题),保存在「我的试卷」`);
  })
);

// DELETE /api/papers/mine/:id — 删除自己的试卷(仅限本人,且无作答记录)
router.delete(
  "/mine/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
    if (!paper || paper.origin !== "STUDENT" || paper.createdBy !== req.user.id) return fail(res, 404, "试卷不存在");
    const used = await prisma.session.count({ where: { paperId: paper.id } });
    if (used > 0) return fail(res, 400, "该试卷已有作答记录,不能删除");
    await prisma.paper.delete({ where: { id: paper.id } });
    ok(res, null, "试卷已删除");
  })
);

// GET /api/papers/:id/manage — 试卷管理视图(老师):逐题列出内容与审核状态
router.get(
  "/:id/manage",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
    if (!paper) return fail(res, 404, "试卷不存在");
    const ids = parseIds(paper);
    const rows = ids.length
      ? await prisma.question.findMany({
          where: { id: { in: ids } },
          select: {
            id: true, subject: true, paper: true, topic: true, difficulty: true, type: true,
            stem: true, options: true, answer: true, solution: true, status: true, reviewNote: true, source: true,
          },
        })
      : [];
    const map = new Map(rows.map((q) => [q.id, q]));
    const stats = (await statsForPapers([paper])).get(paper.id);
    ok(res, {
      id: paper.id, title: paper.title, subject: paper.subject,
      source: paper.source, origin: paper.origin,
      status: paper.status, createdAt: paper.createdAt, stats,
      // 保持录入顺序;题目被删除时给出占位,方便老师发现卷内引用失效
      questions: ids.map((id, i) => {
        const q = map.get(id);
        if (!q) return { id, index: i + 1, missing: true };
        return { ...q, options: safeParse(q.options), index: i + 1, missing: false };
      }),
    });
  })
);

function safeParse(v) {
  if (Array.isArray(v)) return v;
  try {
    const a = JSON.parse(v || "[]");
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

// PATCH /api/papers/:id — 编辑试卷(改名/换科目/换模式/调限时/上下架/移除题目)
router.patch(
  "/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
    if (!paper) return fail(res, 404, "试卷不存在");
    const b = req.body || {};
    const data = {};
    if (typeof b.title === "string" && b.title.trim()) data.title = b.title.trim();
    // 科目:只接受合法科目(兼容历史 TMUA/ESAT 值,迁移后应使用四科);更新 subject 时同步 sourceKey(subject::paper::source)
    const VALID_SUBJECTS = ["TMUA", "ESAT", "数学", "物理", "化学", "生物"];
    if (typeof b.subject === "string" && VALID_SUBJECTS.includes(b.subject)) data.subject = b.subject;
    // 题源/试卷类型:TMUA/ESAT/NSAA/其他,可设 null 清空
    if (b.sourceType !== undefined) data.sourceType = b.sourceType ? String(b.sourceType).trim() : null;
    if (Array.isArray(b.questionIds)) data.questionIds = JSON.stringify(b.questionIds);
    // 只允许人工在 ARCHIVED 与自动推导状态之间切换,READY 不可手动设置(必须靠逐题审核挣得)
    if (b.status === "ARCHIVED") data.status = "ARCHIVED";
    if (b.status === "ACTIVE" && paper.status === "ARCHIVED") data.status = "DRAFT";
    // 改科目时检查 sourceKey 冲突,避免与已有套卷撞唯一键
    if (data.subject && paper.sourceKey) {
      const [, p, s] = paper.sourceKey.split("::");
      const newKey = [data.subject, p, s].join("::");
      if (newKey !== paper.sourceKey) {
        const clash = await prisma.paper.findUnique({ where: { sourceKey: newKey } });
        if (clash) return fail(res, 400, `已存在「${clash.title}」套卷(${newKey}),改科目会与之冲突。可先删除/改名该卷再操作。`);
      }
      data.sourceKey = newKey;
    }
    const updated = await prisma.paper.update({ where: { id: paper.id }, data });
    const r = await recalcPaper(updated.id); // 移除题目/恢复上架后重新推导就绪度
    ok(res, { ...updated, status: r?.status ?? updated.status, stats: r?.stats }, "试卷已更新");
  })
);

// DELETE /api/papers/:id — 删除试卷(题目本身保留在题库中)
router.delete(
  "/:id",
  requireAuth,
  requireRole("TEACHER", "ADMIN"),
  asyncHandler(async (req, res) => {
    const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
    if (!paper) return fail(res, 404, "试卷不存在");
    const used = await prisma.session.count({ where: { paperId: paper.id } });
    if (used > 0) {
      return fail(res, 400, `该试卷已有 ${used} 条学生作答记录,不能删除。可改为「下架」,学生将不再看到它。`);
    }
    await prisma.paper.delete({ where: { id: paper.id } });
    ok(res, null, "试卷已删除(卷内题目仍保留在题库中)");
  })
);

// GET /api/papers/:id — 试卷详情(题目不含答案,顺序保持)
// 学生只能取到 READY 的卷,避免未审核完的套题被提前作答
router.get(
  "/:id",
  requireAuth,
  asyncHandler(async (req, res) => {
    const paper = await prisma.paper.findUnique({ where: { id: req.params.id } });
    if (!paper) return fail(res, 404, "试卷不存在");
    const isTeacher = ["TEACHER", "ADMIN"].includes(req.user.role);
    // 学生自建卷仅创建者本人可见
    if (paper.origin === "STUDENT" && paper.createdBy !== req.user.id) {
      return fail(res, 403, "这不是您的试卷");
    }
    if (!isTeacher && paper.status !== "READY") {
      return fail(res, 403, "该试卷尚未全部通过审核,暂不可作答");
    }
    const ids = parseIds(paper);
    const questions = await prisma.question.findMany({
      where: { id: { in: ids }, status: "PUBLISHED" },
      select: { id: true, subject: true, topic: true, difficulty: true, type: true, stem: true, options: true, source: true },
    });
    const map = new Map(questions.map((q) => [q.id, q]));
    ok(res, {
      id: paper.id, title: paper.title, subject: paper.subject,
      questionCount: ids.length, status: paper.status,
      questions: ids.map((id) => map.get(id)).filter(Boolean),
    });
  })
);

export default router;
