"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import QuestionEditModal from "@/components/QuestionEditModal";
import { renderRich, plainText } from "@/lib/rich";
import { isAnswerOption, letterToOption } from "@/lib/answer";
import { isEsatFamily, expandEsatFilters, showEsatFamilyBadge } from "@/lib/sourceFamily";
import type { PaperManageDetail, PaperManageQuestion, PaperRow, PaperStats, Question } from "@/lib/types";

interface Facets {
  subjects: { subject: string; count: number }[];
  subject: string | null;
  total: number;
  topics: { topic: string; count: number }[];
  difficulties: { difficulty: number; count: number }[];
  combos: { topic: string | null; difficulty: number | null; count: number }[];
}

const SUBJECT_OPTIONS = ["数学", "物理", "化学", "生物"];
// 手动组卷可选的题源(TMUA/ESAT/NSAA...);可多选,不选 = 全部题源
const SOURCE_TYPE_OPTIONS = ["TMUA", "ESAT"];
const DIFF_LABEL: Record<number, string> = { 1: "入门", 2: "基础", 3: "中等", 4: "较难", 5: "困难" };

const PAPER_STATUS_LABEL: Record<string, string> = {
  READY: "可作答",
  DRAFT: "待审核完成",
  ARCHIVED: "已下架",
};
const PAPER_STATUS_BADGE: Record<string, string> = {
  READY: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
  DRAFT: "bg-amber-50 text-amber-700 ring-1 ring-amber-200",
  ARCHIVED: "bg-slate-100 text-slate-500 ring-1 ring-slate-200",
};
const Q_STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_REVIEW: "待审核",
  PUBLISHED: "已发布",
  REJECTED: "已退回",
  ARCHIVED: "已下架",
};
const Q_STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-500",
  PENDING_REVIEW: "bg-blue-50 text-blue-600",
  PUBLISHED: "bg-emerald-50 text-emerald-600",
  REJECTED: "bg-red-50 text-red-600",
  ARCHIVED: "bg-slate-100 text-slate-400",
};

/** 审核进度条:一眼看出整卷还差多少题才能对学生开放 */
function ProgressBar({ stats }: { stats: PaperStats }) {
  const total = Math.max(1, stats.total);
  const seg = [
    { n: stats.published, cls: "bg-emerald-500", label: "已发布" },
    { n: stats.pending, cls: "bg-blue-400", label: "待审核" },
    { n: stats.rejected, cls: "bg-red-400", label: "已退回" },
    { n: stats.draft, cls: "bg-slate-300", label: "草稿" },
    { n: stats.archived + stats.missing, cls: "bg-slate-200", label: "下架/缺失" },
  ].filter((s) => s.n > 0);
  return (
    <div className="flex h-1.5 w-28 overflow-hidden rounded-full bg-slate-100">
      {seg.map((s) => (
        <div key={s.label} className={s.cls} style={{ width: `${(s.n / total) * 100}%` }} title={`${s.label} ${s.n}`} />
      ))}
    </div>
  );
}

/** 页码窗口:总页数≤7 时全显示;否则显示 首页 + 当前页前后各2 + 尾页,中间用 … 省略 */
function getPageWindow(current: number, total: number): (number | "...")[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const out: (number | "...")[] = [1];
  const start = Math.max(2, current - 2);
  const end = Math.min(total - 1, current + 2);
  if (start > 2) out.push("...");
  for (let i = start; i <= end; i++) out.push(i);
  if (end < total - 1) out.push("...");
  out.push(total);
  return out;
}

