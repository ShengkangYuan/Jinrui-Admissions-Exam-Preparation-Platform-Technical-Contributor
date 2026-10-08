"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent, ClipboardEvent, RefObject } from "react";
import { api, getUser } from "@/lib/api";
import { plainText, renderRich } from "@/lib/rich";
import { fetchSourceTypes, DEFAULT_SOURCE_TYPES } from "@/lib/sourceTypes";
import { isEsatFamily, showEsatFamilyBadge } from "@/lib/sourceFamily";
import { isAnswerOption, letterToOption } from "@/lib/answer";
import type { AutoFixBatchItem, AutoFixPlan, AiFixPlan, Question, QuestionList } from "@/lib/types";

const STATUS_LABEL: Record<string, string> = { DRAFT: "草稿", PENDING_REVIEW: "待审核", PUBLISHED: "已发布", REJECTED: "已退回", ARCHIVED: "已下架" };

// 状态徽章配色
const STATUS_BADGE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-500",
  PENDING_REVIEW: "bg-blue-50 text-blue-600",
  PUBLISHED: "bg-emerald-50 text-emerald-600",
  REJECTED: "bg-red-50 text-red-600",
  ARCHIVED: "bg-slate-100 text-slate-400",
};

// 题库列表每页题数(后端 /questions 接口上限 50,故固定 50)
const PAGE_SIZE = 50;

// 题目配图状态:has = 已内嵌图片;needs = 应配图但缺图(提醒老师手动添加);none = 无需配图
// IMG_RE:题干/选项/解析中已含 Markdown 图片语法 ![alt](url)
// NEED_IMG_RE:引用了图表但未内嵌图片的信号词(如 "The diagram shows"、"not to scale"、"如图 1" 等)
//   —— 故意用组合词而非裸 "figure",避免 "significant figures" 等数学术语误报
const IMG_RE = /!\[[^\]]*\]\([^)]+\)/;
const NEED_IMG_RE = /diagram|the figure|in the figure|figure below|figure\s*[0-9一二三]|shown below|as shown|illustrated|pictured|graph below|chart below|table below|not to scale|如图|下图|上图|见图|图\s*[0-9一二三]|表\s*[0-9一二三]|图表|如图所示/i;
function imageStatus(q: Question): "has" | "needs" | "none" {
  const texts = [q.stem, ...(q.options || []), q.solution].filter((t): t is string => typeof t === "string");
  if (texts.some((t) => IMG_RE.test(t))) return "has";
  if (texts.some((t) => NEED_IMG_RE.test(t))) return "needs";
  return "none";
}

// 题目缺项检查:缺答案(必填,缺了不能发布)/缺解析(可选但建议补充)
function questionIssues(q: Question): { missingAnswer: boolean; missingSolution: boolean } {
  return {
    missingAnswer: !String(q.answer ?? "").trim(),
    missingSolution: !String(q.solution ?? "").trim(),
  };
}

