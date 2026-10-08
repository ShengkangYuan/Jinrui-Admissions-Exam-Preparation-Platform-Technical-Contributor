"use client";
// 题目编辑弹窗(可复用):新建/编辑题目。在「题库管理」「试卷组卷详情」等处原地弹出。
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { renderRich } from "@/lib/rich";
import { fetchSourceTypes } from "@/lib/sourceTypes";
import type { Question } from "@/lib/types";

const input = "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-indigo-500";

function parseJsonIds(s: unknown): string[] {
  if (Array.isArray(s)) return s;
  try {
    const v = JSON.parse(String(s || "[]"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
function parseOptions(q: Question | null): string[] {
  if (!q) return [];
  if (Array.isArray(q.options)) return q.options;
  try {
    const v = JSON.parse(String(q.options || "[]"));
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export default function QuestionEditModal({
  q,
  onClose,
  onSaved,
}: {
  q: Question | null; // null = 新建
  onClose: () => void;
  onSaved: (updated: Question) => void;
}) {
  const [form, setForm] = useState(() => ({
    id: q?.id ?? null,
    subject: q?.subject || "数学",
    sourceType: q?.sourceType ?? "",
    paper: q?.paper ?? "",
    topic: q?.topic ?? "",
    topicIds: parseJsonIds(q?.topicIds),
    difficulty: q?.difficulty ?? 3,
    type: q?.type || "SINGLE_CHOICE",
    stem: q?.stem ?? "",
    optionsText: parseOptions(q).join("\n"),
    answer: q?.answer ?? "",
    solution: q?.solution ?? "",
    status: q?.status || "PENDING_REVIEW",
  }));
  const [kps, setKps] = useState<{ id: string; name: string; subject: string }[]>([]);
  const [sourceTypes, setSourceTypes] = useState<string[]>([]);
  useEffect(() => {
    fetchSourceTypes().then(setSourceTypes).catch(() => {});
  }, []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadField, setUploadField] = useState<"stem" | "optionsText" | "solution">("stem");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const stemRef = useRef<HTMLTextAreaElement>(null);
  const optionsRef = useRef<HTMLTextAreaElement>(null);
  const solutionRef = useRef<HTMLTextAreaElement>(null);

  // 知识点库按当前学科加载
  useEffect(() => {
    api
      .get<{ list: { id: string; name: string; subject: string }[] }>(`/knowledge-points?subject=${encodeURIComponent(form.subject)}`)
      .then((d) => setKps(d.list || []))
      .catch(() => setKps([]));
  }, [form.subject]);

  async function uploadImage(file: File) {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error("读取文件失败"));
      r.readAsDataURL(file);
    });
    const d = await api.post<{ url: string }>("/uploads", { filename: file.name, data: dataUrl });
    return d.url;
  }

  function insertImage(field: "stem" | "optionsText" | "solution", url: string) {
    setForm((prev) => ({ ...prev, [field]: (prev[field] + `\n![图](${url})`).trim() }));
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setUploading(true);
    setError("");
    try {
      const url = await uploadImage(f);
      insertImage(uploadField, url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "上传失败");
    } finally {
      setUploading(false);
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>, field: "stem" | "optionsText" | "solution") {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (it.kind === "file" && it.type.startsWith("image/")) {
        e.preventDefault();
        const f = it.getAsFile();
        if (!f) return;
        setUploading(true);
        setError("");
        uploadImage(f)
          .then((url) => insertImage(field, url))
          .catch((err) => setError(err instanceof Error ? err.message : "上传失败"))
          .finally(() => setUploading(false));
        break;
      }
    }
  }

  async function submit() {
    setError("");
    const options = form.optionsText.split("\n").map((s) => s.trim()).filter(Boolean);
    if (options.length < 2) {
      setError("选项至少 2 个,每行一个");
      return;
    }
    if (!form.answer) {
      setError("请填写正确答案(内容需与某选项一致)");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        subject: form.subject,
        sourceType: form.sourceType || null,
        paper: form.paper || null,
        topic: form.topic,
        topicIds: form.topicIds,
        difficulty: Number(form.difficulty),
        type: form.type,
        stem: form.stem,
        options,
        answer: form.answer,
        solution: form.solution || null,
        status: form.status,
      };
      const updated = form.id
        ? await api.put<Question>(`/questions/${form.id}`, payload)
        : await api.post<Question>("/questions", payload);
      onSaved(updated);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 backdrop-blur-sm" onClick={() => !saving && !uploading && onClose()}>
      <div className="mt-6 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-2xl ring-1 ring-slate-200" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-slate-800">{form.id ? "编辑本题" : "新建题目"}</h2>
          <button onClick={() => !saving && !uploading && onClose()} className="text-slate-400 hover:text-slate-600" aria-label="关闭">✕</button>
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
              list="qem-source-types"
              value={form.sourceType}
              onChange={(e) => setForm({ ...form, sourceType: e.target.value })}
              placeholder="TMUA / ESAT / NSAA / MAT / 其他…"
            />
            <datalist id="qem-source-types">
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
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-sm text-slate-600">难度(1-5)</label>
              <input className={input} type="number" min={1} max={5} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: Number(e.target.value) })} />
            </div>
            <div>
              <label className="mb-1 block text-sm text-slate-600">状态</label>
              <select className={`${input} ui-select`} value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value as Question["status"] })}>
                <option value="PENDING_REVIEW">待审核(默认)</option>
                <option value="DRAFT">草稿(暂不提交)</option>
                <option value="PUBLISHED">发布</option>
                <option value="REJECTED">已退回</option>
                <option value="ARCHIVED">下架</option>
              </select>
            </div>
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
                      <button type="button" onClick={() => setForm({ ...form, topicIds: form.topicIds.filter((x) => x !== id) })} className="text-white/70 hover:text-white" aria-label="移除">×</button>
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
            {kps.length === 0 && <p className="mt-1 text-xs text-amber-500">该学科暂无知识点,请先到「知识点管理」页添加</p>}
          </div>
        </div>

        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between">
            <label className="block text-sm text-slate-600">题干(支持公式 `$x^2$`、图片 `![说明](url)`;可直接粘贴截图)</label>
            <button type="button" onClick={() => { setUploadField("stem"); fileInputRef.current?.click(); }} disabled={uploading} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">📷 上传图片</button>
          </div>
          <textarea ref={stemRef} className={`${input} h-20`} value={form.stem} onChange={(e) => setForm({ ...form, stem: e.target.value })} onPaste={(e) => handlePaste(e, "stem")} placeholder="输入题干... 公式用 $ 包裹,截图可直接粘贴到此" />
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
              <button type="button" onClick={() => { setUploadField("optionsText"); fileInputRef.current?.click(); }} disabled={uploading} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">📷 上传</button>
            </div>
            <textarea ref={optionsRef} className={`${input} h-24`} value={form.optionsText} onChange={(e) => setForm({ ...form, optionsText: e.target.value })} onPaste={(e) => handlePaste(e, "optionsText")} placeholder={"A 选项内容\nB 选项内容\n$\\sqrt{2}$ 或 ![图](/uploads/xx.png)"} />
          </div>
          <div>
            <label className="mb-1 block text-sm text-slate-600">正确答案</label>
            <input className={input} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })} placeholder="与某选项内容一致" />
            <div className="mb-1 mt-3 flex items-center justify-between">
              <label className="block text-sm text-slate-600">解析</label>
              <button type="button" onClick={() => { setUploadField("solution"); fileInputRef.current?.click(); }} disabled={uploading} className="rounded-md border border-slate-300 px-2 py-1 text-xs text-slate-600 hover:bg-slate-50 disabled:opacity-50">📷 上传图片</button>
            </div>
            <textarea ref={solutionRef} className={`${input} h-14`} value={form.solution} onChange={(e) => setForm({ ...form, solution: e.target.value })} onPaste={(e) => handlePaste(e, "solution")} placeholder="解题思路(可选,支持 ![说明](/uploads/xx.png),可直接粘贴截图)" />
          </div>
        </div>

        {uploading && <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-600">图片上传中…</p>}
        <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={handleFile} />
        {error && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

        <div className="mt-5 flex justify-end gap-3">
          <button onClick={() => !saving && !uploading && onClose()} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
            取消
          </button>
          <button onClick={submit} disabled={saving || uploading} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
            {saving ? "保存中..." : "保存"}
          </button>
        </div>
      </div>
    </div>
  );
}
