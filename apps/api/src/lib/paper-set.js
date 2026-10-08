// 套题自动组卷 + 试卷就绪度
//
// 设计要点:
// 1) 题目录入时若带 `paper`(如 "Paper 1"),同一 subject+paper+source 的题会被视为「一套题」,
//    自动 upsert 成一张试卷。sourceKey 保证同一套真题分多次导入时并入同一张卷,而不是重复建卷。
// 2) 自动成卷 ≠ 自动发布。试卷 status 由卷内每道题的审核状态推导:
//    只有「每道题都 PUBLISHED」才置为 READY,学生才看得到、才能作答。
//    任何一次审核(通过/驳回)、题目增删改,都要调用 recalcPapersOfQuestion 重算,避免状态漂移。
import { prisma } from "./db.js";

export const MIN_SET_SIZE = 2; // 少于 2 道不视为套题(单题不必成卷)

// 判断来源是否为官方原版套题(用于 Paper.kind 打标)。
// 官方原版:source 含「真题」或为「PDF 导入」等;自编/手动组卷则为 CUSTOM。
export function isOfficialSource(source) {
  const s = String(source || "");
  return /真题|官方|PDF 导入|Official|Past Paper/i.test(s);
}

export function setKeyOf({ subject, paper, source }) {
  return [subject || "", paper || "", source || ""].join("::");
}

function titleOf({ subject, paper, source }) {
  // 避免 "TMUA 2016 Paper 1 · Paper 1" 这类重复
  if (!source) return `${subject} ${paper}`;
  if (paper && source.includes(paper)) return source;
  if (paper && paper.includes(source)) return paper;
  return `${source} · ${paper}`;
}

export function parseIds(paper) {
  try {
    const arr = JSON.parse(paper?.questionIds || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

// 统计一张卷内题目的审核分布
export async function paperStats(paper) {
  const ids = parseIds(paper);
  const qs = ids.length
    ? await prisma.question.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } })
    : [];
  const c = { PUBLISHED: 0, PENDING_REVIEW: 0, REJECTED: 0, DRAFT: 0, ARCHIVED: 0 };
  for (const q of qs) if (c[q.status] !== undefined) c[q.status]++;
  return {
    total: ids.length,
    published: c.PUBLISHED,
    pending: c.PENDING_REVIEW,
    rejected: c.REJECTED,
    draft: c.DRAFT,
    archived: c.ARCHIVED,
    missing: ids.length - qs.length, // 题目已被删除,卷内引用失效
  };
}

// 由题目状态推导试卷状态(ARCHIVED 是人工下架,不被自动覆盖)
export function deriveStatus(stats, current) {
  if (current === "ARCHIVED") return "ARCHIVED";
  return stats.total > 0 && stats.published === stats.total ? "READY" : "DRAFT";
}

// 重算单张试卷状态,返回 { stats, status }
export async function recalcPaper(paperId) {
  const paper = await prisma.paper.findUnique({ where: { id: paperId } });
  if (!paper) return null;
  const stats = await paperStats(paper);
  const status = deriveStatus(stats, paper.status);
  if (status !== paper.status) {
    await prisma.paper.update({ where: { id: paper.id }, data: { status } });
  }
  return { stats, status };
}

// 某道题状态变化后,重算所有引用它的试卷
// questionIds 存的是 JSON 字符串,用 contains 反查即可(id 为 cuid,不会误命中)
export async function recalcPapersOfQuestion(questionId) {
  if (!questionId) return [];
  const papers = await prisma.paper.findMany({
    where: { questionIds: { contains: questionId } },
    select: { id: true },
  });
  const out = [];
  for (const p of papers) {
    const r = await recalcPaper(p.id);
    if (r) out.push({ paperId: p.id, ...r });
  }
  return out;
}

// 批量导入/单题录入后:把「成套」的题目自动组成试卷
// created: [{ id, subject, paper, source }] — 本次新增的题
// options: { mode, durationMin, title, minSetSize }
// 返回 [{ id, paperId, title, action: "created"|"merged", added, total, status }]
//
// 分组口径以「库中同 subject+paper+source 的全部题目」为准,而不是只看本次新增的几条。
// 这样老师一条条手动录入同一套真题时,第 2 条进来就能自动并成一张完整的卷,
// 顺序按 createdAt 保持与录入顺序一致。
export async function syncAutoPaperSets(created, options = {}) {
  const minSize = Number(options.minSetSize) || MIN_SET_SIZE;
  const groups = new Map();
  for (const q of created) {
    if (!q.paper) continue; // 没有 paper 字段 = 散题,不成卷
    const key = setKeyOf(q);
    if (!groups.has(key)) {
      groups.set(key, { subject: q.subject, paper: q.paper, source: q.source || null, sourceType: q.sourceType || null, ids: [] });
    }
  }

  const results = [];
  const single = groups.size === 1; // 只有一组时,允许调用方用 title/mode/durationMin 覆盖
  for (const [key, g] of groups) {
    const full = await prisma.question.findMany({
      where: { subject: g.subject, paper: g.paper, source: g.source },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    g.ids = full.map((q) => q.id);
    if (g.ids.length < minSize) continue;
    const existing = await prisma.paper.findUnique({ where: { sourceKey: key } });
    const mode = options.mode === "EXAM" ? "EXAM" : options.mode === "PRACTICE" ? "PRACTICE" : null;
    const durationMin = Number(options.durationMin) || null;

    if (existing) {
      const old = parseIds(existing);
      const merged = [...old, ...g.ids.filter((id) => !old.includes(id))];
      const added = merged.length - old.length;
      await prisma.paper.update({
        where: { id: existing.id },
        data: {
          questionIds: JSON.stringify(merged),
          ...(g.sourceType ? { sourceType: g.sourceType } : {}),
          ...(mode ? { mode } : {}),
          ...(durationMin ? { durationMin } : {}),
        },
      });
      const r = await recalcPaper(existing.id);
      results.push({ id: existing.id, paperId: existing.id, title: existing.title, action: "merged", added, total: merged.length, status: r?.status });
    } else {
      // kind:显式传入优先;否则按来源判断——PDF 导入/真题通常为官方原版套题
      const kind = options.kind || (isOfficialSource(g.source) ? "OFFICIAL" : "CUSTOM");
      const paper = await prisma.paper.create({
        data: {
          title: (single && options.title) || titleOf(g),
          subject: g.subject,
          sourceType: g.sourceType,
          mode: mode || (durationMin ? "EXAM" : "PRACTICE"),
          durationMin,
          questionIds: JSON.stringify(g.ids),
          source: g.source,
          origin: "AUTO_SET",
          kind,
          sourceKey: key,
          status: "DRAFT", // 新套题必然全是待审核,先置 DRAFT,审核完成后由 recalcPaper 自动转 READY
        },
      });
      const r = await recalcPaper(paper.id);
      results.push({ id: paper.id, paperId: paper.id, title: paper.title, action: "created", added: g.ids.length, total: g.ids.length, status: r?.status });
    }
  }
  return results;
}