// 把 ISO 时间格式化为「YYYY-MM-DD HH:mm」,用于显示导入/创建时间
function fmtTime(s?: string | null): string {
  if (!s) return "—";
  const d = new Date(s);
  if (isNaN(d.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// topicIds 后端可能返回 JSON 字符串(如 "[...]"),统一解析为数组
function parseJsonIds(v: string | string[] | null | undefined): string[] {
  if (Array.isArray(v)) return v;
  if (typeof v === "string") {
    try {
      const a = JSON.parse(v);
      return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
    } catch {
      return [];
    }
  }
  return [];
}

interface FormState {
  id?: string;
  subject: string;
  sourceType: string;
  paper: string;
  topic: string;
  topicIds: string[]; // 关联知识点 id(多选)
  difficulty: number;
  type: string;
  stem: string;
  optionsText: string;
  answer: string;
  solution: string;
  status: string;
}

const EMPTY: FormState = {
  subject: "数学", sourceType: "TMUA", paper: "Paper 1", topic: "", topicIds: [], difficulty: 3, type: "SINGLE_CHOICE",
  stem: "", optionsText: "", answer: "", solution: "", status: "DRAFT",
};

export default function TeacherPage() {
  const user = getUser();
  const [list, setList] = useState<Question[]>([]);
  const [total, setTotal] = useState(0);
  // 分页:page 从 1 开始,pageSize 受后端上限 50 约束
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState("");
  // 学科 tab(空 = 全部;含数学/物理/化学/生物)
  const [subjectTab, setSubjectTab] = useState("");
  // 筛选与排序:知识点 / 难度 / 排序
  const [kpFilter, setKpFilter] = useState("");
  const [diffFilter, setDiffFilter] = useState("");
  const [sortBy, setSortBy] = useState("createdAt_desc");
  // 搜题:输入框即时值 + 已应用的关键词(搜索题干包含该字段的题目)
  const [searchText, setSearchText] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [allKps, setAllKps] = useState<{ id: string; name: string; subject: string }[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [importOpen, setImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<"json" | "csv" | "file" | "pdf">("json");
  const [importText, setImportText] = useState("");
  const [importResult, setImportResult] = useState<{ imported: number; failed: number; errors: { row: number; reason: string }[]; answerMatched?: number } | null>(null);
  const [importError, setImportError] = useState("");
  const [importing, setImporting] = useState(false);
  // 任务式导入:进度条(统一用于 JSON/CSV/文件/PDF 四种模式)
  const [importProgress, setImportProgress] = useState<{ status: "running" | "done" | "error"; progress: number; message: string } | null>(null);
  const importTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // 文件批量导入(Excel/Word)
  const fileImportRef = useRef<HTMLInputElement>(null);
  const [importFileName, setImportFileName] = useState("");
  const [importUploading, setImportUploading] = useState(false);
  // PDF 双文件导入(题目 + 可选答案)
  const pdfFileRef = useRef<HTMLInputElement>(null);
  const pdfAnsFileRef = useRef<HTMLInputElement>(null);
  const [pdfFileName, setPdfFileName] = useState("");
  const [pdfAnsFileName, setPdfAnsFileName] = useState("");
  const [pdfUploading, setPdfUploading] = useState(false);
  // 图片识别录入单题(粘贴题目图片 → 视觉识别 → 核对保存)
  const [ocrOpen, setOcrOpen] = useState(false);
  const [ocrImage, setOcrImage] = useState<string | null>(null);
  const [ocrSubject, setOcrSubject] = useState("");
  const [ocrBusy, setOcrBusy] = useState(false);
  const [ocrError, setOcrError] = useState("");
  const ocrFileRef = useRef<HTMLInputElement>(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [reviewQ, setReviewQ] = useState<Question | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [reviewError, setReviewError] = useState("");
  // 从「试卷管理 → 去审核」跳转过来时,只看这张卷内的题
  const [paperId, setPaperId] = useState("");
  // 知识点库(按表单学科加载,供多选归类)
  const [kps, setKps] = useState<{ id: string; name: string }[]>([]);
  const [sourceTypes, setSourceTypes] = useState<string[]>([...DEFAULT_SOURCE_TYPES]);
  useEffect(() => {
    fetchSourceTypes().then(setSourceTypes).catch(() => {});
  }, []);

  useEffect(() => {
    if (!showForm) return;
    // 题目学科 → 知识点学科:TMUA/ESAT 归类到数学(ESAT 主要为数学与物理,按数学加载)
    const kpSubject = form.subject;
    api
      .get<{ list: { id: string; name: string }[] }>(`/knowledge-points?subject=${encodeURIComponent(kpSubject)}`)
      .then((d) => setKps(d.list || []))
      .catch(() => setKps([]));
  }, [form.subject, showForm]);

  // —— 图片上传:题干 / 选项 / 解析 插入图表 ——
  const stemRef = useRef<HTMLTextAreaElement>(null);
  const optionsRef = useRef<HTMLTextAreaElement>(null);
  const solutionRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadTarget, setUploadTarget] = useState<{ field: "stem" | "optionsText" | "solution"; ref: RefObject<HTMLTextAreaElement> } | null>(null);
  const [uploading, setUploading] = useState(false);

  const openImagePicker = (field: "stem" | "optionsText" | "solution", ref: RefObject<HTMLTextAreaElement>) => {
    setUploadTarget({ field, ref });
    fileInputRef.current?.click();
  };

  // 上传图片并插入到指定 textarea 光标处(共用:文件选择 / 剪贴板粘贴)
  const uploadAndInsert = async (file: File, field: "stem" | "optionsText" | "solution", ref: RefObject<HTMLTextAreaElement>) => {
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const res = await api.post<{ url: string; filename: string }>("/uploads", { filename: file.name, data: dataUrl });
      const url = res.url;
      const alt = (file.name || "图表").replace(/\.[^.]+$/, "") || "图表";
      const snippet = `![${alt}](${url})`;
      const cur = form[field];
      const el = ref.current;
      let next = cur;
      let caret = cur.length;
      if (el) {
        const start = el.selectionStart ?? cur.length;
        const end = el.selectionEnd ?? cur.length;
        next = cur.slice(0, start) + snippet + cur.slice(end);
        caret = start + snippet.length;
      } else {
        const sep = cur && !cur.endsWith("\n") ? "\n" : "";
        next = cur + sep + snippet;
        caret = next.length;
      }
      setForm((f) => ({ ...f, [field]: next }));
      requestAnimationFrame(() => {
        if (el) { el.focus(); el.selectionStart = el.selectionEnd = caret; }
      });
    } catch (err: any) {
      alert("图片上传失败:" + (err?.message || err));
    } finally {
      setUploading(false);
    }
  };

  const handleFileChange = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !uploadTarget) return;
    await uploadAndInsert(file, uploadTarget.field, uploadTarget.ref);
    setUploadTarget(null);
  };

  // 直接粘贴截图:检测剪贴板里的图片,上传后插入光标处
  const handlePaste = async (e: ClipboardEvent<HTMLTextAreaElement>, field: "stem" | "optionsText" | "solution", ref: RefObject<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (!file) continue;
        e.preventDefault(); // 阻止图片被当作文本粘贴进来
        await uploadAndInsert(file, field, ref);
        return;
      }
    }
  };
  const [paperTitle, setPaperTitle] = useState("");
  // 导入弹窗里的「套题名称」:显式指定后,本批题目归入以此命名的卷;不填则由文件名/视觉模型推断。
  // 用于避免不同套题被自动合并成一张卷(见后端 syncAutoPaperSets 的 sourceKey 分组)。
  const [importPaperTitle, setImportPaperTitle] = useState("");
  // 一键自动修正
  const [fixOpen, setFixOpen] = useState(false);
  const [fixQ, setFixQ] = useState<Question | null>(null);
  const [fixPlan, setFixPlan] = useState<AutoFixPlan | null>(null);
  const [fixLoading, setFixLoading] = useState(false);
  const [fixApplying, setFixApplying] = useState(false);
  const [fixError, setFixError] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [batchItems, setBatchItems] = useState<AutoFixBatchItem[] | null>(null);
  const [batchSummary, setBatchSummary] = useState<{ total: number; fixedCount: number; stuck: number; resubmitted: number; applied: boolean } | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState("");
  const [genBusy, setGenBusy] = useState<string | null>(null);
  // AI 按退回原因语义重调(skill)
  const [aiFixOpen, setAiFixOpen] = useState(false);
  const [aiFixQ, setAiFixQ] = useState<Question | null>(null);
  const [aiFixPlan, setAiFixPlan] = useState<AiFixPlan | null>(null);
  const [aiFixLoading, setAiFixLoading] = useState(false);
  const [aiFixApplying, setAiFixApplying] = useState(false);
  const [aiFixError, setAiFixError] = useState("");
  // 服务端是否配置了 LLM(决定 AI 重调按钮是否可用)
  const [llmConfigured, setLlmConfigured] = useState<boolean>(false);

  const load = useCallback(async () => {
    const qs = new URLSearchParams({ pageSize: String(PAGE_SIZE), page: String(page) });
    if (statusFilter) qs.set("status", statusFilter);
    if (searchQuery) qs.set("q", searchQuery);
    if (paperId) qs.set("paperId", paperId);
    // 学科 Tab:数学 tab 包含 TMUA(数学思维考试);其余学科各自
    if (subjectTab) {
      const subs = subjectTab === "数学" ? ["数学", "TMUA"] : [subjectTab];
      qs.set("subjects", subs.join(","));
    }
    if (kpFilter) qs.set("knowledgePointId", kpFilter);
    if (diffFilter) qs.set("difficulty", diffFilter);
    const [sort, order] = sortBy.split("_");
    if (sort === "createdAt" || sort === "difficulty") {
      qs.set("sort", sort);
      qs.set("order", order);
    }
    const d = await api.get<QuestionList>(`/questions?${qs.toString()}`);
    setList(d.list);
    setTotal(d.total);
    // 若当前页已超出范围(如删除/审核后题数变少),回退到最后一页,避免整页空白
    const tp = Math.max(1, Math.ceil(d.total / PAGE_SIZE));
    if (d.list.length === 0 && page > tp) setPage(tp);
  }, [statusFilter, searchQuery, paperId, subjectTab, kpFilter, diffFilter, sortBy, page]);

  // 加载知识点库(供筛选下拉)
  useEffect(() => {
    api
      .get<{ list: { id: string; name: string; subject: string }[] }>("/knowledge-points")
      .then((d) => setAllKps(d.list || []))
      .catch(() => setAllKps([]));
  }, []);

  // 读取 ?paperId=,进入「按试卷审核」模式
  useEffect(() => {
    const pid = new URLSearchParams(window.location.search).get("paperId");
    if (!pid) return;
    setPaperId(pid);
    api
      .get<{ title: string }>(`/papers/${pid}/manage`)
      .then((p) => setPaperTitle(p.title))
      .catch(() => setPaperTitle(""));
  }, []);

  useEffect(() => { load().catch((e) => setError(e.message)); }, [load]);

  // 任意筛选 / 搜索 / 排序条件变化时,回到第 1 页,避免停留在已无数据的旧页码
  useEffect(() => { setPage(1); }, [statusFilter, searchQuery, paperId, subjectTab, kpFilter, diffFilter, sortBy]);

  // 分页派生值:总页数 + 当前页附近的页码窗口(最多显示 5 个,两端用 … 省略)
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const pageNumbers = useMemo(() => {
    const span = 2;
    let start = Math.max(1, page - span);
    let end = Math.min(totalPages, page + span);
    if (end - start < 4) {
      if (start === 1) end = Math.min(totalPages, start + 4);
      else start = Math.max(1, end - 4);
    }
    const arr: number[] = [];
    for (let i = start; i <= end; i++) arr.push(i);
    return arr;
  }, [page, totalPages]);

  // 从「试卷管理」跳转过来:?edit=<id> → 自动打开该题的编辑弹窗
  useEffect(() => {
    if (!list.length) return;
    const id = new URLSearchParams(window.location.search).get("edit");
    if (!id) return;
    const cleanUrl = () => window.history.replaceState(null, "", window.location.pathname);
    const q = list.find((x) => x.id === id);
    if (q) {
      openEdit(q);
      cleanUrl();
      return;
    }
    // 目标题可能不在当前页(题库分页 pageSize=50 或被筛选),按 id 直接拉取并打开
    api
      .get<Question>(`/questions/${id}`)
      .then((q2) => {
        openEdit(q2);
        cleanUrl();
      })
      .catch(() => cleanUrl());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list.length]);

  // 探测服务端是否配置了 LLM,决定「AI 重调」按钮可用性
  useEffect(() => {
    api
      .get<{ llmConfigured: boolean }>(`/health`)
      .then((d) => setLlmConfigured(!!d.llmConfigured))
      .catch(() => setLlmConfigured(false));
  }, []);

  function exitPaperMode() {
    setPaperId("");
    setPaperTitle("");
    window.history.replaceState(null, "", "/teacher");
  }

  function openCreate() { setForm({ ...EMPTY, topicIds: [] }); setError(""); setShowForm(true); }

  // —— 图片识别录入单题 ——
  function openOcr() {
    setOcrError("");
    setOcrImage(null);
    setOcrSubject("");
    setOcrOpen(true);
  }

  function readImageFile(f: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("读取图片失败"));
      r.readAsDataURL(f);
    });
  }

  function handleOcrPaste(e: ClipboardEvent<HTMLDivElement>) {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file" && it.type.startsWith("image/")) {
        e.preventDefault();
        const f = it.getAsFile();
        if (!f) return;
        readImageFile(f)
          .then(setOcrImage)
          .catch(() => setOcrError("读取图片失败"));
        setOcrError("");
        break;
      }
    }
  }

  function handleOcrFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    readImageFile(f)
      .then(setOcrImage)
      .catch(() => setOcrError("读取图片失败"));
    setOcrError("");
  }

  async function runOcr() {
    if (!ocrImage) return;
    setOcrBusy(true);
    setOcrError("");
    try {
      const extracted = await api.post<{
        subject?: string;
        sourceType?: string | null;
        paper?: string | null;
        topic?: string;
        difficulty?: number;
        type?: string;
        stem?: string;
        options?: string[];
        answer?: string;
        solution?: string | null;
      }>("/questions/import-image", { data: ocrImage, subject: ocrSubject || undefined });
      setOcrOpen(false);
      setOcrImage(null);
      // 预填「新建题目」表单,核对后保存入库(默认待审核)
      openEdit({
        id: undefined,
        subject: extracted.subject || ocrSubject || "数学",
        sourceType: extracted.sourceType || "",
        paper: extracted.paper || "",
        topic: extracted.topic || "",
        topicIds: [],
        difficulty: extracted.difficulty || 3,
        type: extracted.type || "SINGLE_CHOICE",
        stem: extracted.stem || "",
        options: extracted.options || [],
        answer: extracted.answer || "",
        solution: extracted.solution || "",
        status: "PENDING_REVIEW",
      } as unknown as Question);
      setMessage("已识别题目,请核对后点「保存」入库");
      setTimeout(() => setMessage(""), 3500);
    } catch (e) {
      setOcrError(e instanceof Error ? e.message : "识别失败");
    } finally {
      setOcrBusy(false);
    }
  }
  function openEdit(q: Question) {
    // 防御:options 可能来自详情/列表接口(api 客户端会解析成数组),再兜底一层防字符串
    const opts = Array.isArray(q.options)
      ? q.options
      : (() => {
          try {
            const v = JSON.parse(String(q.options ?? "[]"));
            return Array.isArray(v) ? v : [];
          } catch {
            return [];
          }
        })();
    setForm({
      id: q.id, subject: q.subject, sourceType: q.sourceType ?? "", paper: q.paper ?? "", topic: q.topic, topicIds: parseJsonIds(q.topicIds),
      difficulty: q.difficulty,
      type: q.type, stem: q.stem, optionsText: opts.join("\n"), answer: q.answer ?? "",
      solution: q.solution ?? "", status: q.status,
    });
    setError("");
    setShowForm(true);
  }

  async function submitForm() {
    setError("");
    const options = form.optionsText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (options.length < 2) { setError("选项至少 2 个,每行一个"); return; }
    if (!form.answer) { setError("请填写正确答案(内容需与某选项一致)"); return; }
    setSaving(true);
    try {
      const payload = {
        subject: form.subject, sourceType: form.sourceType || null, paper: form.paper || null, topic: form.topic, topicIds: form.topicIds,
        difficulty: Number(form.difficulty),
        type: form.type, stem: form.stem, options, answer: form.answer, solution: form.solution || null, status: form.status,
      };
      if (form.id) {
        await api.put(`/questions/${form.id}`, payload);
        setMessage("题目已更新");
      } else {
        await api.post("/questions", payload);
        setMessage("题目已创建");
      }
      setShowForm(false);
      await load();
      setTimeout(() => setMessage(""), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  async function remove(q: Question) {
    if (!window.confirm(`确认删除题目「${q.stem.slice(0, 20)}...」?该题的作答记录与错题本数据将一并删除,且不可恢复。`)) return;
    try {
      await api.del(`/questions/${q.id}`);
      setMessage("已删除");
      await load();
      setTimeout(() => setMessage(""), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  // 任务式导入:提交后拿到 taskId,轮询进度接口直到 done/error
  const pollImportTask = useCallback(async (taskId: string) => {
    setImportProgress({ status: "running", progress: 0, message: "任务已提交,等待开始..." });
    return new Promise<{ imported: number; failed: number; errors: { row: number; reason: string }[]; answerMatched?: number; message?: string }>((resolve, reject) => {
      if (importTimerRef.current) clearInterval(importTimerRef.current);
      let attempts = 0;
      const maxAttempts = 750; // 约 15 分钟兜底(1200ms * 750),PDF/视觉模型大文件导入可能较长
      importTimerRef.current = setInterval(async () => {
        attempts++;
        try {
          const t = await api.get<{ status: "running" | "done" | "error"; progress: number; message: string; result: any; error?: string }>(`/questions/import-task/${taskId}`);
          setImportProgress({ status: t.status, progress: t.progress, message: t.message });
          if (t.status === "done") {
            if (importTimerRef.current) { clearInterval(importTimerRef.current); importTimerRef.current = null; }
            resolve(t.result);
          } else if (t.status === "error") {
            if (importTimerRef.current) { clearInterval(importTimerRef.current); importTimerRef.current = null; }
            reject(new Error(t.error || "导入失败"));
          } else if (attempts >= maxAttempts) {
            if (importTimerRef.current) { clearInterval(importTimerRef.current); importTimerRef.current = null; }
            reject(new Error("导入超时(超过 15 分钟),请稍后到题库列表确认是否已导入"));
          }
        } catch (e) {
          // 网络/接口瞬时错误:不中断轮询,交给下一次;超过阈值则判定失败
          if (attempts >= maxAttempts) {
            if (importTimerRef.current) { clearInterval(importTimerRef.current); importTimerRef.current = null; }
            reject(new Error("导入超时(超过 15 分钟),请稍后到题库列表确认是否已导入"));
          }
        }
      }, 1200);
    });
  }, []);

  async function doImport() {
    setImportError("");
    setImportResult(null);
    if (!importText.trim()) { setImportError("请粘贴数据"); return; }
    setImporting(true);
    try {
      const payload = importMode === "json" ? { items: JSON.parse(importText) } : { csv: importText };
      const { taskId } = await api.post<{ taskId: string }>("/questions/import", payload);
      const r = await pollImportTask(taskId);
      setImportResult(r);
      setImportText("");
      await load();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "导入失败(请检查格式)");
      setImportProgress((prev) => (prev ? { ...prev, status: "error", message: e instanceof Error ? e.message : "导入失败" } : prev));
    } finally {
      setImporting(false);
      if (importTimerRef.current) { clearInterval(importTimerRef.current); importTimerRef.current = null; }
    }
  }

  async function doImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setImportError("");
    setImportResult(null);
    setImportUploading(true);
    setImportFileName(file.name);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const { taskId } = await api.post<{ taskId: string }>("/questions/import-file", { filename: file.name, data: dataUrl, paperTitle: importPaperTitle.trim() || undefined });
      const r = await pollImportTask(taskId);
      setImportResult(r);
      await load();
    } catch (err: any) {
      setImportError(err?.message || "导入失败(请检查文件格式/模板)");
      setImportProgress((prev) => (prev ? { ...prev, status: "error", message: err?.message || "导入失败" } : prev));
    } finally {
      setImportUploading(false);
      if (importTimerRef.current) { clearInterval(importTimerRef.current); importTimerRef.current = null; }
    }
  }

  // PDF 双文件导入:题目文件(必填) + 答案文件(可选),答案按题号顺序匹配
  async function doImportPdf() {
    const file = pdfFileRef.current?.files?.[0];
    if (!file) {
      setImportError("请先选择题目文件(PDF)");
      return;
    }
    const ansFile = pdfAnsFileRef.current?.files?.[0] || null;
    setImportError("");
    setImportResult(null);
    setPdfUploading(true);
    try {
      const read = (f: File) =>
        new Promise<string>((resolve, reject) => {
          const r = new FileReader();
          r.onload = () => resolve(r.result as string);
          r.onerror = () => reject(r.error);
          r.readAsDataURL(f);
        });
      const data = await read(file);
      const answerData = ansFile ? await read(ansFile) : undefined;
      const { taskId } = await api.post<{ taskId: string }>("/questions/import-pdf", { filename: file.name, data, answerFilename: ansFile?.name, answerData, paperTitle: importPaperTitle.trim() || undefined });
      const r = await pollImportTask(taskId);
      setImportResult(r);
      setPdfFileName("");
      setPdfAnsFileName("");
      if (pdfFileRef.current) pdfFileRef.current.value = "";
      if (pdfAnsFileRef.current) pdfAnsFileRef.current.value = "";
      await load();
    } catch (err: any) {
      setImportError(err?.message || "导入失败(请检查 PDF 文件/视觉模型配置)");
      setImportProgress((prev) => (prev ? { ...prev, status: "error", message: err?.message || "导入失败" } : prev));
    } finally {
      setPdfUploading(false);
      if (importTimerRef.current) { clearInterval(importTimerRef.current); importTimerRef.current = null; }
    }
  }

  const input =
    "w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200";

  function openReview(q: Question) {
    setReviewQ(q);
    setReviewNote("");
    setReviewError("");
    setReviewOpen(true);
  }

  async function doReview(action: "approve" | "reject") {
    if (!reviewQ) return;
    // 铁律:缺答案的题不能发布(后端也会拦截,这里前端提前提示)
    if (action === "approve" && questionIssues(reviewQ).missingAnswer) {
      setReviewError("该题缺少答案,不能发布。请先关闭弹窗,点「编辑」补充答案后再审核通过。");
      return;
    }
    setReviewing(true);
    setReviewError("");
    try {
      await api.post(`/questions/${reviewQ.id}/review`, { action, note: action === "reject" ? reviewNote : undefined });
      setReviewOpen(false);
      setMessage(action === "approve" ? "已通过审核,题目已发布" : "已驳回,题目退回修改");
      await load();
      setTimeout(() => setMessage(""), 2500);
    } catch (e) {
      setReviewError(e instanceof Error ? e.message : "审核失败");
    } finally {
      setReviewing(false);
    }
  }

  // 一键修正:先 dry-run 拿到修改方案与前后对比,老师确认后再落库
  async function openAutoFix(q: Question) {
    setFixQ(q);
    setFixPlan(null);
    setFixError("");
    setFixOpen(true);
    setFixLoading(true);
    try {
      const plan = await api.post<AutoFixPlan>(`/questions/${q.id}/autofix`, { apply: false });
      setFixPlan(plan);
    } catch (e) {
      setFixError(e instanceof Error ? e.message : "分析失败");
    } finally {
      setFixLoading(false);
    }
  }

  // AI 生成解析:调用后端 LLM 生成结构化解析草稿(步骤/考点/易错点)
  async function generateSolution(q: Question) {
    if (!window.confirm("确认使用 AI 为这道题目生成解析吗?\n生成后会进入审核队列,由你确认后发布。")) return;
    setGenBusy(q.id);
    setMessage("");
    try {
      const r = await api.post<{ id: string; solution: string; status: string }>(`/questions/${q.id}/generate-solution`, {});
      setMessage("已生成解析,题目进入审核队列,请在审核中确认后发布。");
      await load();
      setTimeout(() => setMessage(""), 4000);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "生成失败");
      setTimeout(() => setMessage(""), 5000);
    } finally {
      setGenBusy(null);
    }
  }

  async function applyAutoFix(resubmit: boolean) {
    if (!fixQ) return;
    setFixApplying(true);
    setFixError("");
    try {
      const r = await api.post<AutoFixPlan>(`/questions/${fixQ.id}/autofix`, { apply: true, resubmit });
      setFixOpen(false);
      setMessage(
        `已修正 ${r.fixes.length} 处${resubmit ? ",题目已重新提交审核" : ",未改变审核状态"}` +
          (r.remaining.length ? `;仍有 ${r.remaining.length} 项需人工确认` : "")
      );
      await load();
      setTimeout(() => setMessage(""), 4000);
    } catch (e) {
      setFixError(e instanceof Error ? e.message : "修正失败");
    } finally {
      setFixApplying(false);
    }
  }

  // AI 按退回原因语义重调(skill):先预览 LLM 给出的改写方案,老师确认后再落库
  async function openAiFix(q: Question) {
    setAiFixQ(q);
    setAiFixPlan(null);
    setAiFixError("");
    setAiFixOpen(true);
    setAiFixLoading(true);
    try {
      const plan = await api.post<AiFixPlan>(`/questions/${q.id}/fix`, { apply: false });
      setAiFixPlan(plan);
    } catch (e) {
      setAiFixError(e instanceof Error ? e.message : "AI 修正失败");
    } finally {
      setAiFixLoading(false);
    }
  }

  async function applyAiFix(resubmit: boolean) {
    if (!aiFixQ) return;
    setAiFixApplying(true);
    setAiFixError("");
    try {
      const r = await api.post<AiFixPlan>(`/questions/${aiFixQ.id}/fix`, { apply: true, resubmit });
      setAiFixOpen(false);
      setMessage(
        `已应用 AI 修正(模型 ${r.model || "LLM"})${resubmit ? ",题目已重新提交审核" : ",未改变审核状态"}` +
          (r.remaining.length ? `;仍有 ${r.remaining.length} 项需人工确认` : "")
      );
      await load();
      setTimeout(() => setMessage(""), 4000);
    } catch (e) {
      setAiFixError(e instanceof Error ? e.message : "AI 修正失败");
    } finally {
      setAiFixApplying(false);
    }
  }

  // 批量体检:默认扫描全部已退回题目
  async function runBatch(apply: boolean) {
    setBatchBusy(true);
    setBatchError("");
    try {
      const r = await api.post<{ total: number; fixedCount: number; resubmitted: number; stuck: number; applied: boolean; items: AutoFixBatchItem[] }>(
        "/questions/autofix/batch",
        { status: "REJECTED", apply, resubmit: true, onlyClean: true }
      );
      setBatchItems(r.items);
      setBatchSummary({ total: r.total, fixedCount: r.fixedCount, stuck: r.stuck, resubmitted: r.resubmitted, applied: r.applied });
      if (apply) await load();
    } catch (e) {
      setBatchError(e instanceof Error ? e.message : "批量修正失败");
    } finally {
      setBatchBusy(false);
    }
  }

  function openBatch() {
    setBatchOpen(true);
    setBatchItems(null);
    setBatchSummary(null);
    setBatchError("");
    runBatch(false);
  }

  return (
    <div className="space-y-4">
      {/* 标题行:左标题 + 右主操作 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">题库管理</h1>
          <p className="mt-1 text-sm text-slate-500">共 {total} 道题目</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setImportOpen(true); setImportText(""); setImportResult(null); setImportError(""); setImportProgress(null); }}
            className="h-9 rounded-lg border border-indigo-300 px-4 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
          >
            批量导入
          </button>
          <button onClick={openOcr} className="h-9 rounded-lg border border-emerald-300 px-4 text-sm font-medium text-emerald-600 hover:bg-emerald-50" title="粘贴题目图片,自动识别成题后核对保存">
            📷 图片识别
          </button>
          <button onClick={openCreate} className="h-9 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white hover:bg-indigo-700">
            + 新建题目
          </button>
        </div>
      </div>

      {/* 学科 Tab */}
      <div className="flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {[{ v: "", l: "全部" }, { v: "数学", l: "数学" }, { v: "物理", l: "物理" }, { v: "化学", l: "化学" }, { v: "生物", l: "生物" }].map((t) => (
          <button
            key={t.v}
            onClick={() => { setSubjectTab(t.v); setKpFilter(""); }}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${
              subjectTab === t.v ? "bg-indigo-600 text-white" : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* 筛选工具栏:统一控件高度 */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
        {/* 搜题:按题干关键词搜索 */}
        <input
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") setSearchQuery(searchText.trim()); }}
          placeholder="搜索题干关键词…"
          className="h-9 w-56 rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500"
        />
        <button
          onClick={() => setSearchQuery(searchText.trim())}
          className="h-9 rounded-lg bg-slate-700 px-3 text-sm font-medium text-white hover:bg-slate-800"
        >
          搜索
        </button>
        {searchQuery && (
          <span className="inline-flex h-9 max-w-[240px] items-center gap-1.5 rounded-lg bg-indigo-50 px-2.5 text-sm text-indigo-600">
            <span className="truncate" title={`搜索题干包含:「${searchQuery}」`}>「{searchQuery}」</span>
            <button
              onClick={() => { setSearchQuery(""); setSearchText(""); }}
              className="shrink-0 font-bold text-indigo-400 hover:text-indigo-700"
              aria-label="清除搜索"
            >
              ✕
            </button>
          </span>
        )}
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500 ui-select">
          <option value="">全部状态</option>
          <option value="DRAFT">草稿</option>
          <option value="PENDING_REVIEW">待审核</option>
          <option value="PUBLISHED">已发布</option>
          <option value="REJECTED">已退回</option>
          <option value="ARCHIVED">已下架</option>
        </select>
        <select value={kpFilter} onChange={(e) => setKpFilter(e.target.value)} className="h-9 max-w-[220px] rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500 ui-select">
          <option value="">全部知识点</option>
          {(subjectTab ? allKps.filter((kp) => kp.subject === subjectTab) : allKps).map((kp) => (
            <option key={kp.id} value={kp.id}>{subjectTab ? kp.name : `[${kp.subject}] ${kp.name}`}</option>
          ))}
        </select>
        <select value={diffFilter} onChange={(e) => setDiffFilter(e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500 ui-select">
          <option value="">全部难度</option>
          <option value="1">难度 1</option>
          <option value="2">难度 2</option>
          <option value="3">难度 3</option>
          <option value="4">难度 4</option>
          <option value="5">难度 5</option>
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} className="h-9 rounded-lg border border-slate-300 bg-white px-2.5 text-sm outline-none focus:border-indigo-500 ui-select">
          <option value="createdAt_desc">导入时间 最新在前</option>
          <option value="createdAt_asc">导入时间 最早在前</option>
          <option value="difficulty_desc">难度 高到低</option>
          <option value="difficulty_asc">难度 低到高</option>
        </select>
        <span className="mx-1 h-5 w-px bg-slate-200" aria-hidden />
        <button
          onClick={() => setStatusFilter("PENDING_REVIEW")}
          className={`h-9 rounded-lg px-3.5 text-sm font-medium transition ${
            statusFilter === "PENDING_REVIEW" ? "bg-blue-600 text-white" : "border border-blue-300 text-blue-600 hover:bg-blue-50"
          }`}
        >
          审核队列
        </button>
        <button
          onClick={openBatch}
          className="h-9 rounded-lg border border-amber-300 px-3.5 text-sm font-medium text-amber-700 hover:bg-amber-50"
        >
          退回题一键修正
        </button>
      </div>

      {paperId && (
        <div className="flex items-center justify-between rounded-lg bg-violet-50 px-3 py-2 text-sm text-violet-700">
          <span>
            正在按试卷审核{paperTitle ? `:「${paperTitle}」` : ""} —— 只显示这张卷里的题目,卷内每道题通过后学生才可作答。
          </span>
          <button onClick={exitPaperMode} className="font-medium text-violet-600 hover:underline">
            退出 ✕
          </button>
        </div>
      )}

      {message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-600">{message}</p>}
      {error && !showForm && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {list.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-8 text-center text-sm text-slate-400">暂无题目</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-sm">
          {/* min-w 保证各列不被挤压,操作列按钮不换行;超宽时容器横向滚动 */}
          <table className="w-full min-w-[1080px] text-sm">
            <thead className="bg-slate-50 text-left text-slate-400">
              <tr>
                <th className="whitespace-nowrap px-4 py-3 font-normal">科目/题源</th>
                <th className="whitespace-nowrap px-4 py-3 font-normal">知识点</th>
                <th className="whitespace-nowrap px-4 py-3 font-normal">题干</th>
                <th className="whitespace-nowrap px-4 py-3 font-normal">难度</th>
                <th className="whitespace-nowrap px-4 py-3 font-normal">状态</th>
                <th className="whitespace-nowrap px-4 py-3 font-normal">导入时间</th>
                <th className="whitespace-nowrap px-4 py-3 font-normal">操作</th>
              </tr>
            </thead>
            <tbody>
              {list.map((q) => (
                <tr key={q.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className="rounded bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-600">{q.subject}</span>
                      {q.sourceType && (
                        <span className="rounded bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">{q.sourceType}</span>
                      )}
                      {showEsatFamilyBadge(q.sourceType) && (
                        <span className="rounded bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-600" title="属于 ESAT 题源家族">ESAT</span>
                      )}
                    </div>
                  </td>
                  <td className="max-w-[200px] px-4 py-3">
                    {q.topics && q.topics.length ? (
                      <div className="flex flex-wrap gap-1">
                        {q.topics.map((t) => (
                          <span key={t} className="rounded bg-indigo-50 px-1.5 py-0.5 text-xs text-indigo-600">{t}</span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-amber-500" title={q.topic ? `原识别:${q.topic}` : "导入/录入时未归类"}>待归类</span>
                    )}
                  </td>
                  <td className="max-w-[280px] px-4 py-3 text-slate-600">
                    <div className="truncate">{plainText(q.stem)}</div>
                    {q.status === "REJECTED" && q.reviewNote && (
                      <div className="mt-0.5 truncate text-xs text-red-500" title={q.reviewNote}>
                        退回:{q.reviewNote}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">{q.difficulty}</td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <span className={`rounded px-2 py-0.5 text-xs ${STATUS_BADGE[q.status]}`}>
                      {STATUS_LABEL[q.status]}
                    </span>
                    {imageStatus(q) === "has" && (
                      <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600" title="题干/选项/解析中已内嵌图片图表">含图表</span>
                    )}
                    {imageStatus(q) === "needs" && (
                      <span className="ml-1.5 rounded bg-red-50 px-1.5 py-0.5 text-xs text-red-500" title="题干/选项/解析引用了图表但未内嵌图片,请编辑手动添加截图">需配图</span>
                    )}
                    {questionIssues(q).missingAnswer && (
                      <span className="ml-1.5 rounded bg-red-100 px-1.5 py-0.5 text-xs font-medium text-red-600" title="缺少答案,此类题目不能通过审核发布,请先编辑补充">缺答案</span>
                    )}
                    {questionIssues(q).missingSolution && (
                      <span className="ml-1.5 rounded bg-orange-50 px-1.5 py-0.5 text-xs text-orange-600" title="缺少解析(建议补充,便于学生复习)">缺解析</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-slate-500">
                    <span
                      className={q.importedAt ? "font-medium text-slate-600" : "text-slate-400"}
                      title={`${q.importedAt ? "导入于" : "创建于"} ${fmtTime(q.importedAt || q.createdAt)}`}
                    >
                      {q.importedAt ? "导入 " : "创建 "}
                      {fmtTime(q.importedAt || q.createdAt)}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3">
                    <div className="flex flex-nowrap items-center gap-x-3">
                      {(q.status === "PENDING_REVIEW" || q.status === "REJECTED") && (
                        <button onClick={() => openReview(q)} className="whitespace-nowrap font-medium text-blue-600 hover:underline">审核</button>
                      )}
                      {q.status === "REJECTED" && (
                        <button onClick={() => openAutoFix(q)} className="whitespace-nowrap font-medium text-amber-600 hover:underline">一键修正</button>
                      )}
                      {q.status === "REJECTED" && (
                        <button
                          onClick={() => openAiFix(q)}
                          disabled={!llmConfigured}
                          title={llmConfigured ? "用 AI 按退回原因语义重写题目" : "服务端未配置 LLM_API_KEY,暂不可用"}
                          className="whitespace-nowrap font-medium text-fuchsia-600 hover:underline disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:no-underline"
                        >
                          AI 重调
                        </button>
                      )}
                      <button onClick={() => generateSolution(q)} disabled={genBusy === q.id} className="whitespace-nowrap font-medium text-emerald-600 hover:underline disabled:opacity-50">
                        {genBusy === q.id ? "生成中..." : "AI 生成解析"}
                      </button>
                      <button onClick={() => openEdit(q)} className="whitespace-nowrap text-indigo-600 hover:underline">编辑</button>
                      {(user?.role === "ADMIN" || user?.role === "TEACHER") && (
                        <button onClick={() => remove(q)} className="whitespace-nowrap text-red-500 hover:underline">删除</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* 分页控件:后端 /questions 按 page/pageSize 返回,这里做点选翻页 */}
      {total > PAGE_SIZE && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <span className="text-sm text-slate-500">
            第 {page} / {totalPages} 页 · 共 {total} 道题
          </span>
          <div className="flex flex-wrap items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              « 首页
            </button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              ‹ 上一页
            </button>
            {pageNumbers[0] > 1 && (
              <>
                <button onClick={() => setPage(1)} className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 transition hover:bg-slate-50">
                  1
                </button>
                {pageNumbers[0] > 2 && <span className="px-1 text-xs text-slate-400">…</span>}
              </>
            )}
            {pageNumbers.map((n) => (
              <button
                key={n}
                onClick={() => setPage(n)}
                className={`h-8 w-8 rounded-lg text-xs font-medium transition ${
                  n === page ? "bg-indigo-600 text-white" : "border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {n}
              </button>
            ))}
            {pageNumbers[pageNumbers.length - 1] < totalPages && (
              <>
                {pageNumbers[pageNumbers.length - 1] < totalPages - 1 && <span className="px-1 text-xs text-slate-400">…</span>}
                <button onClick={() => setPage(totalPages)} className="h-8 w-8 rounded-lg border border-slate-200 bg-white text-xs font-medium text-slate-600 transition hover:bg-slate-50">
                  {totalPages}
                </button>
              </>
            )}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              下一页 ›
            </button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              末页 »
            </button>
          </div>
        </div>
      )}

      {importOpen && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">批量导入题目</h2>
              <button onClick={() => setImportOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {(["json", "csv", "file", "pdf"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setImportMode(m)}
                  className={`rounded-lg px-4 py-1.5 text-sm ${importMode === m ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600"}`}
                >
                  {m === "json" ? "JSON 数组" : m === "csv" ? "CSV 文本" : m === "file" ? "上传文件" : "PDF 双文件"}
                </button>
              ))}
            </div>
            {importMode === "json" ? (
              <>
                <textarea
                  className={`${input} mt-3 h-48 font-mono text-xs`}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={'[\n  { "subject": "TMUA", "topic": "代数", "difficulty": 3, "type": "SINGLE_CHOICE", "stem": "题干...", "options": ["A", "B", "C", "D"], "answer": "A", "solution": "解析", "source": "来源", "status": "PUBLISHED" }\n]'}
                />
                <p className="mt-2 text-xs text-slate-400">字段:subject 必填,topic 必填,stem 必填,options 至少 2 个,answer 必填;其余可选</p>
              </>
            ) : importMode === "csv" ? (
              <>
                <textarea
                  className={`${input} mt-3 h-48 font-mono text-xs`}
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder={"subject,paper,topic,difficulty,type,stem,options(分号分隔),answer,solution,source,status\nTMUA,Paper 1,代数,3,SINGLE_CHOICE,\"题干...\",A;B;C;D,A,解析,来源,PUBLISHED"}
                />
                <p className="mt-2 text-xs text-slate-400">首行为表头;options 用分号分隔;含逗号的字段用双引号包裹</p>
              </>
            ) : importMode === "file" ? (
              <>
                <div className="mb-3">
                  <label className="mb-1 block text-sm text-slate-600">套题名称(可选,用于分卷)</label>
                  <input
                    type="text"
                    value={importPaperTitle}
                    onChange={(e) => setImportPaperTitle(e.target.value)}
                    placeholder="如 物理电磁学 / 2023 物理真题;不填则按文件名自动分卷"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  />
                  <p className="mt-1 text-xs text-slate-400">不同名称各自成卷;相同名称(或同名文件)会合并为同一卷,便于分批导入同一套题。</p>
                </div>
                <div className="mt-3 rounded-lg border-2 border-dashed border-slate-300 px-4 py-8 text-center">
                  <input
                    ref={fileImportRef}
                    type="file"
                    accept=".xlsx,.xls,.docx,.pdf"
                    className="hidden"
                    onChange={doImportFile}
                  />
                  <button
                    type="button"
                    onClick={() => fileImportRef.current?.click()}
                    disabled={importUploading}
                    className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {importUploading ? "解析中..." : "选择文件 (.xlsx / .xls / .docx / .pdf)"}
                  </button>
                  {importFileName && !importUploading && (
                    <p className="mt-3 flex items-center justify-center gap-2 text-xs text-slate-500">
                      <span>已选:{importFileName}</span>
                      <button
                        type="button"
                        onClick={() => { setImportFileName(""); if (fileImportRef.current) fileImportRef.current.value = ""; }}
                        className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-500 hover:border-red-300 hover:text-red-500"
                      >
                        撤销
                      </button>
                    </p>
                  )}
                </div>
                <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                  <p className="font-semibold text-slate-700">Excel 列说明(首行表头,一行一题):</p>
                  <p>subject, paper, topic, difficulty, type, stem, options(分号分隔), answer, solution, source, status</p>
                  <p className="font-semibold text-slate-700">Word 模板(每题之间用单独一行的 --- 分隔):</p>
                  <pre className="overflow-x-auto rounded bg-white p-2 text-[11px] text-slate-700">{`---
Subject: TMUA
Paper: 2016 P1
Topic: 代数
Difficulty: 3
Type: SINGLE_CHOICE

题干,可含 $LaTeX$ 公式。

A. 选项一
B. 选项二
C. 选项三
D. 选项四

Answer: B

解析内容(可选)。`}</pre>
                  <p>answer 写字母(A/B/C/D)或选项文本均可,系统会自动对齐。</p>
                  <p className="mt-2 font-semibold text-slate-700">PDF 导入:</p>
                  <p>系统会把 PDF 逐页渲染成图片,交给视觉模型读取渲染后的数学公式并自动转成题目(公式不需手敲 LaTeX)。PDF 导入需在服务器配置视觉模型(VISION_API_KEY 等),未配置时会提示。</p>
                  <p className="text-amber-600">若题目 PDF 与答案不在同一文件,请使用「PDF 双文件」标签页分别上传题目与答案文件;答案文件可识别 Q21 A / 21. B / Q21 A PHYS 等答案表格式。</p>
                </div>
              </>
            ) : (
              <>
                <div className="mb-3">
                  <label className="mb-1 block text-sm text-slate-600">套题名称(可选,用于分卷)</label>
                  <input
                    type="text"
                    value={importPaperTitle}
                    onChange={(e) => setImportPaperTitle(e.target.value)}
                    placeholder="如 物理电磁学 / 2023 物理真题;不填则按文件名自动分卷"
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                  />
                  <p className="mt-1 text-xs text-slate-400">不同名称各自成卷;相同名称(或同名文件)会合并为同一卷,便于分批导入同一套题。</p>
                </div>
                {/* PDF 双文件导入:题目文件(必填) + 答案文件(可选) */}
                <div className="mt-3 space-y-3 rounded-lg border-2 border-dashed border-indigo-300 bg-indigo-50/30 px-4 py-5">
                  <div>
                    <p className="text-sm font-medium text-slate-700">题目文件 (PDF,必填)</p>
                    <input
                      ref={pdfFileRef}
                      type="file"
                      accept=".pdf"
                      className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-700"
                      onChange={(e) => setPdfFileName(e.target.files?.[0]?.name ?? "")}
                    />
                    {pdfFileName && (
                      <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        <span>已选题目:{pdfFileName}</span>
                        <button
                          type="button"
                          onClick={() => { setPdfFileName(""); if (pdfFileRef.current) pdfFileRef.current.value = ""; }}
                          className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-500 hover:border-red-300 hover:text-red-500"
                        >
                          删除
                        </button>
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-slate-700">
                      答案文件 (PDF,可选)
                      <span className="ml-1 text-xs font-normal text-slate-400">答案表如 Q21 A / 21. B / Q21 A PHYS,按题号顺序匹配;不上传则答案留空待审核页补</span>
                    </p>
                    <input
                      ref={pdfAnsFileRef}
                      type="file"
                      accept=".pdf"
                      className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-emerald-700"
                      onChange={(e) => setPdfAnsFileName(e.target.files?.[0]?.name ?? "")}
                    />
                    {pdfAnsFileName && (
                      <p className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                        <span>已选答案:{pdfAnsFileName}</span>
                        <button
                          type="button"
                          onClick={() => { setPdfAnsFileName(""); if (pdfAnsFileRef.current) pdfAnsFileRef.current.value = ""; }}
                          className="rounded border border-slate-300 px-1.5 py-0.5 text-[11px] text-slate-500 hover:border-red-300 hover:text-red-500"
                        >
                          删除
                        </button>
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={doImportPdf}
                    disabled={pdfUploading}
                    className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
                  >
                    {pdfUploading ? "导入中(含视觉模型解析,约 1-2 分钟)..." : "上传并导入"}
                  </button>
                </div>
                <div className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600">
                  <p className="font-semibold text-slate-700">PDF 双文件导入说明:</p>
                  <p>· 题目文件与答案文件分开上传,视觉模型分别解析。</p>
                  <p>· 答案文件识别「题号+答案字母」表格(可带学科列,自动忽略),按题号升序与题目一一对应。</p>
                  <p>· 仅上传题目文件时,答案留空(审核页「缺答案」提示,补全后才能发布)。</p>
                </div>
              </>
            )}
            {importError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{importError}</p>}
            {/* 任务式导入进度条:四种模式统一展示真实进度 */}
            {importProgress && (
              <div className="mt-3 rounded-lg border border-indigo-100 bg-indigo-50/60 p-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium text-indigo-700">
                    {importProgress.status === "error" ? "导入失败" : importProgress.status === "done" ? "导入完成" : "导入中..."}
                  </span>
                  <span className="text-indigo-500">{Math.round(importProgress.progress)}%</span>
                </div>
                <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-indigo-100">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      importProgress.status === "error" ? "bg-red-500" : importProgress.status === "done" ? "bg-emerald-500" : "bg-indigo-600"
                    }`}
                    style={{ width: `${Math.max(2, Math.round(importProgress.progress))}%` }}
                  />
                </div>
                <p className="mt-1.5 text-xs text-slate-500">{importProgress.message}</p>
              </div>
            )}
            {importResult && (
              <div className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
                {(importResult as any).message || `导入完成:成功 ${importResult.imported} 条,失败 ${importResult.failed} 条`}
                {importResult.errors.length > 0 && (
                  <ul className="mt-1 list-inside list-disc text-xs">
                    {importResult.errors.map((e, i) => <li key={i}>第 {e.row} 行:{e.reason}</li>)}
                  </ul>
                )}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => { if (importTimerRef.current) { clearInterval(importTimerRef.current); importTimerRef.current = null; } setImportOpen(false); setImportProgress(null); }} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">关闭</button>
              {importMode !== "file" && importMode !== "pdf" && (
                <button onClick={doImport} disabled={importing} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                  {importing ? "导入中..." : "开始导入"}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 图片识别录入单题(与「新建题目」独立的第二种录入方式) */}
      {ocrOpen && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={() => !ocrBusy && setOcrOpen(false)}>
          <div className="mt-8 w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">📷 图片识别录入题目</h2>
              <button onClick={() => !ocrBusy && setOcrOpen(false)} className="text-slate-400 hover:text-slate-600" aria-label="关闭">✕</button>
            </div>

            {/* 详细提示词 */}
            <div className="mt-3 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50 to-white px-4 py-3 text-xs leading-relaxed text-indigo-900">
              <p className="text-sm font-semibold text-indigo-800">使用方法</p>
              <ol className="mt-1.5 list-decimal space-y-1 pl-4">
                <li>复制一张<b>只含一道选择题</b>的图片(题干 + 选项),截图越清晰识别越准;</li>
                <li>在下方区域 <b>Ctrl/Cmd + V 粘贴</b>,或点击选择图片文件;</li>
                <li>可先选<b>科目</b>辅助识别(不选则自动判断);</li>
                <li>点「开始识别」→ 自动识别出题干/选项/答案,随后会打开<b>题目编辑窗</b>;</li>
                <li>在编辑窗中核对并点「保存」,题目即进入题库(默认待审核,可再改状态)。</li>
              </ol>
              <p className="mt-1.5 text-indigo-700/80">提示:每张图只放一道题;选项字母建议保留原文;公式尽量用截图;若图片未含答案,识别后请手动补充答案。</p>
            </div>

            {/* 粘贴 / 上传区 */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => ocrFileRef.current?.click()}
              onPaste={handleOcrPaste}
              className="mt-4 flex h-48 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-indigo-200 bg-slate-50 text-center transition hover:bg-indigo-50/50"
            >
              {ocrImage ? (
                <img src={ocrImage} alt="待识别题目" className="max-h-[170px] max-w-full rounded-lg object-contain" />
              ) : (
                <>
                  <span className="text-4xl">🖼️</span>
                  <p className="mt-2 text-sm font-medium text-slate-500">在此处粘贴题目图片(<b>Ctrl/Cmd + V</b>)</p>
                  <p className="text-xs text-slate-400">或点击选择图片文件</p>
                </>
              )}
            </div>
            <input ref={ocrFileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleOcrFile} />

            <div className="mt-3 flex items-center gap-3">
              <select value={ocrSubject} onChange={(e) => setOcrSubject(e.target.value)} className={`${input} ui-select w-44`}>
                <option value="">科目:自动识别</option>
                <option value="数学">数学</option>
                <option value="物理">物理</option>
                <option value="化学">化学</option>
                <option value="生物">生物</option>
              </select>
              <button
                onClick={runOcr}
                disabled={ocrBusy || !ocrImage}
                className="ml-auto rounded-lg bg-indigo-600 px-6 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {ocrBusy ? "识别中,请稍候…" : "开始识别"}
              </button>
            </div>

            {ocrBusy && (
              <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-600">正在调用视觉模型识别题目,约需几秒到几十秒…</p>
            )}
            {ocrError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{ocrError}</p>}
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 z-20 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">{form.id ? "编辑题目" : "新建题目"}</h2>
              <button onClick={() => setShowForm(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-slate-600">科目(知识学科)</label>
                <select className={`${input} ui-select`} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
                  <option value="数学">数学</option>
                  <option value="物理">物理</option>
                  <option value="化学">化学</option>
                  <option value="生物">生物</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">题源(考试类型,可输入自定义)</label>
                <input
                  className={input}
                  list="tp-source-types"
                  value={form.sourceType}
                  onChange={(e) => setForm({ ...form, sourceType: e.target.value })}
                  placeholder="TMUA / ESAT / NSAA / MAT / 其他…"
                />
                <datalist id="tp-source-types">
                  <option value="" />
                  {sourceTypes.map((t) => (
                    <option key={t} value={t} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">试卷/部分</label>
                <input className={input} value={form.paper} onChange={(e) => setForm({ ...form, paper: e.target.value })} placeholder="Paper 1 / Maths 1" />
              </div>
              <div className="col-span-2">
                <label className="mb-1 block text-sm text-slate-600">知识点(可多选,从下拉添加)</label>
                {form.topicIds.length > 0 && (
                  <div className="mb-2 flex flex-wrap gap-1.5">
                    {form.topicIds.map((id) => {
                      const kp = kps.find((k) => k.id === id);
                      if (!kp) return null;
                      return (
                        <span key={id} className="inline-flex items-center gap-1 rounded-full bg-indigo-600 px-2.5 py-1 text-xs text-white">
                          {kp.name}
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, topicIds: form.topicIds.filter((x) => x !== id) })}
                            className="text-white/70 hover:text-white"
                            aria-label="移除"
                          >
                            ×
                          </button>
                        </span>
                      );
                    })}
                  </div>
                )}
                <select
                  className={`${input} ui-select`}
                  value=""
                  onChange={(e) => {
                    const id = e.target.value;
                    if (id && !form.topicIds.includes(id)) setForm({ ...form, topicIds: [...form.topicIds, id] });
                    e.target.value = "";
                  }}
                >
                  <option value="">选择知识点添加…</option>
                  {kps.filter((kp) => !form.topicIds.includes(kp.id)).map((kp) => (
                    <option key={kp.id} value={kp.id}>{kp.name}</option>
                  ))}
                </select>
                {kps.length === 0 && (
                  <p className="mt-1 text-xs text-amber-500">该学科暂无知识点,请先到「知识点管理」页添加</p>
                )}
                {form.topic && !form.topicIds.length && (
                  <p className="mt-1 text-xs text-slate-400" title="题库中原有的知识点文本">原知识点「{form.topic}」— 若未选新标签将保留原值</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-sm text-slate-600">难度(1-5)</label>
                  <input className={input} type="number" min={1} max={5} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })} />
                </div>
                <div>
                  <label className="mb-1 block text-sm text-slate-600">状态</label>
                <select className={`${input} ui-select`} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  <option value="PENDING_REVIEW">待审核(默认)</option>
                  <option value="DRAFT">草稿(暂不提交)</option>
                  <option value="PUBLISHED">发布</option>
                  <option value="REJECTED">已退回</option>
                  <option value="ARCHIVED">下架</option>
                </select>
                </div>
              </div>
            </div>
            <div className="mt-3">
              <div className="mb-1 flex items-center justify-between">
                <label className="block text-sm text-slate-600">题干(支持公式 `$x^2$`、图片 `![说明](url)`、LaTeX 文本;可直接粘贴图表截图)</label>
                <button type="button" onClick={() => openImagePicker("stem", stemRef)} disabled={uploading} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">📷 上传图片</button>
              </div>
              <textarea ref={stemRef} className={`${input} h-20`} value={form.stem} onChange={(e) => setForm({ ...form, stem: e.target.value })} onPaste={(e) => handlePaste(e, "stem", stemRef)} placeholder="输入题干... 公式用 $ 包裹,如 求 $x^2 - 5x + 6 = 0$ 的根;截图可直接粘贴到此" />
              {form.stem.trim() !== "" && (
                <div className="mt-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                  <div className="mb-1 text-xs text-slate-400">题干预览</div>
                  {renderRich(form.stem)}
                </div>
              )}
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <div className="mb-1 flex items-center justify-between">
                  <label className="block text-sm text-slate-600">选项(每行一个,支持公式 $ 与图片)</label>
                  <button type="button" onClick={() => openImagePicker("optionsText", optionsRef)} disabled={uploading} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">📷 上传</button>
                </div>
                <textarea ref={optionsRef} className={`${input} h-24`} value={form.optionsText} onChange={(e) => setForm({ ...form, optionsText: e.target.value })} onPaste={(e) => handlePaste(e, "optionsText", optionsRef)} placeholder={"A 选项内容\nB 选项内容\n$\\sqrt{2}$ 或 ![图](/uploads/xx.png)"} />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">正确答案</label>
                <input className={input} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} placeholder="与某选项内容一致" />
                <div className="mb-1 mt-3 flex items-center justify-between">
                  <label className="block text-sm text-slate-600">解析</label>
                  <button type="button" onClick={() => openImagePicker("solution", solutionRef)} disabled={uploading} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">📷 上传图片</button>
                </div>
                <textarea ref={solutionRef} className={`${input} h-14`} value={form.solution} onChange={(e) => setForm({ ...form, solution: e.target.value })} onPaste={(e) => handlePaste(e, "solution", solutionRef)} placeholder="解题思路(可选,支持 ![说明](/uploads/xx.png),可直接粘贴截图)" />
              </div>
            </div>
            {uploading && <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-600">图片上传中…</p>}
            <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleFileChange} />
            {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setShowForm(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">
                取消
              </button>
              <button onClick={submitForm} disabled={saving} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      {reviewOpen && reviewQ && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">题目审核 · {STATUS_LABEL[reviewQ.status]}</h2>
              <button onClick={() => setReviewOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <div className="mt-3 flex flex-wrap gap-2 text-xs text-slate-500">
              <span className="rounded bg-teal-50 px-2 py-0.5 text-teal-600">{reviewQ.subject}</span>
              {reviewQ.sourceType && <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-600">{reviewQ.sourceType}</span>}
              {/* 按卷审核时显示当前卷名,避免题目 paper 字段(源卷名)与卷名不一致造成困惑 */}
              {paperId && paperTitle ? (
                <span className="rounded bg-violet-50 px-2 py-0.5 text-violet-600" title={`题目源卷:${reviewQ.paper || "—"}`}>📄 {paperTitle}</span>
              ) : (
                reviewQ.paper && <span className="rounded bg-teal-50 px-2 py-0.5 text-teal-600">{reviewQ.paper}</span>
              )}
              {reviewQ.topics && reviewQ.topics.length ? (
                reviewQ.topics.map((t) => (
                  <span key={t} className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-600">{t}</span>
                ))
              ) : (
                <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-600" title={reviewQ.topic ? `原识别:${reviewQ.topic}` : ""}>待归类</span>
              )}
              <span className="rounded bg-slate-100 px-2 py-0.5">难度 {reviewQ.difficulty}</span>
              {reviewQ.source && <span className="rounded bg-slate-100 px-2 py-0.5">{reviewQ.source}</span>}
              {questionIssues(reviewQ).missingAnswer && (
                <span className="rounded bg-red-100 px-2 py-0.5 font-medium text-red-600" title="缺少答案,不能通过审核发布">缺答案</span>
              )}
              {questionIssues(reviewQ).missingSolution && (
                <span className="rounded bg-orange-50 px-2 py-0.5 text-orange-600" title="缺少解析(建议补充)">缺解析</span>
              )}
            </div>

            <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
              <p className="mb-2 text-xs font-medium text-slate-400">题干</p>
              <div className="text-sm leading-relaxed text-slate-800">{renderRich(reviewQ.stem)}</div>
              <div className="mt-3 space-y-1">
                {(reviewQ.options || []).map((opt, i) => {
                  const isAns = isAnswerOption(opt, reviewQ.answer, reviewQ.options);
                  return (
                    <div
                      key={i}
                      className={`flex gap-2 rounded-lg px-3 py-2 text-sm ${
                        isAns
                          ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"
                          : "text-slate-700"
                      }`}
                    >
                      <span className="font-medium">{String.fromCharCode(65 + i)}.</span>
                      <span className="flex-1">{renderRich(opt)}</span>
                      {isAns && <span className="shrink-0 text-xs font-medium text-emerald-600">✓ 正确答案</span>}
                    </div>
                  );
                })}
              </div>
              {(() => {
                const ansText = letterToOption(reviewQ.answer, reviewQ.options);
                if (!ansText) return null;
                return (
                  <p className="mt-2 text-xs text-slate-500">
                    答案:<b className="text-emerald-700">{ansText}</b>
                    {ansText !== String(reviewQ.answer || "").trim() && (
                      <span className="ml-1 text-slate-400">(原字段:{String(reviewQ.answer || "").trim()})</span>
                    )}
                  </p>
                );
              })()}
              {reviewQ.solution && (
                <div className="mt-3">
                  <p className="mb-1 text-xs font-medium text-slate-400">解析</p>
                  <div className="whitespace-pre-wrap rounded border-l-4 border-[#c9b98f] bg-[#f6f1e2] px-3 py-2 text-sm leading-relaxed text-[#3a3528]">{renderRich(reviewQ.solution, { smart: false })}</div>
                </div>
              )}
            </div>

            {reviewQ.reviewNote && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">历史审核意见:{reviewQ.reviewNote}</p>
            )}

            <div className="mt-4">
              <label className="mb-1 block text-sm text-slate-600">驳回意见(可选,驳回时建议填写原因)</label>
              <textarea className={`${input} h-16`} value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} placeholder="如:公式渲染异常、选项与答案不匹配、题干缺失..." />
            </div>
            {reviewError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{reviewError}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setReviewOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">取消</button>
              {reviewQ.status === "REJECTED" && (
                <button
                  onClick={() => { setReviewOpen(false); openAutoFix(reviewQ); }}
                  className="rounded-lg border border-amber-300 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-50"
                >
                  一键修正
                </button>
              )}
              {reviewQ.status === "REJECTED" && (
                <button
                  onClick={() => { setReviewOpen(false); openAiFix(reviewQ); }}
                  disabled={!llmConfigured}
                  title={llmConfigured ? "用 AI 按退回原因语义重写题目" : "服务端未配置 LLM_API_KEY,暂不可用"}
                  className="rounded-lg border border-fuchsia-300 px-4 py-2 text-sm font-medium text-fuchsia-700 hover:bg-fuchsia-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-transparent"
                >
                  AI 重调
                </button>
              )}
              <button onClick={() => doReview("reject")} disabled={reviewing} className="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60">驳回</button>
              <button
                onClick={() => doReview("approve")}
                disabled={reviewing || questionIssues(reviewQ).missingAnswer}
                title={questionIssues(reviewQ).missingAnswer ? "缺少答案,不能发布。请先补充答案" : undefined}
                className="rounded-lg bg-emerald-600 px-5 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {reviewing ? "处理中..." : questionIssues(reviewQ).missingAnswer ? "缺答案,不能发布" : "通过审核并发布"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 单题一键修正:先预览方案与前后对比,确认后再落库并重新提交审核 */}
      {fixOpen && fixQ && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">一键修正 · 根据退回原因自动差错</h2>
              <button onClick={() => setFixOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {fixQ.reviewNote ? (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">退回原因:{fixQ.reviewNote}</p>
            ) : (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">该题没有填写退回原因,将执行通用体检(与发布前校验同一套标准)。</p>
            )}

            {fixLoading && <p className="mt-4 text-sm text-slate-400">正在分析题目...</p>}
            {fixError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{fixError}</p>}

            {fixPlan && (
              <>
                <div className="mt-4 flex flex-wrap gap-2 text-xs">
                  <span className={`rounded-full px-3 py-1 ${fixPlan.fixes.length ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>
                    可自动修正 {fixPlan.fixes.length} 处
                  </span>
                  {fixPlan.manual.length > 0 && (
                    <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">需人工 {fixPlan.manual.length} 处</span>
                  )}
                  {fixPlan.noteMatched && (
                    <span className="rounded-full bg-violet-50 px-3 py-1 text-violet-700">已按退回原因定向定位</span>
                  )}
                  <span className={`rounded-full px-3 py-1 ${fixPlan.clean ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"}`}>
                    {fixPlan.clean ? "修正后可通过体检" : `修正后仍有 ${fixPlan.remaining.length} 项问题`}
                  </span>
                </div>

                {fixPlan.fixes.length === 0 && fixPlan.manual.length === 0 && (
                  <p className="mt-4 rounded-lg bg-slate-50 px-3 py-3 text-sm text-slate-500">
                    未检出可自动修正的问题。可能是内容/学术层面的问题,请手动编辑后再提交审核。
                  </p>
                )}

                {fixPlan.fixes.length > 0 && (
                  <div className="mt-4">
                    <p className="mb-2 text-xs font-medium text-slate-400">将要执行的修改</p>
                    <div className="space-y-2">
                      {fixPlan.fixes.map((f, i) => (
                        <div key={i} className="rounded-xl border border-slate-200 p-3">
                          <div className="flex items-center gap-2 text-sm">
                            <span className="font-medium text-slate-700">{f.label}</span>
                            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{f.field}</span>
                            {f.targeted && <span className="rounded bg-violet-50 px-1.5 py-0.5 text-xs text-violet-600">对应退回原因</span>}
                          </div>
                          {f.why && <p className="mt-1 text-xs text-slate-400">{f.why}</p>}
                          <div className="mt-2 grid gap-2 md:grid-cols-2">
                            <div className="rounded-lg bg-red-50 px-2 py-1.5">
                              <p className="text-[11px] text-red-400">修改前</p>
                              <p className="break-all font-mono text-xs text-red-700">{f.before || "(空)"}</p>
                            </div>
                            <div className="rounded-lg bg-emerald-50 px-2 py-1.5">
                              <p className="text-[11px] text-emerald-500">修改后</p>
                              <p className="break-all font-mono text-xs text-emerald-700">{f.after || "(空)"}</p>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {fixPlan.manual.length > 0 && (
                  <div className="mt-4 rounded-xl bg-amber-50 p-3">
                    <p className="text-xs font-medium text-amber-700">以下问题不能自动改,需要人工确认</p>
                    <ul className="mt-1 list-inside list-disc text-xs text-amber-700">
                      {fixPlan.manual.map((m, i) => (
                        <li key={i}>
                          {m.label}
                          {m.detail ? ` —— ${m.detail}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {fixPlan.fixes.length > 0 && (
                  <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4">
                    <p className="mb-2 text-xs font-medium text-slate-400">修正后的效果预览</p>
                    <div className="text-sm leading-relaxed text-slate-800">{renderRich(fixPlan.preview.stem)}</div>
                    <div className="mt-2 space-y-1">
                      {fixPlan.preview.options.map((opt, i) => (
                        <div key={i} className={`flex gap-2 rounded px-2 py-1 text-sm ${opt === fixPlan.preview.answer ? "bg-emerald-50 text-emerald-700" : "text-slate-600"}`}>
                          <span className="font-medium">{String.fromCharCode(65 + i)}.</span>
                          <span className="flex-1">{renderRich(opt)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!fixPlan.clean && (
                  <div className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">
                    修正后仍存在:{fixPlan.remaining.join(";")}
                  </div>
                )}
              </>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setFixOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">取消</button>
              <button
                onClick={() => { setFixOpen(false); openEdit(fixQ); }}
                className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
              >
                手动编辑
              </button>
              <button
                onClick={() => applyAutoFix(false)}
                disabled={fixApplying || !fixPlan || fixPlan.fixes.length === 0}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 disabled:opacity-50"
              >
                只修正不提交
              </button>
              <button
                onClick={() => applyAutoFix(true)}
                disabled={fixApplying || !fixPlan || (fixPlan.fixes.length === 0 && fixPlan.clean === false)}
                className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {fixApplying ? "处理中..." : "修正并重新提交审核"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* AI 按退回原因语义重调(skill):预览 LLM 给出的改写方案,确认后再落库 */}
      {aiFixOpen && aiFixQ && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-fuchsia-700">AI 按原因重调 · 语义重写题目</h2>
              <button onClick={() => setAiFixOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            {aiFixQ.reviewNote ? (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">退回原因:{aiFixQ.reviewNote}</p>
            ) : (
              <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-500">该题没有填写退回原因,AI 将按题目规范全面体检并修正。</p>
            )}

            {aiFixLoading && <p className="mt-4 text-sm text-slate-400">AI 正在分析题目并生成修正方案...</p>}
            {aiFixError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{aiFixError}</p>}

            {aiFixPlan && (
              <>
                {aiFixPlan.changes.length > 0 && (
                  <div className="mt-4 rounded-xl bg-violet-50 p-3">
                    <p className="text-xs font-medium text-violet-700">AI 修改说明(供审核对照)</p>
                    <ul className="mt-1 space-y-1">
                      {aiFixPlan.changes.map((c, i) => (
                        <li key={i} className="text-xs text-violet-700">
                          <span className="rounded bg-violet-100 px-1.5 py-0.5 font-medium">{c.field}</span> {c.reason}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                    <p className="mb-2 text-xs font-medium text-slate-400">原题目</p>
                    <p className="break-words text-sm text-slate-700">{aiFixQ.stem}</p>
                    <div className="mt-2 space-y-1">
                      {(typeof aiFixQ.options === "string" ? JSON.parse(aiFixQ.options || "[]") : aiFixQ.options || []).map((opt: string, i: number) => (
                        <div key={i} className="text-xs text-slate-600">{String.fromCharCode(65 + i)}. {opt}</div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-500">答案:{aiFixQ.answer}</p>
                  </div>
                  <div className="rounded-xl border border-fuchsia-200 bg-fuchsia-50/40 p-3">
                    <p className="mb-2 text-xs font-medium text-fuchsia-500">AI 修正后</p>
                    <p className="break-words text-sm text-slate-800">{aiFixPlan.fixed.stem}</p>
                    <div className="mt-2 space-y-1">
                      {aiFixPlan.fixed.options.map((opt, i) => (
                        <div key={i} className={`text-xs ${opt === aiFixPlan.fixed.answer ? "font-medium text-emerald-700" : "text-slate-700"}`}>{String.fromCharCode(65 + i)}. {opt}</div>
                      ))}
                    </div>
                    <p className="mt-2 text-xs text-slate-600">答案:{aiFixPlan.fixed.answer}</p>
                  </div>
                </div>

                {aiFixPlan.fixed.solution && (
                  <div className="mt-3 rounded-lg bg-[#f6f1e2] px-3 py-2 text-sm leading-relaxed text-[#3a3528]">
                    <span className="text-xs font-medium text-[#00467F]">解析: </span>{aiFixPlan.fixed.solution}
                  </div>
                )}

                {!aiFixPlan.clean && (
                  <div className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
                    体检提示:修正后仍需人工复核 —— {aiFixPlan.remaining.join(";")}
                  </div>
                )}
              </>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setAiFixOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">取消</button>
              <button
                onClick={() => { setAiFixOpen(false); openEdit(aiFixQ); }}
                className="rounded-lg border border-indigo-300 px-4 py-2 text-sm font-medium text-indigo-600 hover:bg-indigo-50"
              >
                手动编辑
              </button>
              <button
                onClick={() => applyAiFix(false)}
                disabled={aiFixApplying || !aiFixPlan}
                className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 disabled:opacity-50"
              >
                只修正不提交
              </button>
              <button
                onClick={() => applyAiFix(true)}
                disabled={aiFixApplying || !aiFixPlan}
                className="rounded-lg bg-fuchsia-600 px-5 py-2 text-sm font-medium text-white hover:bg-fuchsia-700 disabled:opacity-60"
              >
                {aiFixApplying ? "处理中..." : "修正并重新提交审核"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 批量一键修正:扫描全部已退回题目 */}
      {batchOpen && (
        <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4">
          <div className="mt-10 w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold">退回题目批量修正</h2>
              <button onClick={() => setBatchOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              系统会逐题解析退回原因并自动差错。只有修正后能通过体检的题目才会重新提交审核,仍有问题的会留在退回列表等待人工处理。
            </p>

            {batchBusy && <p className="mt-4 text-sm text-slate-400">处理中...</p>}
            {batchError && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{batchError}</p>}

            {batchSummary && (
              <div className="mt-4 flex flex-wrap gap-2 text-xs">
                <span className="rounded-full bg-slate-100 px-3 py-1 text-slate-600">扫描 {batchSummary.total} 道</span>
                <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">
                  {batchSummary.applied ? "已修正" : "可修正"} {batchSummary.fixedCount} 道
                </span>
                {batchSummary.applied && (
                  <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-600">重新提交审核 {batchSummary.resubmitted} 道</span>
                )}
                {batchSummary.stuck > 0 && (
                  <span className="rounded-full bg-amber-50 px-3 py-1 text-amber-700">{batchSummary.stuck} 道需人工处理</span>
                )}
              </div>
            )}

            {batchItems && batchItems.length > 0 && (
              <div className="mt-4 max-h-80 space-y-2 overflow-y-auto">
                {batchItems.map((it) => (
                  <div key={it.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <p className="flex-1 truncate text-sm text-slate-700">{plainText(it.stem)}</p>
                      <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${it.clean ? "bg-emerald-50 text-emerald-600" : "bg-amber-50 text-amber-700"}`}>
                        {it.clean ? `可修正 ${it.fixCount} 处` : "需人工"}
                      </span>
                    </div>
                    {it.reviewNote && <p className="mt-1 text-xs text-red-500">退回:{it.reviewNote}</p>}
                    {it.fixes.length > 0 && (
                      <p className="mt-1 text-xs text-slate-500">修正项:{it.fixes.map((f) => f.label).join("、")}</p>
                    )}
                    {it.remaining.length > 0 && (
                      <p className="mt-1 text-xs text-amber-700">仍存在:{it.remaining.join(";")}</p>
                    )}
                  </div>
                ))}
              </div>
            )}
            {batchItems && batchItems.length === 0 && (
              <p className="mt-4 text-sm text-slate-400">当前没有已退回的题目。</p>
            )}

            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setBatchOpen(false)} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600">关闭</button>
              <button onClick={() => runBatch(false)} disabled={batchBusy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 disabled:opacity-50">
                重新体检
              </button>
              <button
                onClick={() => runBatch(true)}
                disabled={batchBusy || !batchSummary || batchSummary.fixedCount === 0}
                className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-60"
              >
                {batchBusy ? "处理中..." : "全部修正并重新提交审核"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
