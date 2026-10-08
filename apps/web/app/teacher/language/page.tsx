"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import Select from "@/components/Select";

type LangQ = {
  id: string;
  examType: string;
  skill: string;
  qType: string;
  part?: number | null;
  groupTitle?: string | null;
  stem: string;
  options: string[];
  answer?: string | null;
  solution?: string | null;
  audioUrl?: string | null;
  materialId?: string | null;
  wordLimit?: number | null;
  difficulty: number;
  status: string;
  reviewNote?: string | null;
  createdAt?: string;
};

type LangPaper = {
  id: string;
  examType: string;
  skill: string;
  title: string;
  segments: { skill: string; durationMin: number; questionCount: number }[];
  mode: string;
  durationMin: number | null;
  source?: string | null;
  kind: string;
  status: string;
  questionCount: number;
  createdAt: string;
};

// 阅读篇章 = 一篇文章 + 绑定它的若干题目(整体单元)
type Passage = {
  id: string;
  examType: string;
  skill: string;
  title: string | null;
  content: string;
  createdAt: string;
  updatedAt: string;
  questionCount: number;
  statusCount: Record<string, number>;
  typeCount: Record<string, number>;
  questions: LangQ[];
};

type PassageQ = {
  id?: string;
  qType: string;
  stem: string;
  options: string[];
  answer: string;
  solution: string;
  difficulty: number;
};

type PassageDraft = { title: string; content: string; questions: PassageQ[] };

type ReviewSession = {
  id: string;
  student: { id: string; name: string; email: string };
  examType: string;
  skill: string;
  mode: string;
  submittedAt: string;
  totalSub: number;
  pendingSub: number;
};

const EXAMS = ["IELTS", "TOEFL", "KET_PET", "OTHER"];
const SKILLS = ["LISTENING", "READING", "WRITING", "SPEAKING"];
// 题库筛选点选顺序(阅读优先)
const SKILL_CHIPS = ["READING", "LISTENING", "WRITING", "SPEAKING"];
const QTYPES: Record<string, string[]> = {
  LISTENING: ["FILL_BLANK", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING"],
  READING: ["TRUE_FALSE_NG", "FILL_BLANK", "SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING"],
  WRITING: ["TASK1", "TASK2"],
  SPEAKING: ["PART1", "PART2", "PART3"],
};
const EXAM_LABEL: Record<string, string> = { IELTS: "雅思", TOEFL: "托福", KET_PET: "剑桥KET/PET", OTHER: "其他语言" };
const SKILL_LABEL: Record<string, string> = { LISTENING: "听力", READING: "阅读", WRITING: "写作", SPEAKING: "口语", FULL: "全真连考" };
const QTYPE_LABEL: Record<string, string> = {
  FILL_BLANK: "填空", SINGLE_CHOICE: "单选", MULTIPLE_CHOICE: "多选", MATCHING: "配对",
  TRUE_FALSE_NG: "判断T/F/NG", HEADING: "段落标题", TASK1: "写作Task1", TASK2: "写作Task2",
  PART1: "口语Part1", PART2: "口语Part2", PART3: "口语Part3",
};
const STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿", PENDING_REVIEW: "待审核", PUBLISHED: "已发布", REJECTED: "已退回", ARCHIVED: "已下架",
};