export default function TeacherPapersPage() {
  const [list, setList] = useState<PaperRow[]>([]);
  const [facets, setFacets] = useState<Facets | null>(null);
  const [form, setForm] = useState({
    title: "",
    subject: "数学",
    sourceTypes: [] as string[], // 题源多选;空 = 全部
    count: "10",
  });
  const [topics, setTopics] = useState<string[]>([]);
  const [difficulties, setDifficulties] = useState<number[]>([]);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [generating, setGenerating] = useState(false);
  const [showGenerator, setShowGenerator] = useState(false);
  const [filter, setFilter] = useState<"ALL" | "READY" | "DRAFT" | "ARCHIVED" | "AUTO_SET">("ALL");
  // 学科筛选(空 = 全部,与题库的学科 Tab 一致)
  const [subjectFilter, setSubjectFilter] = useState("");
  // 套题类型筛选(空 = 全部):OFFICIAL 官方原版套题 / CUSTOM 组卷套题(手动组卷或自编导入) / mock 模考套题
  const [kindFilter, setKindFilter] = useState<"" | "OFFICIAL" | "CUSTOM" | "mock">("");
  // 题源筛选(点选多选,空 = 全部):TMUA / ESAT
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  // 列表排序:createdDesc(最新在前,默认) / nameAsc(名称字母·数字升序) / nameDesc(降序)
  const [sortBy, setSortBy] = useState<"createdDesc" | "nameAsc" | "nameDesc">("createdDesc");
  // 试卷列表分页(前端基于已筛选的 shown 切片;筛选条件变化时页码归 1)
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // 试卷详情抽屉
  const [detail, setDetail] = useState<PaperManageDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [diffBusy, setDiffBusy] = useState<string | null>(null); // 正在修改难度的题目 id
  const [editQ, setEditQ] = useState<Question | null>(null); // 原地编辑弹窗当前题目
  // 点选选项改答案:待确认目标(题目 + 新答案选项 + 题干 + 原答案)
  const [ansTarget, setAnsTarget] = useState<{ qid: string; option: string; stem: string; oldAnswer: string } | null>(null);
  const [ansSaving, setAnsSaving] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  // 详情抽屉里的「试卷设置」草稿(科目/题源)
  const [settingsDraft, setSettingsDraft] = useState<{ subject: string; sourceType: string } | null>(null);
  // 「添加试题」弹窗:可选题目列表 / 勾选 / 弹窗内搜索 / 知识点筛选
  const [addOpen, setAddOpen] = useState(false);
  const [addList, setAddList] = useState<Question[]>([]);
  const [addTotal, setAddTotal] = useState(0);
  const [addLoading, setAddLoading] = useState(false);
  const [addSelected, setAddSelected] = useState<Set<string>>(new Set());
  const [addKeyword, setAddKeyword] = useState("");
  const [addKps, setAddKps] = useState<{ id: string; name: string }[]>([]);
  const [addKpFilter, setAddKpFilter] = useState("");
  const [addSaving, setAddSaving] = useState(false);
  // 试卷预览(不显示正确选项),及单题解析弹窗
  const [preview, setPreview] = useState<PaperManageDetail | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [solQ, setSolQ] = useState<PaperManageQuestion | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (subjectFilter) qs.set("subject", subjectFilter);
    if (kindFilter) qs.set("kind", kindFilter);
    const q = qs.toString();
    const d = await api.get<{ list: PaperRow[] }>(`/papers${q ? `?${q}` : ""}`);
    setList(d.list);
  }, [subjectFilter, kindFilter]);

  const loadFacets = useCallback(async (subject: string) => {
    const d = await api.get<Facets>(`/papers/facets?subject=${encodeURIComponent(subject)}`);
    setFacets(d);
  }, []);

  useEffect(() => {
    load().catch((e) => setError(e.message));
  }, [load]);

  // 任一筛选/排序条件变化都把页码归 1,避免停留在已无数据的页
  useEffect(() => {
    setPage(1);
  }, [subjectFilter, kindFilter, filter, sourceFilter, sortBy, pageSize]);

  // 不同套题版块采用不同默认排序:模考套题按名称 Z→A,其他按最新优先
  useEffect(() => {
    setSortBy(kindFilter === "mock" ? "nameDesc" : "createdDesc");
  }, [kindFilter]);

  // 切换科目时重新拉取可选项,并清空已选的知识点/难度(避免残留旧科目的值导致筛不到题)
  useEffect(() => {
    setTopics([]);
    setDifficulties([]);
    loadFacets(form.subject).catch((e) => setError(e.message));
  }, [form.subject, loadFacets]);

  // 依据 combos 精确预览当前条件能匹配到多少题(与后端 where 逻辑一致)
  const available = useMemo(() => {
    if (!facets) return 0;
    return facets.combos
      .filter(
        (c) =>
          (topics.length === 0 || (c.topic !== null && topics.includes(c.topic))) &&
          (difficulties.length === 0 || (c.difficulty !== null && difficulties.includes(c.difficulty)))
      )
      .reduce((s, c) => s + c.count, 0);
  }, [facets, topics, difficulties]);

  const subjectCount = useMemo(() => {
    const m: Record<string, number> = {};
    facets?.subjects.forEach((s) => (m[s.subject] = s.count));
    return m;
  }, [facets]);

  const shown = useMemo(() => {
    let arr;
    if (filter === "ALL") arr = list;
    else if (filter === "AUTO_SET") arr = list.filter((p) => p.origin === "AUTO_SET");
    else arr = list.filter((p) => (p.status ?? "READY") === filter);
    // 学科筛选(空 = 全部)
    if (subjectFilter) {
      arr = arr.filter((p) => p.subject === subjectFilter);
    }
    // 套题类型筛选(空 = 全部):OFFICIAL / CUSTOM / mock
    if (kindFilter) {
      arr = arr.filter((p) => p.kind === kindFilter);
    }
    // 题源点选筛选(多选,空 = 全部):TMUA / ESAT
    // ESAT 选中时同时匹配 ENGAA / NSAA(家族归组,不改数据库)
    if (sourceFilter.length > 0) {
      const expanded = expandEsatFilters(sourceFilter);
      arr = arr.filter((p) => p.sourceType != null && expanded.includes(p.sourceType));
    }
    if (sortBy === "nameAsc" || sortBy === "nameDesc") {
      const dir = sortBy === "nameAsc" ? 1 : -1;
      // localeCompare + numeric:true 让 "Paper 2" 排在 "Paper 10" 前,按字母/数字自然序
      arr = [...arr].sort((a, b) => dir * String(a.title).localeCompare(String(b.title), undefined, { numeric: true, sensitivity: "base" }));
    }
    // createdDesc 为默认(后端已按创建时间倒序返回,这里保持原序)
    return arr;
  }, [list, filter, subjectFilter, kindFilter, sortBy, sourceFilter]);

  const counts = useMemo(() => {
    const c = { ALL: list.length, READY: 0, DRAFT: 0, ARCHIVED: 0, AUTO_SET: 0 };
    for (const p of list) {
      const s = (p.status ?? "READY") as "READY" | "DRAFT" | "ARCHIVED";
      if (c[s] !== undefined) c[s]++;
      if (p.origin === "AUTO_SET") c.AUTO_SET++;
    }
    return c;
  }, [list]);

  // 当前筛选+排序后的总数与分页信息(基于前端已筛选的 shown,与 Tab/题源/学科筛选天然叠加)
  const totalItems = shown.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  // 当删除导致总页数变少时,把当前页夹在合法范围内,避免停在空页
  const currentPage = Math.min(page, totalPages);
  const pageItems = shown.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function toggleTopic(t: string) {
    setTopics((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  }
  function toggleDiff(d: number) {
    setDifficulties((prev) => (prev.includes(d) ? prev.filter((x) => x !== d) : [...prev, d]));
  }
  function toggleSourceType(t: string) {
    setForm((prev) => ({
      ...prev,
      sourceTypes: prev.sourceTypes.includes(t) ? prev.sourceTypes.filter((x) => x !== t) : [...prev.sourceTypes, t],
    }));
  }

  function flash(text: string) {
    setMessage(text);
    setTimeout(() => setMessage(""), 4000);
  }

  async function generate() {
    setError("");
    setMessage("");
    if (!form.title) {
      setError("请填写试卷名称");
      return;
    }
    setGenerating(true);
    try {
      const payload = {
        title: form.title,
        subject: form.subject,
        sourceTypes: form.sourceTypes,
        topics,
        difficulties,
        count: Math.max(1, Number(form.count) || 1),
      };
      const r = await api.post<{ title: string; questionCount: number }>("/papers/generate", payload);
      flash(`组卷成功:「${r.title}」共 ${r.questionCount} 题`);
      setForm((f) => ({ ...f, title: "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "组卷失败");
    } finally {
      setGenerating(false);
    }
  }

  async function openDetail(id: string) {
    setError("");
    setDetailLoading(true);
    try {
      const d = await api.get<PaperManageDetail>(`/papers/${id}/manage`);
      setDetail(d);
      setTitleDraft(d.title);
      setSettingsDraft({ subject: d.subject, sourceType: d.sourceType ?? "" });
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取试卷失败");
    } finally {
      setDetailLoading(false);
    }
  }

  // 试卷预览:复用 /manage 接口,但不渲染正确选项,只供教师按学生视角浏览
  async function openPreview(id: string) {
    setError("");
    setPreviewLoading(true);
    try {
      const d = await api.get<PaperManageDetail>(`/papers/${id}/manage`);
      setPreview(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取试卷失败");
    } finally {
      setPreviewLoading(false);
    }
  }

  // 编辑本题:原地拉取题目并弹出编辑弹窗(页面不跳转)
  async function openQuestionEdit(qid: string) {
    setError("");
    try {
      const q = await api.get<Question>(`/questions/${qid}`);
      setEditQ(q);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取题目失败");
    }
  }

  // 题目编辑保存后:刷新本地详情
  function onQuestionSaved(updated: Question) {
    setDetail((prev) =>
      prev
        ? {
            ...prev,
            questions: prev.questions.map((x) =>
              x.id === updated.id
                ? { ...x, stem: updated.stem, options: updated.options, answer: updated.answer, difficulty: updated.difficulty, topic: updated.topic, status: updated.status }
                : x
            ),
          }
        : prev
    );
    flash("题目已更新");
  }

  // 直接点选修改难度:调题目更新接口,成功后刷新本地详情
  async function setQuestionDifficulty(qid: string, d: number) {
    setError("");
    setDiffBusy(qid);
    try {
      await api.put(`/questions/${qid}`, { difficulty: d });
      flash(`已将难度改为 ${d} 星`);
      setDetail((prev) =>
        prev ? { ...prev, questions: prev.questions.map((x) => (x.id === qid ? { ...x, difficulty: d } : x)) } : prev
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "修改难度失败");
    } finally {
      setDiffBusy(null);
    }
  }

  // 点某个选项 → 弹确认框,确认后把该选项设为这道题的答案
  function openAnswerConfirm(q: { id: string; stem?: string; answer?: string; options?: string[]; missing?: boolean }, opt: string) {
    if (q.missing) return;
    setAnsTarget({ qid: q.id, option: opt, stem: q.stem || "", oldAnswer: String(q.answer || "") });
  }

  async function confirmAnswerChange() {
    if (!ansTarget) return;
    setAnsSaving(true);
    setError("");
    try {
      await api.put(`/questions/${ansTarget.qid}`, { answer: ansTarget.option });
      setDetail((prev) =>
        prev
          ? { ...prev, questions: prev.questions.map((x) => (x.id === ansTarget.qid ? { ...x, answer: ansTarget.option } : x)) }
          : prev
      );
      flash("答案已更新");
      setAnsTarget(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "修改答案失败");
    } finally {
      setAnsSaving(false);
    }
  }

  // 保存详情抽屉里的科目/题源/模式/限时修改
  async function saveSettings() {
    if (!detail || !settingsDraft) return;
    setError("");
    const body: Record<string, unknown> = {};
    if (settingsDraft.subject && settingsDraft.subject !== detail.subject) body.subject = settingsDraft.subject;
    if (settingsDraft.sourceType !== (detail.sourceType ?? "")) {
      body.sourceType = settingsDraft.sourceType || null;
    }
    if (Object.keys(body).length === 0) return;
    await patchPaper(detail.id, body, "试卷设置已更新");
  }

  async function patchPaper(id: string, body: Record<string, unknown>, okText: string) {
    setError("");
    setDetailBusy(true);
    try {
      await api.patch(`/papers/${id}`, body);
      flash(okText);
      await load();
      if (detail?.id === id) await openDetail(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作失败");
    } finally {
      setDetailBusy(false);
    }
  }

  async function removeQuestion(qid: string) {
    if (!detail) return;
    if (!window.confirm("从本卷移除这道题?题目本身仍保留在题库中。")) return;
    const ids = detail.questions.filter((q) => q.id !== qid).map((q) => q.id);
    if (ids.length === 0) {
      setError("试卷至少要保留 1 道题;若要清空请直接删除整卷");
      return;
    }
    await patchPaper(detail.id, { questionIds: ids }, "已从本卷移除该题");
  }

  // 打开「添加试题」弹窗:按本卷的科目/题源过滤题库,排除已在卷内的题
  async function openAddQuestions() {
    if (!detail) return;
    setError("");
    setAddSelected(new Set());
    setAddKeyword("");
    setAddKpFilter("");
    setAddOpen(true);
    // 预载知识点(按本卷科目),供筛选下拉使用
    try {
      const kps = await api.get<{ list: { id: string; name: string; subject: string }[] }>(
        `/knowledge-points${detail.subject ? `?subject=${encodeURIComponent(detail.subject)}` : ""}`
      );
      setAddKps(kps.list);
    } catch {
      setAddKps([]);
    }
    await loadAddQuestions("");
  }

  // 按条件加载可选题目(知识点 id 为空则不限)
  async function loadAddQuestions(kpId: string) {
    if (!detail) return;
    setAddLoading(true);
    try {
      const qs = new URLSearchParams({ pageSize: "50", sort: "createdAt" });
      if (detail.subject) qs.set("subject", detail.subject);
      if (detail.sourceType) qs.set("sourceType", detail.sourceType);
      if (kpId) qs.set("knowledgePointId", kpId);
      const d = await api.get<{ list: Question[]; total: number }>(`/questions?${qs.toString()}`);
      const inPaper = new Set(detail.questions.map((q) => q.id));
      setAddList(d.list.filter((q) => !inPaper.has(q.id)));
      setAddTotal(d.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取题库失败");
    } finally {
      setAddLoading(false);
    }
  }

  function toggleAddSelect(id: string) {
    setAddSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 确认添加:现有卷内 ids + 勾选 ids 合并后整卷更新(题目本身保留在题库)
  async function addQuestionsToPaper() {
    if (!detail || addSelected.size === 0) return;
    setAddSaving(true);
    try {
      const ids = [...detail.questions.map((q) => q.id), ...Array.from(addSelected)];
      const n = addSelected.size;
      await patchPaper(detail.id, { questionIds: ids }, `已添加 ${n} 道题`);
      setAddOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "添加失败");
    } finally {
      setAddSaving(false);
    }
  }

  async function removePaper(p: PaperRow) {
    if (!window.confirm(`确认删除试卷「${p.title}」?卷内题目仍保留在题库中。`)) return;
    setError("");
    try {
      await api.del(`/papers/${p.id}`);
      flash("试卷已删除");
      if (detail?.id === p.id) setDetail(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  function gotoReview(paperId: string) {
    window.location.href = `/teacher?paperId=${encodeURIComponent(paperId)}`;
  }

  const input =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";
  const chipBase = "rounded-full border px-3 py-1 text-xs transition select-none cursor-pointer";
  const chipOn = "border-indigo-500 bg-indigo-50 text-indigo-700 font-medium";
  const chipOff = "border-slate-300 bg-white text-slate-600 hover:border-slate-400";
  // 翻页按钮样式
  const pgBase = "h-8 min-w-[2rem] rounded-lg px-2.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-40";
  const pgBtn = `${pgBase} border border-slate-200 bg-white text-slate-600 hover:bg-slate-100`;
  const pgOn = `${pgBase} border border-indigo-500 bg-indigo-600 text-white`;

  const noPublished = facets !== null && facets.total === 0;
  const filteredEmpty = !noPublished && available === 0;

  const TABS: { key: typeof filter; label: string }[] = [
    { key: "ALL", label: `全部 ${counts.ALL}` },
    { key: "READY", label: `可作答 ${counts.READY}` },
    { key: "DRAFT", label: `待审核完成 ${counts.DRAFT}` },
    { key: "AUTO_SET", label: `套题自动卷 ${counts.AUTO_SET}` },
    { key: "ARCHIVED", label: `已下架 ${counts.ARCHIVED}` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">试卷管理</h1>
          <p className="mt-1 text-sm text-slate-500">
            套题录入会自动成卷;卷内每道题都审核通过后,试卷才会对学生开放。
          </p>
        </div>
        <button
          onClick={() => setShowGenerator((v) => !v)}
          className="h-9 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700"
        >
          {showGenerator ? "收起组卷面板" : "+ 手动组卷"}
        </button>
      </div>

      {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {showGenerator && (
        <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium text-slate-700">按条件抽题生成新试卷</h2>
            {facets && (
              <span
                className={`rounded-full px-3 py-1 text-xs font-medium ${
                  available > 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"
                }`}
              >
                当前条件可用 {available} 题
              </span>
            )}
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="col-span-2">
              <label className="mb-1 block text-sm text-slate-600">试卷名称</label>
              <input
                className={input}
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="如:TMUA 代数专项"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">科目</label>
              <select
                className={`${input} ui-select`}
                value={form.subject}
                onChange={(e) => setForm({ ...form, subject: e.target.value })}
              >
                {SUBJECT_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}({subjectCount[s] ?? 0} 题可用)
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">题目数量</label>
              <input
                className={input}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={form.count}
                onChange={(e) => setForm({ ...form, count: e.target.value.replace(/[^0-9]/g, "") })}
              />
            </div>
          </div>

          {/* 题源:可多选,不选 = 全部题源 */}
          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2">
              <label className="text-sm text-slate-600">题源(可多选)</label>
              <span className="text-xs text-slate-400">不选 = 全部题源</span>
              {form.sourceTypes.length > 0 && (
                <button onClick={() => setForm((f) => ({ ...f, sourceTypes: [] }))} className="text-xs text-indigo-600 hover:underline">
                  清空({form.sourceTypes.length})
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {SOURCE_TYPE_OPTIONS.map((t) => (
                <button
                  key={t}
                  onClick={() => toggleSourceType(t)}
                  className={`${chipBase} ${form.sourceTypes.includes(t) ? chipOn : chipOff}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          {/* 知识点:只列出该科目已发布题目中真实存在的值,避免手填导致匹配不到 */}
          <div className="mt-5">
            <div className="mb-2 flex items-center gap-2">
              <label className="text-sm text-slate-600">知识点</label>
              <span className="text-xs text-slate-400">不选 = 全部</span>
              {topics.length > 0 && (
                <button onClick={() => setTopics([])} className="text-xs text-indigo-600 hover:underline">
                  清空({topics.length})
                </button>
              )}
            </div>
            {facets && facets.topics.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {facets.topics.map((t) => (
                  <button
                    key={t.topic}
                    onClick={() => toggleTopic(t.topic)}
                    className={`${chipBase} ${topics.includes(t.topic) ? chipOn : chipOff}`}
                  >
                    {t.topic}
                    <span className="ml-1 opacity-60">{t.count}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">该科目暂无可选知识点</p>
            )}
          </div>

          {/* 难度 */}
          <div className="mt-4">
            <div className="mb-2 flex items-center gap-2">
              <label className="text-sm text-slate-600">难度</label>
              <span className="text-xs text-slate-400">不选 = 全部</span>
              {difficulties.length > 0 && (
                <button onClick={() => setDifficulties([])} className="text-xs text-indigo-600 hover:underline">
                  清空({difficulties.length})
                </button>
              )}
            </div>
            {facets && facets.difficulties.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {facets.difficulties.map((d) => (
                  <button
                    key={d.difficulty}
                    onClick={() => toggleDiff(d.difficulty)}
                    className={`${chipBase} ${difficulties.includes(d.difficulty) ? chipOn : chipOff}`}
                  >
                    {DIFF_LABEL[d.difficulty] ?? `难度${d.difficulty}`}
                    <span className="ml-1 opacity-60">{d.count}</span>
                  </button>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-400">该科目暂无可选难度</p>
            )}
          </div>

          {noPublished && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              科目「{form.subject}」下还没有已发布的题目。请先到「题库管理」把题目审核通过并发布,或切换科目。
            </p>
          )}
          {filteredEmpty && (
            <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-700">
              当前知识点/难度组合下没有题目,请减少筛选条件。
            </p>
          )}

          <button
            onClick={generate}
            disabled={generating || available === 0}
            className="mt-4 h-9 rounded-lg bg-indigo-600 px-6 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {generating ? "组卷中..." : `生成试卷(取 ${Math.min(Number(form.count) || 1, available)} 题)`}
          </button>
        </div>
      )}

      {/* 学科筛选(与题库一致:全部/数学/物理/化学/生物) */}
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {[{ v: "", l: "全部" }, { v: "数学", l: "数学" }, { v: "物理", l: "物理" }, { v: "化学", l: "化学" }, { v: "生物", l: "生物" }].map((t) => (
          <button
            key={t.v}
            onClick={() => setSubjectFilter(t.v)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
              subjectFilter === t.v ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t.l}
          </button>
        ))}
        {/* 套题类型筛选:官方原版套题 / 组卷套题 / 模考套题 */}
        <span className="mx-1 self-center text-xs text-slate-300">|</span>
        {([{ v: "", l: "全部套题" }, { v: "OFFICIAL", l: "原版套题" }, { v: "CUSTOM", l: "组卷套题" }, { v: "mock", l: "模考套题" }] as const).map((t) => (
          <button
            key={t.v}
            onClick={() => setKindFilter(t.v)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
              kindFilter === t.v ? "bg-teal-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t.l}
          </button>
        ))}
        {/* 题源筛选:点选多选,TMUA / ESAT,空 = 全部 */}
        <span className="mx-1 self-center text-xs text-slate-300">|</span>
        {SOURCE_TYPE_OPTIONS.map((t) => (
          <button
            key={t}
            onClick={() => setSourceFilter((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]))}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
              sourceFilter.includes(t) ? "bg-violet-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t}
          </button>
        ))}
        {sourceFilter.length > 0 && (
          <button
            onClick={() => setSourceFilter([])}
            className="ml-1 rounded-lg px-2.5 py-1.5 text-xs text-indigo-600 hover:underline"
          >
            清空({sourceFilter.length})
          </button>
        )}
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setFilter(t.key)}
              className={`h-8 rounded-lg px-3.5 text-sm font-medium transition ${
                filter === t.key ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {t.label}
            </button>
          ))}
          {/* 排序:按名称字母/数字顺序 或 按创建时间 */}
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as "createdDesc" | "nameAsc" | "nameDesc")}
            className="ml-auto h-8 rounded-lg border border-slate-200 bg-white px-2 text-sm text-slate-600 outline-none focus:border-indigo-500 ui-select"
            aria-label="排序方式"
          >
            <option value="createdDesc">最新优先</option>
            <option value="nameAsc">名称 A→Z</option>
            <option value="nameDesc">名称 Z→A</option>
          </select>
        </div>

        {totalItems === 0 ? (
          <p className="mt-6 text-sm text-slate-400">
            {list.length === 0 ? "还没有试卷。可以手动组卷,或在「题库管理」按套题批量导入,系统会自动成卷。" : "该分类下暂无试卷。"}
          </p>
        ) : (
          <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[920px] text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="whitespace-nowrap px-4 py-3 font-medium">试卷名称</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">科目/类型</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">模式</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">题数</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">审核进度</th>
                  <th className="whitespace-nowrap px-4 py-3 font-medium">状态</th>
                  <th className="whitespace-nowrap px-4 py-3 text-right font-medium">操作</th>
                </tr>
              </thead>
              <tbody>
                {pageItems.map((p) => {
                  const st = (p.status ?? "READY") as string;
                  const s = p.stats;
                  const notReady = s ? s.total - s.published : 0;
                  return (
                    <tr key={p.id} className="border-b border-slate-50 align-middle transition hover:bg-slate-50/60">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="whitespace-nowrap font-medium text-slate-800" title={p.title}>
                            {p.title}
                          </span>
                          {p.origin === "AUTO_SET" && (
                            <span className="shrink-0 rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-600">
                              套题
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <div className="flex flex-nowrap items-center gap-1">
                          <span className="rounded bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600">
                            {p.subject}
                          </span>
                          {p.sourceType && (
                            <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">
                              {p.sourceType}
                            </span>
                          )}
                          {showEsatFamilyBadge(p.sourceType) && (
                            <span className="rounded bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600" title="属于 ESAT 题源家族">
                              ESAT
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-slate-600">
                        套题
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">{p.questionCount} 题</td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {s ? (
                          <div className="flex items-center gap-2">
                            <ProgressBar stats={s} />
                            <span className="text-xs text-slate-500">
                              {s.published}/{s.total}
                            </span>
                          </div>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        <span className={`rounded px-2 py-0.5 text-xs ${PAPER_STATUS_BADGE[st] ?? ""}`}>
                          {PAPER_STATUS_LABEL[st] ?? st}
                        </span>
                        {st === "DRAFT" && notReady > 0 && (
                          <span className="ml-1 text-xs text-slate-400">还差 {notReady} 题</span>
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => openDetail(p.id)}
                            className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                          >
                            查看
                          </button>
                          <button
                            onClick={() => openPreview(p.id)}
                            className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition hover:bg-slate-50"
                          >
                            预览
                          </button>
                          {st === "DRAFT" && (
                            <button
                              onClick={() => gotoReview(p.id)}
                              className="h-8 rounded-lg bg-blue-600 px-3 text-xs font-medium text-white transition hover:bg-blue-700"
                            >
                              去审核
                            </button>
                          )}
                          {st === "ARCHIVED" ? (
                            <button
                              onClick={() => patchPaper(p.id, { status: "ACTIVE" }, "试卷已恢复上架")}
                              className="h-8 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-xs font-medium text-emerald-700 transition hover:bg-emerald-100"
                            >
                              上架
                            </button>
                          ) : (
                            <button
                              onClick={() => patchPaper(p.id, { status: "ARCHIVED" }, "试卷已下架,学生不再可见")}
                              className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-medium text-slate-500 transition hover:bg-slate-50"
                            >
                              下架
                            </button>
                          )}
                          <button
                            onClick={() => removePaper(p)}
                            className="h-8 rounded-lg border border-red-200 bg-red-50 px-3 text-xs font-medium text-red-600 transition hover:bg-red-100"
                          >
                            删除
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* 翻页控件:首页 / 上一页 / 页码窗口 / 下一页 / 尾页 + 每页条数 */}
          {totalPages > 1 && (
            <div className="mt-4 flex flex-col items-center justify-between gap-3 sm:flex-row">
              <div className="flex items-center gap-3 text-xs text-slate-500">
                <span>
                  共 {totalItems} 张试卷 · 第 {currentPage}/{totalPages} 页
                </span>
                <span className="flex items-center gap-1">
                  每页
                  <select
                    value={pageSize}
                    onChange={(e) => setPageSize(Number(e.target.value))}
                    className="h-7 rounded-lg border border-slate-200 bg-white px-1.5 text-xs outline-none focus:border-indigo-500 ui-select"
                  >
                    {[10, 20, 50].map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  条
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                <button onClick={() => setPage(1)} disabled={currentPage === 1} className={pgBtn} title="首页">«</button>
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={currentPage === 1} className={pgBtn}>‹ 上一页</button>
                {getPageWindow(currentPage, totalPages).map((pn, i) =>
                  pn === "..." ? (
                    <span key={`e${i}`} className="px-1.5 text-sm text-slate-400">…</span>
                  ) : (
                    <button key={pn} onClick={() => setPage(pn)} className={pn === currentPage ? pgOn : pgBtn}>{pn}</button>
                  )
                )}
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={currentPage === totalPages} className={pgBtn}>下一页 ›</button>
                <button onClick={() => setPage(totalPages)} disabled={currentPage === totalPages} className={pgBtn} title="尾页">»</button>
              </div>
            </div>
          )}
          </>
        )}
      </div>

      {/* 试卷详情抽屉:逐题查阅内容与审核状态 */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 z-30 flex justify-end bg-slate-900/40" onClick={() => setDetail(null)}>
          <div
            className="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {detailLoading && !detail ? (
              <p className="text-sm text-slate-400">加载中...</p>
            ) : detail ? (
              <>
                <div className="flex items-start justify-between">
                  <div className="flex-1 pr-4">
                    <div className="flex items-center gap-2">
                      <input
                        className="w-full rounded-lg border border-transparent px-2 py-1 text-lg font-bold outline-none hover:border-slate-200 focus:border-indigo-400 focus:bg-white"
                        value={titleDraft}
                        onChange={(e) => setTitleDraft(e.target.value)}
                      />
                      {titleDraft.trim() && titleDraft !== detail.title && (
                        <button
                          disabled={detailBusy}
                          onClick={() => patchPaper(detail.id, { title: titleDraft.trim() }, "试卷已改名")}
                          className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-60"
                        >
                          保存
                        </button>
                      )}
                    </div>
                    <div className="mt-2 flex flex-nowrap gap-2 text-xs">
                      <span className="rounded bg-teal-50 px-2 py-0.5 text-teal-600">{detail.subject}</span>
                      {detail.sourceType && (
                        <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-600">{detail.sourceType}</span>
                      )}
                      <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">
                        套题
                      </span>
                      {detail.origin === "AUTO_SET" && (
                        <span className="rounded bg-violet-50 px-2 py-0.5 text-violet-600">套题自动成卷</span>
                      )}
                      <span className={`rounded px-2 py-0.5 ${PAPER_STATUS_BADGE[detail.status] ?? ""}`}>
                        {PAPER_STATUS_LABEL[detail.status] ?? detail.status}
                      </span>
                      {detail.source && <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-500">{detail.source}</span>}
                    </div>

                    {/* 试卷设置:改科目 / 改题源 */}
                    {settingsDraft && (
                      <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-slate-500">试卷设置(可修改名称/科目/题源)</span>
                          {(settingsDraft.subject !== detail.subject ||
                            settingsDraft.sourceType !== (detail.sourceType ?? "")) && (
                            <button
                              onClick={saveSettings}
                              disabled={detailBusy}
                              className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1 text-xs font-medium text-white disabled:opacity-60"
                            >
                              {detailBusy ? "保存中..." : "保存设置"}
                            </button>
                          )}
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <select
                            value={settingsDraft.subject}
                            onChange={(e) => setSettingsDraft({ ...settingsDraft, subject: e.target.value })}
                            className="ui-select h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs outline-none focus:border-indigo-500"
                          >
                            {["数学", "物理", "化学", "生物"].map((s) => (
                              <option key={s} value={s}>{s}</option>
                            ))}
                          </select>
                          <select
                            value={settingsDraft.sourceType}
                            onChange={(e) => setSettingsDraft({ ...settingsDraft, sourceType: e.target.value })}
                            className="ui-select h-8 rounded-lg border border-slate-300 bg-white px-2 text-xs outline-none focus:border-indigo-500"
                          >
                            <option value="">无题源</option>
                            <option value="TMUA">TMUA</option>
                            <option value="ESAT">ESAT</option>
                            <option value="NSAA">NSAA</option>
                            <option value="SMC">SMC</option>
                          </select>
                        </div>
                        {detail.origin === "AUTO_SET" && settingsDraft.subject !== detail.subject && (
                          <p className="mt-2 text-xs text-amber-600">套题自动卷改科目会同步更新卷的唯一标识(sourceKey)。</p>
                        )}
                      </div>
                    )}
                  </div>
                  <button onClick={() => setDetail(null)} className="text-slate-400 hover:text-slate-600">
                    ✕
                  </button>
                </div>

                <div className="mt-4 rounded-xl bg-slate-50 p-4">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">
                      审核进度 <b className="text-slate-800">{detail.stats.published}</b> / {detail.stats.total}
                    </span>
                    <ProgressBar stats={detail.stats} />
                  </div>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span>待审核 {detail.stats.pending}</span>
                    <span>已退回 {detail.stats.rejected}</span>
                    <span>草稿 {detail.stats.draft}</span>
                    {detail.stats.archived > 0 && <span>已下架 {detail.stats.archived}</span>}
                    {detail.stats.missing > 0 && <span className="text-red-500">题目已删除 {detail.stats.missing}</span>}
                  </div>
                  {detail.status === "DRAFT" && (
                    <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                      还有 {detail.stats.total - detail.stats.published} 道题未通过审核,学生暂时看不到这份试卷。
                      <button onClick={() => gotoReview(detail.id)} className="ml-2 font-medium text-blue-600 hover:underline">
                        去审核 →
                      </button>
                    </p>
                  )}
                  {detail.status === "READY" && (
                    <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
                      整卷已通过审核,学生可以作答。
                    </p>
                  )}
                </div>

                <div className="mt-5 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-600">卷内题目({detail.questions.length})</span>
                  <button
                    onClick={openAddQuestions}
                    disabled={detailBusy}
                    className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    + 添加试题
                  </button>
                </div>
                <div className="mt-3 space-y-3">
                  {detail.questions.map((q) => (
                    <div key={q.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                            第 {q.index} 题
                          </span>
                          {q.missing ? (
                            <span className="rounded bg-red-50 px-2 py-0.5 text-red-600">题目已被删除</span>
                          ) : (
                            <>
                              <span className={`rounded px-2 py-0.5 ${Q_STATUS_BADGE[q.status ?? ""] ?? ""}`}>
                                {Q_STATUS_LABEL[q.status ?? ""] ?? q.status}
                              </span>
                              <span className="text-slate-400">
                                {q.topic} · 难度 {q.difficulty}
                              </span>
                            </>
                          )}
                        </div>
                        <div className="flex shrink-0 flex-col items-end gap-1.5">
                          <button
                            onClick={() => removeQuestion(q.id)}
                            disabled={detailBusy}
                            className="shrink-0 text-xs text-slate-400 hover:text-red-500 disabled:opacity-50"
                          >
                            移出本卷
                          </button>
                          {!q.missing && (
                            <>
                              <button
                                onClick={() => openQuestionEdit(q.id)}
                                className="shrink-0 text-xs font-medium text-indigo-600 hover:underline"
                              >
                                编辑本题
                              </button>
                              <div className="flex items-center gap-0.5" title="点击★直接修改难度">
                                {[1, 2, 3, 4, 5].map((n) => (
                                  <button
                                    key={n}
                                    onClick={() => setQuestionDifficulty(q.id, n)}
                                    disabled={diffBusy === q.id}
                                    title={`难度 ${n} 星`}
                                    className={`text-sm leading-none transition hover:scale-125 disabled:opacity-50 ${n <= (q.difficulty ?? 0) ? "text-amber-400" : "text-slate-300"}`}
                                  >
                                    ★
                                  </button>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      </div>
                      {!q.missing && (
                        <>
                          <div className="mt-2 text-sm leading-relaxed text-slate-800">{renderRich(q.stem ?? "")}</div>
                          <div className="mt-2 space-y-1">
                            {(q.options ?? []).map((opt, i) => {
                              const isAns = isAnswerOption(opt, q.answer, q.options);
                              return (
                                <div
                                  key={i}
                                  onClick={() => openAnswerConfirm(q, opt)}
                                  title={isAns ? "当前答案 · 点击可改设为其它选项" : "点击把此选项设为答案"}
                                  className={`flex cursor-pointer gap-2 rounded px-2 py-1 text-sm transition ${
                                    isAns
                                      ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                                      : "text-slate-600 hover:bg-indigo-50 hover:text-indigo-700"
                                  }`}
                                >
                                  <span className="font-medium">{String.fromCharCode(65 + i)}.</span>
                                  <span className="flex-1">{renderRich(opt)}</span>
                                </div>
                              );
                            })}
                          </div>
                          {(() => {
                            const ansText = letterToOption(q.answer, q.options);
                            if (!ansText) return null;
                            return (
                              <p className="mt-2 text-xs text-slate-500">
                                答案:<b className="text-emerald-700">{ansText}</b>
                                {ansText !== String(q.answer || "").trim() && (
                                  <span className="ml-1 text-slate-400">(原字段:{String(q.answer || "").trim()})</span>
                                )}
                              </p>
                            );
                          })()}
                          {q.status === "REJECTED" && q.reviewNote && (
                            <p className="mt-2 rounded bg-red-50 px-2 py-1 text-xs text-red-600">
                              退回原因:{q.reviewNote}
                            </p>
                          )}
                        </>
                      )}
                      {q.missing && (
                        <p className="mt-2 text-xs text-slate-400">
                          该题已从题库删除,建议把它移出本卷,否则试卷永远无法变为「可作答」。
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </div>
        </div>
      )}

      {/* 添加试题弹窗:从题库选择题目加入本卷 */}
      {addOpen && detail && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-2xl rounded-2xl bg-white p-5 shadow-xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">添加试题到「{detail.title}」</h3>
              <button onClick={() => setAddOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <p className="mt-1 text-xs text-slate-400">
              {addLoading
                ? "正在读取题库..."
                : `从${detail.subject ? `科目「${detail.subject}」` : ""}${detail.subject && detail.sourceType ? "、" : ""}${detail.sourceType ? `题源「${detail.sourceType}」` : ""}题库中选择(共 ${addTotal} 道匹配,已排除卷内题目,最多显示前 50 道)。`}
            </p>
            <div className="mt-3 flex items-center gap-2">
              <select
                value={addKpFilter}
                onChange={(e) => {
                  setAddKpFilter(e.target.value);
                  loadAddQuestions(e.target.value);
                }}
                className="ui-select h-9 w-52 shrink-0 rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500"
              >
                <option value="">全部知识点</option>
                {addKps.map((k) => (
                  <option key={k.id} value={k.id}>{k.name}</option>
                ))}
              </select>
              <input
                value={addKeyword}
                onChange={(e) => setAddKeyword(e.target.value)}
                placeholder="搜索题干关键词..."
                className="h-9 min-w-0 flex-1 rounded-lg border border-slate-300 px-3 text-sm outline-none focus:border-indigo-500"
              />
            </div>
            <div className="mt-3 max-h-[30rem] space-y-2 overflow-y-auto">
              {addLoading ? (
                <p className="py-8 text-center text-sm text-slate-400">加载中...</p>
              ) : addList.length === 0 ? (
                <p className="py-8 text-center text-sm text-slate-400">
                  题库中暂无其它可选题目。可先到「题库管理」录入/审核题目。
                </p>
              ) : (
                addList
                  .filter((q) => !addKeyword.trim() || q.stem.includes(addKeyword.trim()) || (q.topic || "").includes(addKeyword.trim()))
                  .map((q) => (
                    <label
                      key={q.id}
                      className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 transition ${
                        addSelected.has(q.id) ? "border-indigo-400 bg-indigo-50/60" : "border-slate-200 hover:border-slate-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={addSelected.has(q.id)}
                        onChange={() => toggleAddSelect(q.id)}
                        className="mt-1 h-4 w-4 shrink-0 accent-indigo-600"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-nowrap items-center gap-1.5 text-xs">
                          <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">{q.subject}</span>
                          {q.sourceType && <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-600">{q.sourceType}</span>}
                          {showEsatFamilyBadge(q.sourceType) && (
                            <span className="rounded bg-rose-50 px-1.5 py-0.5 text-rose-600" title="属于 ESAT 题源家族">ESAT</span>
                          )}
                          <span className={`rounded px-1.5 py-0.5 ${Q_STATUS_BADGE[q.status ?? ""] ?? ""}`}>
                            {Q_STATUS_LABEL[q.status ?? ""] ?? q.status}
                          </span>
                          <span className="text-slate-400">{q.topic} · 难度 {q.difficulty}</span>
                        </div>
                        <div className="mt-1.5 rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-800">
                          {renderRich(q.stem ?? "")}
                        </div>
                      </div>
                    </label>
                  ))
              )}
            </div>
            <div className="mt-4 flex items-center justify-between">
              <span className="text-xs text-slate-500">已勾选 {addSelected.size} 道</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setAddOpen(false)}
                  className="rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  onClick={addQuestionsToPaper}
                  disabled={addSelected.size === 0 || addSaving}
                  className="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
                >
                  {addSaving ? "添加中..." : `添加 ${addSelected.size} 道`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 点选选项改答案:二次确认弹窗 */}
      {ansTarget && (
        <div
          className="fixed inset-0 z-40 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => !ansSaving && setAnsTarget(null)}
        >
          <div
            className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-slate-100 bg-gradient-to-r from-indigo-50 to-white px-5 py-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-indigo-100 text-lg">✏️</span>
              <div>
                <h3 className="text-base font-bold text-slate-800">修改本题答案</h3>
                <p className="text-xs text-slate-500">确认后立即生效,判分将按新答案计算</p>
              </div>
            </div>
            <div className="px-5 py-4">
              <p className="text-sm leading-relaxed text-slate-600">{plainText(ansTarget.stem) || "（题干为空）"}</p>
              <div className="mt-3 flex items-start gap-2 rounded-xl bg-emerald-50 px-3 py-2.5 ring-1 ring-emerald-200">
                <span className="mt-0.5 shrink-0 text-emerald-600">✓</span>
                <div className="min-w-0">
                  <p className="text-xs text-emerald-600">新答案</p>
                  <p className="text-sm font-medium text-emerald-800">{renderRich(ansTarget.option)}</p>
                </div>
              </div>
              {ansTarget.oldAnswer && (
                <p className="mt-2 text-xs text-slate-400">原答案:{renderRich(ansTarget.oldAnswer)}</p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 bg-slate-50 px-5 py-3">
              <button
                onClick={() => setAnsTarget(null)}
                disabled={ansSaving}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 disabled:opacity-50"
              >
                取消
              </button>
              <button
                onClick={confirmAnswerChange}
                disabled={ansSaving}
                className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:opacity-50"
              >
                {ansSaving ? "保存中..." : "确认修改"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 编辑本题:原地编辑弹窗 */}
      {editQ && (
        <QuestionEditModal
          q={editQ}
          onClose={() => setEditQ(null)}
          onSaved={onQuestionSaved}
        />
      )}

      {/* 试卷预览:按学生视角浏览,不显示正确选项;每题下方可展开解析 */}
      {(preview || previewLoading) && (
        <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40" onClick={() => setPreview(null)}>
          <div
            className="h-full w-full max-w-2xl overflow-y-auto bg-white p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between">
              <div className="flex-1 pr-4">
                <h2 className="text-lg font-bold text-slate-800">
                  {preview ? `试卷预览 · ${preview.title}` : "试卷预览"}
                </h2>
                <p className="mt-1 text-xs text-slate-400">
                  仅展示题干与全部选项(不显示正确答案),点击题目下方的「查看解析」可查看该题解析。
                </p>
              </div>
              <button onClick={() => setPreview(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {previewLoading && !preview ? (
              <p className="mt-8 text-sm text-slate-400">加载中...</p>
            ) : preview ? (
              <div className="mt-5 space-y-4">
                {preview.questions.map((q) => (
                  <div key={q.id} className="rounded-xl border border-slate-200 p-4">
                    <div className="flex items-center gap-2 text-xs">
                      <span className="rounded bg-slate-100 px-2 py-0.5 font-medium text-slate-600">
                        {q.missing ? "缺题" : `第 ${q.index} 题`}
                      </span>
                      {!q.missing && (
                        <span className="text-slate-400">{q.topic} · 难度 {q.difficulty}</span>
                      )}
                    </div>
                    {q.missing ? (
                      <p className="mt-2 text-xs text-slate-400">该题已从题库删除,无法预览。</p>
                    ) : (
                      <>
                        <div className="mt-2 text-sm leading-relaxed text-slate-800">{renderRich(q.stem ?? "")}</div>
                        <div className="mt-2 space-y-1">
                          {(q.options ?? []).map((opt, i) => (
                            <div
                              key={i}
                              className="flex gap-2 rounded px-2 py-1 text-sm text-slate-700"
                            >
                              <span className="font-medium">{String.fromCharCode(65 + i)}.</span>
                              <span className="flex-1">{renderRich(opt)}</span>
                            </div>
                          ))}
                        </div>
                        <button
                          onClick={() => setSolQ(q)}
                          className="mt-3 rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100"
                        >
                          查看解析
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      )}

      {/* 单题解析弹窗 */}
      {solQ && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm"
          onClick={() => setSolQ(null)}
        >
          <div
            className="max-h-[85vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-white shadow-2xl ring-1 ring-slate-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h3 className="text-base font-bold text-slate-800">
                第 {solQ.index} 题 · 解析
              </h3>
              <button onClick={() => setSolQ(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="px-5 py-4">
              <div className="rounded-lg bg-slate-50 px-3 py-2.5 text-sm leading-relaxed text-slate-800">
                {renderRich(solQ.stem ?? "")}
              </div>
              <div className="mt-3 space-y-1">
                {(solQ.options ?? []).map((opt, i) => (
                  <div key={i} className="flex gap-2 px-2 py-1 text-sm text-slate-700">
                    <span className="font-medium">{String.fromCharCode(65 + i)}.</span>
                    <span className="flex-1">{renderRich(opt)}</span>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
                <p className="mb-1 text-xs font-medium text-indigo-600">解析</p>
                <div className="text-sm leading-relaxed text-slate-800">
                  {solQ.solution ? renderRich(solQ.solution) : <span className="text-slate-400">暂无解析</span>}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