const fmtDate = (s?: string | null) => (s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—");

// —— 题目编辑弹窗 ——
function QuestionForm({ initial, defaults, onSaved, onClose }: { initial?: LangQ | null; defaults?: { examType: string; skill: string }; onSaved: () => void; onClose: () => void }) {
  const [f, setF] = useState<Record<string, any>>(() => {
    if (initial) return { ...initial, options: [...(initial.options || [])] };
    const dExam = defaults?.examType || "IELTS";
    const dSkill = defaults?.skill || "READING";
    return { examType: dExam, skill: dSkill, qType: QTYPES[dSkill]?.[0] || "SINGLE_CHOICE", part: null, groupTitle: "", stem: "", options: ["", ""], answer: "", solution: "", audioUrl: null, materialId: null, wordLimit: null, difficulty: 3 };
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const [materials, setMaterials] = useState<{ id: string; title: string | null; skill: string }[]>([]);

  useEffect(() => {
    api.get<{ list: { id: string; title: string | null; skill: string }[] }>("/language/materials?examType=" + f.examType).then((d) => setMaterials(d.list)).catch(() => {});
  }, [f.examType]);

  const isSubjective = ["TASK1", "TASK2", "PART1", "PART2", "PART3"].includes(f.qType);
  const isChoice = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING"].includes(f.qType);
  const needAudio = f.skill === "LISTENING";
  const needMaterial = f.skill === "READING" || f.skill === "WRITING" || f.skill === "SPEAKING";

  const set = (k: string, v: unknown) => setF((p) => ({ ...p, [k]: v }));

  async function uploadAudio(file: File) {
    const reader = new FileReader();
    reader.onload = async () => {
      const data = String(reader.result);
      try {
        const r = await api.post<{ url: string }>("/language/upload-audio", { filename: file.name, data });
        set("audioUrl", r.url);
        setErr("");
      } catch (e) {
        setErr(e instanceof Error ? e.message : "音频上传失败");
      }
    };
    reader.readAsDataURL(file);
  }

  async function save() {
    if (!f.stem.trim()) return setErr("题干必填");
    if (isChoice && f.options.filter((o: string) => o.trim()).length < 2) return setErr("选择题至少需要 2 个选项");
    if (!isSubjective && !f.answer) return setErr("客观题必须填写答案");
    setSaving(true);
    setErr("");
    try {
      const body = {
        examType: f.examType, skill: f.skill, qType: f.qType,
        part: f.part || null, groupTitle: f.groupTitle || null,
        stem: f.stem, options: isChoice ? f.options : undefined,
        answer: isSubjective ? null : f.answer, solution: f.solution || null,
        audioUrl: f.audioUrl || null, materialId: f.materialId || null,
        wordLimit: f.wordLimit || null, difficulty: Number(f.difficulty) || 3,
        status: initial ? undefined : "PENDING_REVIEW",
      };
      if (initial) {
        await api.put(`/language/questions/${initial.id}`, body);
      } else {
        await api.post("/language/questions", body);
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  const col = "block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none";

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-bold text-slate-800">{initial ? "编辑题目" : "新增题目"}</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="block text-xs text-slate-500">考试类型
            <Select value={f.examType} onChange={(v) => set("examType", v)} options={EXAMS.map((x) => ({ value: x, label: EXAM_LABEL[x] }))} />
          </label>
          <label className="block text-xs text-slate-500">技能
            <Select value={f.skill} onChange={(v) => { set("skill", v); set("qType", QTYPES[v]?.[0] || "SINGLE_CHOICE"); }} options={SKILLS.map((s) => ({ value: s, label: SKILL_LABEL[s] }))} />
          </label>
          <label className="block text-xs text-slate-500">题型
            <Select value={f.qType} onChange={(v) => set("qType", v)} options={(QTYPES[f.skill] || []).map((t) => ({ value: t, label: QTYPE_LABEL[t] }))} />
          </label>
          <label className="block text-xs text-slate-500">难度(1-5)
            <Select value={String(f.difficulty)} onChange={(v) => set("difficulty", Number(v))} options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))} />
          </label>
        </div>
        {(f.skill === "LISTENING" || f.skill === "READING") && (
          <label className="mt-3 block text-xs text-slate-500">Part / Passage 序号(全真模考分段用,选填)
            <input className={col} type="number" min={1} max={4} value={f.part || ""} onChange={(e) => set("part", e.target.value ? Number(e.target.value) : null)} />
          </label>
        )}
        <label className="mt-3 block text-xs text-slate-500">题目组标题(如 "Part 1: 订房电话",选填)
          <input className={col} value={f.groupTitle || ""} onChange={(e) => set("groupTitle", e.target.value)} placeholder="选填,用于听力/阅读分组的标题" />
        </label>
        <label className="mt-3 block text-xs text-slate-500">题干 <span className="text-red-500">*</span>
          <textarea className={col} rows={3} value={f.stem} onChange={(e) => set("stem", e.target.value)} placeholder="题干内容(可含换行)" />
        </label>
        {isChoice && (
          <div className="mt-3">
            <div className="mb-1 text-xs text-slate-500">选项</div>
            {f.options.map((o: string, i: number) => (
              <div key={i} className="mb-1.5 flex items-center gap-2">
                <span className="w-6 text-xs font-bold text-slate-400">{String.fromCharCode(65 + i)}</span>
                <input className={col} value={o} onChange={(e) => set("options", f.options.map((x: string, xi: number) => (xi === i ? e.target.value : x)))} />
                <button
                  className="rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-30"
                  disabled={f.options.length <= 2}
                  onClick={() => set("options", f.options.filter((_: string, xi: number) => xi !== i))}
                >删除</button>
              </div>
            ))}
            <button className="rounded-md bg-slate-100 px-2 py-1 text-xs text-slate-600 hover:bg-slate-200" onClick={() => set("options", [...f.options, ""])}>+ 添加选项</button>
          </div>
        )}
        {!isSubjective && (
          <label className="mt-3 block text-xs text-slate-500">
            正确答案(填空多个可接受答案用 | 分隔,如"analysis|analyses") <span className="text-red-500">*</span>
            <input className={col} value={f.answer || ""} onChange={(e) => set("answer", e.target.value)} />
          </label>
        )}
        {isSubjective && (
          <label className="mt-3 block text-xs text-slate-500">词数要求(写作,选填)
            <input className={col} type="number" min={1} value={f.wordLimit || ""} onChange={(e) => set("wordLimit", e.target.value ? Number(e.target.value) : null)} />
          </label>
        )}
        {needAudio && (
          <div className="mt-3">
            <div className="mb-1 text-xs text-slate-500">听力音频</div>
            <input type="file" accept="audio/*" className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-700" onChange={(e) => e.target.files?.[0] && uploadAudio(e.target.files[0])} />
            {f.audioUrl && <p className="mt-1 text-xs text-emerald-600">已上传: {f.audioUrl} <audio className="mt-1" controls src={f.audioUrl} /></p>}
          </div>
        )}
        {needMaterial && (
          <label className="mt-3 block text-xs text-slate-500">关联材料(阅读文章/写作任务/口语提示,选填)
            <Select value={f.materialId || ""} placeholder="无(材料单独管理)" onChange={(v) => set("materialId", v || null)} options={materials.map((m) => ({ value: m.id, label: m.title || m.id.slice(0, 8) }))} />
          </label>
        )}
        <label className="mt-3 block text-xs text-slate-500">解析 / 参考范文
          <textarea className={col} rows={3} value={f.solution || ""} onChange={(e) => set("solution", e.target.value)} placeholder="客观题填解析;写作填参考范文" />
        </label>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100" onClick={onClose}>取消</button>
          <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50" onClick={save} disabled={saving}>{saving ? "保存中..." : "保存"}</button>
        </div>
      </div>
    </div>
  );
}

// —— 阅读篇章编辑弹窗(一篇文章 + 绑定它的若干题目) ——
const CHOICE_TYPES = ["SINGLE_CHOICE", "MULTIPLE_CHOICE", "MATCHING", "HEADING"];
const READING_QTYPES = QTYPES.READING;

function emptyPassageQ(): PassageQ {
  return { qType: "TRUE_FALSE_NG", stem: "", options: ["TRUE", "FALSE", "NOT GIVEN"], answer: "", solution: "", difficulty: 3 };
}

function PassageForm({ initial, draft, onSaved, onClose }: { initial?: Passage | null; draft?: PassageDraft | null; onSaved: () => void; onClose: () => void }) {
  const [examType, setExamType] = useState(initial?.examType || "IELTS");
  const [title, setTitle] = useState(initial?.title || draft?.title || "");
  const [content, setContent] = useState(initial?.content || draft?.content || "");
  const [part, setPart] = useState<string>(initial?.questions?.[0]?.part ? String(initial.questions[0].part) : "");
  const [qs, setQs] = useState<PassageQ[]>(() => {
    if (initial) {
      return initial.questions.map((q) => ({
        id: q.id, qType: q.qType, stem: q.stem, options: [...(q.options || [])],
        answer: q.answer || "", solution: q.solution || "", difficulty: q.difficulty || 3,
      }));
    }
    if (draft && draft.questions.length) return draft.questions.map((q) => ({ ...q, options: [...(q.options || [])] }));
    return [emptyPassageQ()];
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const col = "block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none";

  const setQ = (i: number, patch: Partial<PassageQ>) => setQs((p) => p.map((x, xi) => (xi === i ? { ...x, ...patch } : x)));

  function changeType(i: number, t: string) {
    const cur = qs[i];
    let options = cur.options;
    if (t === "TRUE_FALSE_NG") options = ["TRUE", "FALSE", "NOT GIVEN"];
    else if (CHOICE_TYPES.includes(t) && (!options || options.length < 2)) options = ["", ""];
    setQ(i, { qType: t, options, answer: "" });
  }

  async function save() {
    if (!content.trim()) return setErr("文章正文必填");
    if (!qs.length) return setErr("请至少录入一道题目");
    for (let i = 0; i < qs.length; i++) {
      const q = qs[i];
      if (!q.stem.trim()) return setErr(`第 ${i + 1} 题:题干必填`);
      if (CHOICE_TYPES.includes(q.qType) && q.options.filter((o) => o.trim()).length < 2) return setErr(`第 ${i + 1} 题:至少需要 2 个选项`);
      if (!q.answer.trim()) return setErr(`第 ${i + 1} 题:必须填写答案`);
    }
    setSaving(true);
    setErr("");
    try {
      const body = {
        examType, skill: "READING", title: title || null, content,
        part: part ? Number(part) : null,
        questions: qs.map((q) => ({
          id: q.id, qType: q.qType, stem: q.stem,
          options: CHOICE_TYPES.includes(q.qType) ? q.options.filter((o) => o.trim()) : undefined,
          answer: q.answer, solution: q.solution || null, difficulty: q.difficulty,
        })),
      };
      if (initial) await api.put(`/language/passages/${initial.id}`, body);
      else await api.post("/language/passages", body);
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-8" onClick={onClose}>
      <div className="w-full max-w-5xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-bold text-slate-800">{initial ? "编辑阅读篇章" : "新建阅读篇章"}</h3>
        <p className="mb-4 text-xs text-slate-400">一篇文章 + 绑定它的若干题目,作为一个整体单元保存</p>

        <div className="grid gap-4 lg:grid-cols-2">
          {/* 左:文章 */}
          <div>
            <div className="mb-2 flex gap-3">
              <label className="flex-1 text-xs text-slate-500">考试类型
                <Select value={examType} onChange={setExamType} options={EXAMS.map((x) => ({ value: x, label: EXAM_LABEL[x] }))} />
              </label>
              <label className="w-28 text-xs text-slate-500">Passage 序号
                <input className={col} type="number" min={1} max={4} value={part} onChange={(e) => setPart(e.target.value)} placeholder="选填" />
              </label>
            </div>
            <label className="block text-xs text-slate-500">篇章标题
              <input className={col} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="如 Passage 1: The Story of Tea" />
            </label>
            <label className="mt-2 block text-xs text-slate-500">文章正文 <span className="text-red-500">*</span>
              <textarea className={col + " font-mono"} rows={22} value={content} onChange={(e) => setContent(e.target.value)} placeholder="粘贴文章全文,段落之间空一行" />
            </label>
            <p className="mt-1 text-xs text-slate-400">约 {content.trim() ? content.trim().split(/\s+/).length : 0} 词</p>
          </div>

          {/* 右:绑定题目 */}
          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm font-medium text-slate-600">绑定题目({qs.length} 题)</span>
              <button className="rounded-md bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200" onClick={() => setQs((p) => [...p, emptyPassageQ()])}>+ 添加题目</button>
            </div>
            <div className="max-h-[560px] space-y-3 overflow-y-auto pr-1">
              {qs.map((q, i) => (
                <div key={i} className="rounded-xl border border-slate-200 p-3">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-bold text-indigo-600">Q{i + 1}</span>
                    <Select size="sm" className="rounded-lg border border-slate-200 px-2 py-1 text-xs text-slate-600" value={q.qType} onChange={(v) => changeType(i, v)} options={READING_QTYPES.map((t) => ({ value: t, label: QTYPE_LABEL[t] }))} />
                    {q.id && <span className="text-xs text-slate-400">已有题</span>}
                    <button className="ml-auto rounded-md px-2 py-1 text-xs text-red-500 hover:bg-red-50" onClick={() => setQs((p) => p.filter((_, xi) => xi !== i))}>删除</button>
                  </div>
                  <textarea className={col} rows={2} value={q.stem} onChange={(e) => setQ(i, { stem: e.target.value })} placeholder="题干" />
                  {CHOICE_TYPES.includes(q.qType) && (
                    <div className="mt-2 space-y-1">
                      {q.options.map((o, oi) => (
                        <div key={oi} className="flex items-center gap-2">
                          <span className="w-5 text-xs font-bold text-slate-400">{String.fromCharCode(65 + oi)}</span>
                          <input className={col} value={o} onChange={(e) => setQ(i, { options: q.options.map((x, xi) => (xi === oi ? e.target.value : x)) })} />
                          <button className="rounded-md px-1.5 py-1 text-xs text-red-500 hover:bg-red-50 disabled:opacity-30" disabled={q.options.length <= 2} onClick={() => setQ(i, { options: q.options.filter((_, xi) => xi !== oi) })}>×</button>
                        </div>
                      ))}
                      <button className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200" onClick={() => setQ(i, { options: [...q.options, ""] })}>+ 选项</button>
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <input className="flex-1 min-w-32 rounded-lg border border-slate-200 px-2 py-1.5 text-sm" value={q.answer} onChange={(e) => setQ(i, { answer: e.target.value })} placeholder={q.qType === "FILL_BLANK" ? "答案(多个可接受用 | 分隔)" : "答案(字母或 TRUE/FALSE/NOT GIVEN)"} />
                    {q.qType === "TRUE_FALSE_NG" && (
                      <div className="flex gap-1">
                        {["TRUE", "FALSE", "NOT GIVEN"].map((v) => (
                          <button key={v} className={`rounded-md px-2 py-1 text-xs ${q.answer === v ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`} onClick={() => setQ(i, { answer: v })}>{v}</button>
                        ))}
                      </div>
                    )}
                  </div>
                  <input className="mt-2 block w-full rounded-lg border border-slate-200 px-2 py-1.5 text-sm text-slate-600" value={q.solution} onChange={(e) => setQ(i, { solution: e.target.value })} placeholder="解析/答案出处(选填)" />
                </div>
              ))}
            </div>
          </div>
        </div>

        {err && <p className="mt-3 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100" onClick={onClose}>取消</button>
          <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50" onClick={save} disabled={saving}>{saving ? "保存中..." : initial ? "保存修改" : "创建篇章"}</button>
        </div>
      </div>
    </div>
  );
}

// —— 阅读篇章 PDF 导入弹窗(抽取草稿 → 教师逐篇确认录入) ——
function PassageImportModal({ onClose, onPick }: { onClose: () => void; onPick: (d: PassageDraft) => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [progress, setProgress] = useState(0);
  const [err, setErr] = useState("");
  const [drafts, setDrafts] = useState<PassageDraft[] | null>(null);

  async function upload(file: File) {
    setErr("");
    setBusy(true);
    setProgress(2);
    setMsg("正在上传文件...");
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const r = await api.post<{ taskId: string }>("/language/passages/import", { filename: file.name, data: String(reader.result) });
        const poll = async (): Promise<void> => {
          const t = await api.get<{ status: string; progress: number; message: string; result: { drafts: PassageDraft[] } | null; error: string | null }>(`/language/passages/import/${r.taskId}`);
          setProgress(t.progress || 0);
          setMsg(t.message || "");
          if (t.status === "done") {
            setDrafts(t.result?.drafts || []);
            setBusy(false);
            return;
          }
          if (t.status === "error") {
            setErr(t.error || "解析失败");
            setBusy(false);
            return;
          }
          setTimeout(poll, 1800);
        };
        setTimeout(poll, 1500);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "上传失败");
        setBusy(false);
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-1 text-lg font-bold text-slate-800">导入阅读篇章(PDF)</h3>
        <p className="mb-4 text-xs text-slate-400">上传阅读试卷 PDF,系统按「一篇文章 + 其题目」抽取成篇章草稿,确认后再入库</p>

        {!drafts && (
          <>
            <input type="file" accept="application/pdf" disabled={busy}
              className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-indigo-700 disabled:opacity-50"
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            {busy && (
              <div className="mt-4">
                <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
                  <div className="h-full rounded-full bg-indigo-500 transition-all" style={{ width: `${Math.max(progress, 5)}%` }} />
                </div>
                <p className="mt-2 text-xs text-slate-500">{msg}</p>
              </div>
            )}
          </>
        )}

        {drafts && (
          <div className="space-y-2">
            {drafts.length === 0 && <p className="py-6 text-center text-sm text-slate-400">未抽取到篇章</p>}
            {drafts.map((d, i) => (
              <div key={i} className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-slate-800">{d.title || `篇章 ${i + 1}`}</p>
                  <p className="mt-0.5 text-xs text-slate-500">{d.questions.length} 题 · 正文约 {d.content.trim().split(/\s+/).length} 词</p>
                </div>
                <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700" onClick={() => onPick(d)}>确认录入</button>
              </div>
            ))}
            <p className="pt-1 text-xs text-slate-400">逐篇确认:点「确认录入」会打开篇章编辑器,核对后保存;可返回本列表继续录入下一篇。</p>
          </div>
        )}

        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex justify-end">
          <button className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// —— 组卷弹窗 ——
type PaperInit = {
  id?: string;
  examType: string;
  skill: string;
  title: string;
  mode: string;
  durationMin: number | null;
  source?: string | null;
  kind: string;
  segments: { skill: string; durationMin: number; questionCount?: number }[];
  questionIds?: string[];
};
function PaperForm({ allQuestions, passages, initial, onClose, onSaved }: { allQuestions: LangQ[]; passages: Passage[]; initial?: PaperInit | null; onClose: () => void; onSaved: () => void }) {
  const initFull = !!initial && initial.skill === "FULL";
  const [f, setF] = useState({
    examType: initial?.examType || "IELTS",
    skill: initFull ? "READING" : (initial?.skill || "READING"),
    title: initial?.title || "",
    mode: initial?.mode || "PRACTICE",
    durationMin: initial?.durationMin != null ? String(initial.durationMin) : "",
    source: initial?.source || "",
    kind: initial?.kind || "CUSTOM",
    selected: initial?.questionIds || [] as string[],
    fullExam: initFull,
    segments: initFull && initial?.segments?.length
      ? initial.segments
      : [{ skill: "LISTENING", durationMin: 30 }, { skill: "READING", durationMin: 60 }, { skill: "WRITING", durationMin: 60 }],
  });
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const col = "block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none";

  // 阅读:按「篇章」分组(一篇文章 + 其题目);其他技能:按 Part/技能分组
  const byPassage = !f.fullExam && f.skill === "READING";
  const passageTitle = useMemo(() => {
    const m = new Map<string, string>();
    passages.forEach((p, i) => m.set(p.id, p.title || `篇章 ${i + 1}`));
    return m;
  }, [passages]);

  const groups = useMemo<[string, LangQ[]][]>(() => {
    const map = new Map<string, LangQ[]>();
    for (const q of allQuestions) {
      if (f.examType && q.examType !== f.examType) continue;
      if (!f.fullExam && f.skill && q.skill !== f.skill) continue;
      const key = byPassage
        ? q.materialId
          ? `📄 ${passageTitle.get(q.materialId) || "未命名篇章"}`
          : "未绑定文章的零散题"
        : q.skill === "LISTENING" || q.skill === "READING"
          ? `Part ${q.part || "?"}`
          : SKILL_LABEL[q.skill] || q.skill;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(q);
    }
    return Array.from(map.entries());
  }, [allQuestions, f.examType, f.skill, f.fullExam, byPassage, passageTitle]);

  function toggle(id: string) {
    setF((p) => ({ ...p, selected: p.selected.includes(id) ? p.selected.filter((x) => x !== id) : [...p.selected, id] }));
  }

  function toggleGroup(qs: LangQ[]) {
    const ids = qs.map((q) => q.id);
    const allIn = ids.every((id) => f.selected.includes(id));
    setF((p) => ({
      ...p,
      selected: allIn ? p.selected.filter((x) => !ids.includes(x)) : Array.from(new Set([...p.selected, ...ids])),
    }));
  }

  async function save() {
    if (!f.title.trim()) return setErr("请填写卷名");
    if (f.selected.length === 0) return setErr("请至少选择一道题");
    if (f.mode === "EXAM" && f.fullExam && !f.durationMin) {
      const sum = f.segments.reduce((a, s) => a + (Number(s.durationMin) || 0), 0);
      if (!sum) return setErr("请配置各段时长");
      f.durationMin = String(sum);
    }
    if (f.mode === "EXAM" && !f.fullExam && !f.durationMin) return setErr("练习模式无需时长;模考模式请填总时长(分钟)");
    setSaving(true);
    try {
      const payload = {
        examType: f.examType, skill: f.fullExam ? "FULL" : f.skill, title: f.title,
        questionIds: f.selected, mode: f.mode, durationMin: f.durationMin ? Number(f.durationMin) : null,
        source: f.source || null, kind: f.kind,
        segments: f.fullExam && f.mode === "EXAM" ? f.segments.map((s) => ({ skill: s.skill, durationMin: Number(s.durationMin) || 0 })) : undefined,
      };
      if (initial?.id) {
        await api.put(`/language/papers/${initial.id}`, payload);
      } else {
        await api.post("/language/papers", payload);
      }
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "组卷失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-bold text-slate-800">{initial?.id ? "编辑语言卷" : "语言组卷"}</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <label className="block text-xs text-slate-500">考试类型
            <Select value={f.examType} onChange={(v) => setF({ ...f, examType: v })} options={EXAMS.map((x) => ({ value: x, label: EXAM_LABEL[x] }))} />
          </label>
          <label className="block text-xs text-slate-500">技能
            <Select value={f.fullExam ? "FULL" : f.skill} onChange={(v) => setF({ ...f, skill: v === "FULL" ? "READING" : v, fullExam: v === "FULL" })} options={[...SKILLS.map((s) => ({ value: s, label: SKILL_LABEL[s] })), { value: "FULL", label: "全真连考(L+R+W)" }]} />
          </label>
          <label className="block text-xs text-slate-500">模式
            <Select value={f.mode} onChange={(v) => setF({ ...f, mode: v })} options={[{ value: "PRACTICE", label: "练习" }, { value: "EXAM", label: "模考(限时)" }]} />
          </label>
          <label className="text-xs text-slate-500">卷名 <span className="text-red-500">*</span>
            <input className={col} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="如 雅思听力全真模考" />
          </label>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-3">
          <label className="text-xs text-slate-500">{f.fullExam ? "总分时长(分钟)" : "时长(分钟,模考)"}
            <input className={col} type="number" min={1} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} placeholder={f.fullExam ? "自动按分段求和" : "如 30"} />
          </label>
          <label className="text-xs text-slate-500">来源(选填)
            <input className={col} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="如 官方真题" />
          </label>
          <label className="block text-xs text-slate-500">类型
            <Select value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={[{ value: "OFFICIAL", label: "原版套题" }, { value: "CUSTOM", label: "组卷套题" }]} />
          </label>
        </div>
        {f.fullExam && f.mode === "EXAM" && (
          <div className="mt-3 rounded-lg bg-slate-50 p-3">
            <div className="mb-1 text-xs text-slate-500">全真连考分段配置(听力→阅读→写作)</div>
            <div className="grid grid-cols-3 gap-3">
              {f.segments.map((s, i) => (
                <label key={s.skill} className="text-xs text-slate-500">{SKILL_LABEL[s.skill]}时长(分钟)
                  <input className={col} type="number" min={1} value={s.durationMin} onChange={(e) => setF((p) => ({ ...p, segments: p.segments.map((x, xi) => (xi === i ? { ...x, durationMin: Number(e.target.value) || 0 } : x)) }))} />
                </label>
              ))}
            </div>
          </div>
        )}
        <div className="mt-4 rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-medium text-slate-600">选题目(已选 {f.selected.length} 道)</span>
            <span className="text-xs text-slate-400">仅显示已发布题目</span>
          </div>
          <div className="max-h-80 overflow-y-auto p-3">
            {groups.length === 0 && <p className="py-4 text-center text-sm text-slate-400">暂无已发布题目,请先在「题库管理」录入并发布</p>}
            {groups.map(([g, qs]) => (
              <div key={g} className="mb-3">
                <div className="mb-1 flex items-center gap-2">
                  <span className="text-xs font-bold text-slate-500">{g}</span>
                  <span className="text-xs text-slate-400">({qs.length} 题)</span>
                  <button className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200" onClick={() => toggleGroup(qs)}>
                    {qs.every((q) => f.selected.includes(q.id)) ? (byPassage ? "取消整篇" : "取消本组") : byPassage ? "选整篇" : "选本组"}
                  </button>
                </div>
                {qs.map((q) => (
                  <label key={q.id} className="mb-1 flex cursor-pointer items-start gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                    <input type="checkbox" checked={f.selected.includes(q.id)} onChange={() => toggle(q.id)} className="mt-0.5" />
                    <span className="text-xs text-slate-600">{QTYPE_LABEL[q.qType]} · {q.stem.slice(0, 50)}{q.stem.length > 50 ? "…" : ""}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100" onClick={onClose}>取消</button>
          <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50" onClick={save} disabled={saving}>{saving ? "创建中..." : "创建试卷"}</button>
        </div>
      </div>
    </div>
  );
}

// —— 批改弹窗 ——
function GradingModal({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [data, setData] = useState<any>(null);
  const [scores, setScores] = useState<Record<string, { band: string; feedback: string }>>({});
  const [err, setErr] = useState("");

  useEffect(() => {
    api.get(`/language/review-pool/${sessionId}`).then(setData).catch((e) => setErr(e.message));
  }, [sessionId]);

  async function grade(recordId: string) {
    const s = scores[recordId];
    if (!s || !s.band) return;
    try {
      await api.post(`/language/review-pool/${sessionId}/grade`, { recordId, band: Number(s.band), feedback: s.feedback || null });
      setData((d: any) => ({
        ...d,
        items: d.items.map((it: any) => (it.recordId === recordId ? { ...it, band: Number(s.band), feedback: s.feedback } : it)),
      }));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "批改失败");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-2 text-lg font-bold text-slate-800">写作/口语批改</h3>
        {err && <p className="text-sm text-red-600">{err}</p>}
        {!data && !err && <p className="py-6 text-center text-sm text-slate-400">加载中...</p>}
        {data && (
          <>
            <p className="mb-3 text-sm text-slate-500">
              学生:<b>{data.student.name}</b> ({data.student.email}) · {EXAM_LABEL[data.examType]} {SKILL_LABEL[data.skill]} · {data.paperTitle || ""}
              <br />提交于 {fmtDate(data.submittedAt)} · 客观题: {data.objectiveSummary?.correctCount}/{data.objectiveSummary?.total}
            </p>
            {data.items.map((it: any, i: number) => (
              <div key={it.recordId} className="mb-4 rounded-xl border border-slate-200 p-4">
                <div className="mb-2 flex items-center gap-2">
                  <span className="rounded-md bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-600">{QTYPE_LABEL[it.qType]}</span>
                  {it.wordLimit && <span className="text-xs text-slate-400">要求 ≥{it.wordLimit} 词</span>}
                </div>
                <p className="mb-2 whitespace-pre-wrap text-sm text-slate-700"><b>题目:</b> {it.stem}</p>
                {it.material && <div className="mb-2 rounded bg-slate-50 p-2 text-xs text-slate-500 whitespace-pre-wrap"><b>材料:</b> {it.material.content.slice(0, 400)}</div>}
                {it.recordAudioUrl && <audio className="mb-2" controls src={it.recordAudioUrl} />}
                <div className="mb-2 rounded-lg bg-[#f6f1e2] p-3 text-sm text-slate-800 whitespace-pre-wrap">
                  <b>学生作答:</b><br />{it.selected || "(空)"}
                </div>
                {it.solution && (
                  <details className="mb-2">
                    <summary className="cursor-pointer text-xs text-slate-400">查看参考范文</summary>
                    <div className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2 text-xs text-slate-500">{it.solution}</div>
                  </details>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="number" min={0} max={9} step={0.5}
                    className="w-24 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                    placeholder="Band 0-9"
                    value={scores[it.recordId]?.band ?? (it.band ?? "")}
                    onChange={(e) => setScores((p) => ({ ...p, [it.recordId]: { band: e.target.value, feedback: p[it.recordId]?.feedback || "" } }))}
                  />
                  <input
                    className="flex-1 min-w-40 rounded-lg border border-slate-200 px-2 py-1 text-sm"
                    placeholder="评语(选填)"
                    value={scores[it.recordId]?.feedback ?? it.feedback ?? ""}
                    onChange={(e) => setScores((p) => ({ ...p, [it.recordId]: { band: p[it.recordId]?.band || "", feedback: e.target.value } }))}
                  />
                  <button className="rounded-lg bg-emerald-600 px-3 py-1 text-sm font-medium text-white hover:bg-emerald-700" onClick={() => grade(it.recordId)}>提交批改</button>
                  {it.band !== null && it.band !== undefined && <span className="text-xs text-emerald-600">已评 Band {it.band}</span>}
                </div>
              </div>
            ))}
          </>
        )}
        <div className="mt-4 flex justify-end">
          <button className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100" onClick={onClose}>关闭</button>
        </div>
      </div>
    </div>
  );
}

// —— 作业分发弹窗(复用现有 Assignment 的 languagePaperId) ——
function AssignmentModal({ papers, initialPaperId, onClose, onSaved }: { papers: LangPaper[]; initialPaperId?: string; onClose: () => void; onSaved: () => void }) {
  const [students, setStudents] = useState<{ id: string; name: string; email: string }[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [paperId, setPaperId] = useState(initialPaperId || "");
  const [mode, setMode] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [note, setNote] = useState("");
  const [title, setTitle] = useState("");
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const col = "block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:border-indigo-400 focus:outline-none";

  useEffect(() => {
    api.get<{ list: { id: string; name: string; email: string }[] }>("/teacher/students").then((d) => setStudents(d.list)).catch(() => {});
  }, []);

  function toggle(sid: string) {
    setSelected((p) => (p.includes(sid) ? p.filter((x) => x !== sid) : [...p, sid]));
  }

  const currentPaper = papers.find((p) => p.id === paperId);

  async function save() {
    if (!paperId) return setErr("请选择语言试卷");
    if (selected.length === 0) return setErr("请选择至少一名学生");
    setSaving(true);
    try {
      await api.post("/teacher/assignments", {
        languagePaperId: paperId, title: title || undefined,
        note: note || undefined, mode: mode || undefined,
        dueAt: dueAt ? new Date(dueAt).toISOString() : undefined,
        studentIds: selected,
      });
      onSaved();
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "布置失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-4 text-lg font-bold text-slate-800">布置语言作业/模考</h3>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 block text-xs text-slate-500">语言试卷 <span className="text-red-500">*</span>
            <Select value={paperId} placeholder="请选择试卷" onChange={(v) => { setPaperId(v); const p = papers.find((x) => x.id === v); setMode(p?.mode === "EXAM" ? "EXAM" : "PRACTICE"); }} options={papers.filter((p) => p.status === "READY").map((p) => ({ value: p.id, label: `${p.title} (${EXAM_LABEL[p.examType]}·${SKILL_LABEL[p.skill]}·${p.questionCount}题)` }))} />
          </label>
          <label className="text-xs text-slate-500">作业名称(默认取卷名)
            <input className={col} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={currentPaper?.title || ""} />
          </label>
          <label className="block text-xs text-slate-500">模式
            <Select value={mode} onChange={setMode} options={[{ value: "PRACTICE", label: "练习" }, { value: "EXAM", label: "模考(限时)" }]} />
          </label>
          <label className="text-xs text-slate-500">截止时间(DDL,选填)
            <input className={col} type="datetime-local" value={dueAt} onChange={(e) => setDueAt(e.target.value)} />
          </label>
          <label className="text-xs text-slate-500">备注(选填)
            <input className={col} value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
        </div>
        <div className="mt-4 rounded-lg border border-slate-200">
          <div className="flex items-center justify-between border-b border-slate-100 px-3 py-2">
            <span className="text-sm font-medium text-slate-600">选择学生(已选 {selected.length} 人)</span>
            <div className="flex gap-2">
              <button className="text-xs text-indigo-600 hover:underline" onClick={() => setSelected(students.map((s) => s.id))}>全选</button>
              <button className="text-xs text-slate-400 hover:underline" onClick={() => setSelected([])}>清空</button>
            </div>
          </div>
          <div className="max-h-56 overflow-y-auto p-3">
            {students.length === 0 && <p className="py-4 text-center text-sm text-slate-400">暂无学生</p>}
            {students.map((s) => (
              <label key={s.id} className="mb-1 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                <input type="checkbox" checked={selected.includes(s.id)} onChange={() => toggle(s.id)} />
                <span className="text-sm text-slate-700">{s.name}</span>
                <span className="text-xs text-slate-400">{s.email}</span>
              </label>
            ))}
          </div>
        </div>
        {err && <p className="mt-2 text-sm text-red-600">{err}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100" onClick={onClose}>取消</button>
          <button className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50" onClick={save} disabled={saving}>{saving ? "布置中..." : "布置作业"}</button>
        </div>
      </div>
    </div>
  );
}

export default function TeacherLanguagePage() {
  const [tab, setTab] = useState<"questions" | "papers" | "grading" | "assign">("questions");
  const [papers, setPapers] = useState<LangPaper[]>([]);
  const [review, setReview] = useState<ReviewSession[]>([]);
  const [assigns, setAssigns] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState("");

  // 题库筛选(点选:考试类型 + 技能,默认 雅思 + 阅读)
  const [examType, setExamType] = useState("IELTS");
  const [skill, setSkill] = useState("READING");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [questions, setQuestions] = useState<LangQ[]>([]);
  const [editing, setEditing] = useState<LangQ | null | "new">(null);
  const [showPaper, setShowPaper] = useState(false);
  const [editingPaper, setEditingPaper] = useState<PaperInit | null>(null);
  // 阅读篇章视图
  const [passages, setPassages] = useState<Passage[]>([]);
  const [allPassages, setAllPassages] = useState<Passage[]>([]);
  const [pubQuestions, setPubQuestions] = useState<LangQ[]>([]);
  const [editingPassage, setEditingPassage] = useState<Passage | null | "new">(null);
  const [passageDraft, setPassageDraft] = useState<PassageDraft | null>(null);
  const [showPassageImport, setShowPassageImport] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [showAssign, setShowAssign] = useState(false);
  const [assignPaperId, setAssignPaperId] = useState<string | undefined>(undefined);
  const [gradingSession, setGradingSession] = useState<string | null>(null);
  const [assignDetail, setAssignDetail] = useState<any>(null);

  const loadPassages = useCallback(async () => {
    if (skill !== "READING") return;
    const qs = new URLSearchParams({ skill: "READING" });
    if (examType) qs.set("examType", examType);
    if (status) qs.set("status", status);
    if (q) qs.set("q", q);
    const d = await api.get<{ list: Passage[] }>(`/language/passages?${qs.toString()}`);
    setPassages(d.list);
  }, [skill, examType, status, q]);

  // 非阅读技能(听力/写作/口语)按题目列表展示
  const loadQuestions = useCallback(async () => {
    if (skill === "READING") return;
    const qs = new URLSearchParams({ skill });
    if (examType) qs.set("examType", examType);
    if (status) qs.set("status", status);
    if (q) qs.set("q", q);
    const d = await api.get<{ list: LangQ[] }>(`/language/questions?${qs.toString()}`);
    setQuestions(d.list);
  }, [skill, examType, status, q]);

  // 组卷用:不受题库筛选影响的全部篇章
  const loadAllPassages = useCallback(async () => {
    const d = await api.get<{ list: Passage[] }>("/language/passages?skill=READING");
    setAllPassages(d.list);
  }, []);

  // 组卷选题用:与题库筛选解耦,始终取全部已发布题
  const loadPub = useCallback(async () => {
    const d = await api.get<{ list: LangQ[] }>("/language/questions?status=PUBLISHED");
    setPubQuestions(d.list);
  }, []);

  const loadPapers = useCallback(async () => {
    const d = await api.get<{ list: LangPaper[] }>("/language/papers");
    setPapers(d.list);
  }, []);

  const loadReview = useCallback(async () => {
    const d = await api.get<{ list: ReviewSession[] }>("/language/review-pool");
    setReview(d.list);
  }, []);

  const loadAssigns = useCallback(async () => {
    const d = await api.get<{ list: any[] }>("/teacher/assignments");
    setAssigns(d.list.filter((a) => a.languagePaper));
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        await Promise.all([loadPassages(), loadQuestions(), loadAllPassages(), loadPub(), loadPapers(), loadReview(), loadAssigns()]);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "加载失败");
      } finally {
        setLoading(false);
      }
    })();
  }, [loadPassages, loadQuestions, loadAllPassages, loadPub, loadPapers, loadReview, loadAssigns]);

  async function reviewPassage(id: string, pass: boolean) {
    try {
      await api.post(`/language/passages/${id}/review`, { pass });
      await Promise.all([loadPassages(), loadAllPassages(), loadPub()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function reviewQuestion(id: string, pass: boolean) {
    try {
      await api.post(`/language/questions/${id}/review`, { pass });
      await Promise.all([loadQuestions(), loadPub()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function delQuestion(id: string) {
    if (!window.confirm("确认删除该题目?其作答记录与错题本数据将一并删除。")) return;
    try {
      await api.del(`/language/questions/${id}`);
      await Promise.all([loadQuestions(), loadPub()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function delPassage(p: Passage) {
    if (!window.confirm(`确认删除整篇「${p.title || "未命名篇章"}」?其 ${p.questionCount} 道绑定题目及相关作答/错题记录将一并删除。`)) return;
    try {
      await api.del(`/language/passages/${p.id}`);
      await Promise.all([loadPassages(), loadAllPassages(), loadPub()]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function delPaper(id: string) {
    if (!window.confirm("确认删除该语言试卷?")) return;
    try {
      await api.del(`/language/papers/${id}`);
      loadPapers();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "删除失败");
    }
  }

  async function managePaper(p: LangPaper) {
    try {
      const d = await api.get<{ questions: { id: string }[] }>(`/language/papers/${p.id}`);
      setEditingPaper({
        id: p.id, examType: p.examType, skill: p.skill, title: p.title, mode: p.mode,
        durationMin: p.durationMin, source: p.source ?? null, kind: p.kind, segments: p.segments,
        questionIds: (d.questions || []).map((q) => q.id),
      });
      setShowPaper(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载试卷失败");
    }
  }

  const assignPapers = papers.filter((p) => p.status === "READY");

  const tabs = [
    { key: "questions" as const, label: "语言题库" },
    { key: "papers" as const, label: "语言组卷" },
    { key: "grading" as const, label: "批改台" },
    { key: "assign" as const, label: "作业分发" },
  ];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-bold text-slate-800">语言学习</h1>
        <div className="flex flex-wrap gap-2">
          {tab === "questions" && skill === "READING" && (
            <>
              <button className="rounded-lg bg-slate-100 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-200" onClick={() => setShowPassageImport(true)}>导入阅读篇章(PDF)</button>
              <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" onClick={() => { setPassageDraft(null); setEditingPassage("new"); }}>+ 新建阅读篇章</button>
            </>
          )}
          {tab === "questions" && skill !== "READING" && (
            <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" onClick={() => setEditing("new")}>+ 新增{SKILL_LABEL[skill]}题目</button>
          )}
          {tab === "papers" && <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" onClick={() => setShowPaper(true)}>+ 新建语言卷</button>}
          {tab === "assign" && <button className="rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" onClick={() => setShowAssign(true)}>+ 布置作业</button>}
        </div>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5 rounded-2xl border border-slate-200 bg-white p-1.5 shadow-sm">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-medium transition ${tab === t.key ? "bg-teal-600 text-white" : "text-slate-600 hover:bg-slate-100"}`}>
            {t.label}{t.key === "grading" && review.some((r) => r.pendingSub > 0) ? ` (${review.reduce((a, r) => a + r.pendingSub, 0)})` : ""}
          </button>
        ))}
      </div>

      {err && <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
      {loading && <p className="py-8 text-center text-slate-400">加载中...</p>}

      {!loading && tab === "questions" && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="space-y-2.5 border-b border-slate-100 p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 w-14 shrink-0 text-xs font-medium text-slate-400">考试类型</span>
              {EXAMS.map((x) => (
                <button key={x} onClick={() => setExamType(x)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${examType === x ? "border-teal-600 bg-teal-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:bg-teal-50"}`}>
                  {EXAM_LABEL[x]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 w-14 shrink-0 text-xs font-medium text-slate-400">技能</span>
              {SKILL_CHIPS.map((s) => (
                <button key={s} onClick={() => setSkill(s)}
                  className={`rounded-full border px-3 py-1 text-xs font-medium transition ${skill === s ? "border-indigo-600 bg-indigo-600 text-white" : "border-slate-200 bg-white text-slate-600 hover:border-indigo-300 hover:bg-indigo-50"}`}>
                  {SKILL_LABEL[s]}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-0.5">
              <Select size="sm" value={status} placeholder="全部状态" onChange={setStatus} options={Object.entries(STATUS_LABEL).map(([k, v]) => ({ value: k, label: v }))} />
              <input className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-600" placeholder={skill === "READING" ? "搜索篇章标题/正文..." : "搜索题干..."} value={q} onChange={(e) => setQ(e.target.value)} />
              <span className="ml-auto self-center rounded-md bg-teal-50 px-2 py-1 text-xs font-medium text-teal-700">
                {skill === "READING" ? `阅读篇章 ${passages.length} 篇` : `${SKILL_LABEL[skill]} ${questions.length} 题`}
              </span>
            </div>
          </div>
          {skill === "READING" && (
          <div className="space-y-3 p-3">
            {passages.length === 0 && (
              <p className="py-8 text-center text-sm text-slate-400">暂无阅读篇章,点右上「+ 新建阅读篇章」或「导入阅读篇章(PDF)」</p>
            )}
              {passages.map((p) => {
                const open = !!expanded[p.id];
                const pending = (p.statusCount.PENDING_REVIEW || 0) + (p.statusCount.REJECTED || 0);
                return (
                  <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                    <div className="flex flex-wrap items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="mb-1 flex flex-wrap items-center gap-1.5">
                          <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-700">{EXAM_LABEL[p.examType] || p.examType}</span>
                          <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-600">阅读篇章</span>
                          <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{p.questionCount} 题</span>
                          {Object.entries(p.statusCount).map(([k, v]) => (
                            <span key={k} className={`rounded-md px-1.5 py-0.5 text-xs ${k === "PUBLISHED" ? "bg-emerald-50 text-emerald-600" : k === "REJECTED" ? "bg-red-50 text-red-600" : k === "PENDING_REVIEW" ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"}`}>
                              {STATUS_LABEL[k] || k} {v}
                            </span>
                          ))}
                        </div>
                        <p className="text-sm font-semibold text-slate-800">{p.title || "未命名篇章"}</p>
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{p.content.slice(0, 160)}</p>
                        <p className="mt-1 text-xs text-slate-400">
                          题型: {Object.entries(p.typeCount).map(([k, v]) => `${QTYPE_LABEL[k] || k}×${v}`).join(" · ") || "—"} · 约 {p.content.trim().split(/\s+/).length} 词
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {pending > 0 && (
                          <button className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700" onClick={() => reviewPassage(p.id, true)}>整篇通过</button>
                        )}
                        {(p.statusCount.PUBLISHED || 0) > 0 && (
                          <button className="rounded-md bg-red-100 px-2.5 py-1 text-xs text-red-600 hover:bg-red-200" onClick={() => reviewPassage(p.id, false)}>整篇退回</button>
                        )}
                        <button className="rounded-md bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200" onClick={() => { setPassageDraft(null); setEditingPassage(p); }}>编辑整篇</button>
                        <button className="rounded-md bg-red-50 px-2.5 py-1 text-xs text-red-500 hover:bg-red-100" onClick={() => delPassage(p)}>删除整篇</button>
                        <button className="rounded-md bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200" onClick={() => setExpanded((s) => ({ ...s, [p.id]: !open }))}>{open ? "收起题目" : "展开题目"}</button>
                      </div>
                    </div>
                    {open && (
                      <div className="mt-3 space-y-1.5 rounded-xl bg-slate-50 p-3">
                        {p.questions.map((qq, qi) => (
                          <div key={qq.id} className="flex flex-wrap items-start gap-2 rounded-lg bg-white px-3 py-2">
                            <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-bold text-indigo-600">Q{qi + 1}</span>
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{QTYPE_LABEL[qq.qType] || qq.qType}</span>
                            <span className="min-w-0 flex-1 text-xs text-slate-700">{qq.stem}</span>
                            <span className="text-xs text-emerald-600">答案: {qq.answer || "—"}</span>
                            <button className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-200" onClick={() => setEditing(qq)}>单题编辑</button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
          )}
          {skill !== "READING" && (
            <div className="divide-y divide-slate-100">
              {questions.length === 0 && (
                <p className="py-8 text-center text-sm text-slate-400">暂无{SKILL_LABEL[skill]}题目,点右上「+ 新增{SKILL_LABEL[skill]}题目」录入</p>
              )}
              {questions.map((item) => (
                <div key={item.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-1.5">
                      <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-700">{EXAM_LABEL[item.examType] || item.examType}</span>
                      <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-600">{SKILL_LABEL[item.skill]}</span>
                      <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">{QTYPE_LABEL[item.qType] || item.qType}</span>
                      {item.audioUrl && <span className="rounded-md bg-amber-50 px-1.5 py-0.5 text-xs text-amber-600">🔊 音频</span>}
                      <span className={`rounded-md px-1.5 py-0.5 text-xs ${item.status === "PUBLISHED" ? "bg-emerald-50 text-emerald-600" : item.status === "REJECTED" ? "bg-red-50 text-red-600" : item.status === "PENDING_REVIEW" ? "bg-amber-50 text-amber-600" : "bg-slate-100 text-slate-500"}`}>
                        {STATUS_LABEL[item.status] || item.status}
                      </span>
                    </div>
                    {item.groupTitle && <p className="text-xs font-semibold text-slate-500">{item.groupTitle}</p>}
                    <p className="line-clamp-2 text-sm text-slate-700">{item.stem}</p>
                    {item.reviewNote && <p className="mt-0.5 text-xs text-red-500">退回原因: {item.reviewNote}</p>}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {(item.status === "PENDING_REVIEW" || item.status === "REJECTED") && (
                      <button className="rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700" onClick={() => reviewQuestion(item.id, true)}>通过</button>
                    )}
                    {item.status === "PUBLISHED" && (
                      <button className="rounded-md bg-red-100 px-2.5 py-1 text-xs text-red-600 hover:bg-red-200" onClick={() => reviewQuestion(item.id, false)}>退回</button>
                    )}
                    <button className="rounded-md bg-slate-100 px-2.5 py-1 text-xs text-slate-600 hover:bg-slate-200" onClick={() => setEditing(item)}>编辑</button>
                    <button className="rounded-md bg-red-50 px-2.5 py-1 text-xs text-red-500 hover:bg-red-100" onClick={() => delQuestion(item.id)}>删除</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {!loading && tab === "papers" && (
        <div className="grid gap-3 md:grid-cols-2">
          {papers.length === 0 && <p className="col-span-2 py-8 text-center text-sm text-slate-400">暂无语言卷</p>}
          {papers.map((p) => (
            <div key={p.id} className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-2 flex flex-wrap items-center gap-1.5">
                <span className="rounded-md bg-teal-50 px-1.5 py-0.5 text-xs font-medium text-teal-700">{EXAM_LABEL[p.examType]}</span>
                <span className="rounded-md bg-indigo-50 px-1.5 py-0.5 text-xs font-medium text-indigo-600">{SKILL_LABEL[p.skill]}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-xs ${p.kind === "OFFICIAL" ? "bg-cyan-50 text-cyan-700" : "bg-purple-50 text-purple-700"}`}>{p.kind === "OFFICIAL" ? "原版" : "组卷"}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-xs ${p.status === "READY" ? "bg-emerald-50 text-emerald-600" : "bg-slate-100 text-slate-500"}`}>{p.status === "READY" ? "已开放" : p.status}</span>
              </div>
              <p className="text-sm font-semibold text-slate-800">{p.title}</p>
              <p className="mt-1 text-xs text-slate-500">
                {p.questionCount} 题 · {p.mode === "EXAM" ? `限时 ${p.durationMin ?? ""} 分钟` : "练习"}
                {p.segments.length > 0 && ` · ${p.segments.map((s) => `${SKILL_LABEL[s.skill]}${s.durationMin}min`).join("→")}`}
              </p>
              <div className="mt-3 flex gap-2">
                <button className="rounded-md bg-indigo-600 px-3 py-1 text-xs font-medium text-white hover:bg-indigo-700" onClick={() => { setAssignPaperId(p.id); setShowAssign(true); }}>布置</button>
                <button className="rounded-md bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-slate-200" onClick={() => managePaper(p)}>管理</button>
                <button className="rounded-md bg-red-50 px-3 py-1 text-xs text-red-500 hover:bg-red-100" onClick={() => delPaper(p.id)}>删除</button>
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && tab === "grading" && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {review.length === 0 && <p className="py-8 text-center text-sm text-slate-400">暂无待批改的写作/口语作答</p>}
            {review.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700">{r.student.name} <span className="text-xs font-normal text-slate-400">{r.student.email}</span></p>
                  <p className="mt-0.5 text-xs text-slate-500">{EXAM_LABEL[r.examType]} {SKILL_LABEL[r.skill]} · 提交于 {fmtDate(r.submittedAt)} · {r.totalSub} 项待批 {r.pendingSub > 0 && <span className="text-amber-600">({r.pendingSub} 未评)</span>}</p>
                </div>
                <button className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700" onClick={() => setGradingSession(r.id)}>去批改</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {!loading && tab === "assign" && (
        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="divide-y divide-slate-100">
            {assigns.length === 0 && <p className="py-8 text-center text-sm text-slate-400">尚未布置语言作业</p>}
            {assigns.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700">{a.title}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {a.languagePaper ? `${EXAM_LABEL[a.languagePaper.examType] || a.languagePaper.examType} ${SKILL_LABEL[a.languagePaper.skill] || a.languagePaper.skill} · ${a.languagePaper.title}` : "学科卷"}
                    {a.dueAt ? ` · DDL ${fmtDate(a.dueAt)}` : " · 不限时"}
                  </p>
                </div>
                <div className="text-xs text-slate-500">
                  已交 <b className="text-emerald-600">{a.stats.submitted}</b> / 进行中 <b className="text-amber-600">{a.stats.inProgress}</b> / 未交 <b>{a.stats.pending}</b>
                </div>
                <button className="rounded-md bg-slate-100 px-3 py-1 text-xs text-slate-600 hover:bg-slate-200" onClick={() => api.get(`/teacher/assignments/${a.id}`).then((d: any) => setAssignDetail(d)).catch((e) => setErr(e.message))}>详情</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {assignDetail && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 pt-10" onClick={() => setAssignDetail(null)}>
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="mb-3 text-lg font-bold text-slate-800">{assignDetail.title}</h3>
            <div className="mb-3 text-xs text-slate-500">
              {assignDetail.languagePaper ? `${EXAM_LABEL[assignDetail.languagePaper.examType]} ${SKILL_LABEL[assignDetail.languagePaper.skill]} · ${assignDetail.languagePaper.title}` : ""}
              {assignDetail.note && <p className="mt-1">备注: {assignDetail.note}</p>}
            </div>
            <div className="divide-y divide-slate-100 rounded-lg border border-slate-200">
              {assignDetail.targets.map((t: any) => (
                <div key={t.studentId} className="flex items-center justify-between px-3 py-2">
                  <span className="text-sm text-slate-700">{t.name}</span>
                  <span className={`text-xs ${t.status === "SUBMITTED" ? "text-emerald-600" : t.status === "IN_PROGRESS" ? "text-amber-600" : "text-slate-400"}`}>
                    {t.status === "SUBMITTED" ? `已交${t.submittedAt ? ` ${fmtDate(t.submittedAt)}` : ""}` : t.status === "IN_PROGRESS" ? "进行中" : "未交"}
                  </span>
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end">
              <button className="rounded-lg px-4 py-2 text-sm text-slate-500 hover:bg-slate-100" onClick={() => setAssignDetail(null)}>关闭</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <QuestionForm
          initial={editing === "new" ? null : editing}
          defaults={{ examType, skill }}
          onSaved={() => { loadPassages(); loadAllPassages(); loadQuestions(); loadPub(); }}
          onClose={() => setEditing(null)}
        />
      )}
      {showPaper && (
        <PaperForm
          allQuestions={pubQuestions}
          passages={allPassages}
          initial={editingPaper}
          onSaved={() => { loadPapers(); }}
          onClose={() => { setShowPaper(false); setEditingPaper(null); }}
        />
      )}
      {showPassageImport && (
        <PassageImportModal
          onPick={(d) => { setPassageDraft(d); setEditingPassage("new"); }}
          onClose={() => setShowPassageImport(false)}
        />
      )}
      {editingPassage && (
        <PassageForm
          initial={editingPassage === "new" ? null : editingPassage}
          draft={editingPassage === "new" ? passageDraft : null}
          onSaved={() => { loadPassages(); loadAllPassages(); loadPub(); }}
          onClose={() => { setEditingPassage(null); setPassageDraft(null); }}
        />
      )}
      {/* 面板切换用的提示变量(供"布置"快捷入口预选卷) */}
      {showAssign && <AssignmentModal papers={assignPapers} initialPaperId={assignPaperId} onSaved={() => { loadAssigns(); }} onClose={() => { setShowAssign(false); setAssignPaperId(undefined); }} />}
      {gradingSession && <GradingModal sessionId={gradingSession} onClose={() => { setGradingSession(null); loadReview(); }} />}
    </div>
  );
}
