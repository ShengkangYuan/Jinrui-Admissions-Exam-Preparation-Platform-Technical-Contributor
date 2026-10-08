"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface MyQ {
  id: string;
  subject: string;
  topic: string;
  difficulty: number;
  type: string;
  stem: string;
  options: string[];
  answer: string;
  solution: string | null;
  status: string;
  reviewNote: string | null;
  createdAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "草稿",
  PENDING_REVIEW: "待审核",
  PUBLISHED: "已入库",
  REJECTED: "已驳回",
};
const STATUS_CLASS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-500",
  PENDING_REVIEW: "bg-amber-50 text-amber-700",
  PUBLISHED: "bg-emerald-50 text-emerald-600",
  REJECTED: "bg-red-50 text-red-600",
};

const input = "w-full rounded-lg border border-slate-300 bg-white px-2.5 py-2 text-sm outline-none focus:border-indigo-500";
const LETTERS = ["A", "B", "C", "D", "E", "F", "G", "H"];

const EMPTY_FORM = { subject: "数学", topic: "", difficulty: "3", stem: "", options: ["", "", "", ""], answer: "", solution: "" };

export default function MyQuestionsPage() {
  const [list, setList] = useState<MyQ[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState("");
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [recog, setRecog] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(() => {
    setLoading(true);
    api.get<{ list: MyQ[] }>("/me/questions")
      .then((d) => setList(d.list || []))
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);
  useEffect(() => { load(); }, [load]);

  const flash = (t: string) => { setMsg(t); setTimeout(() => setMsg(""), 4000); };

  const canSubmit = list.some((q) => q.status === "DRAFT");

  async function saveQ() {
    setError("");
    const opts = form.options.map((o) => o.trim()).filter(Boolean);
    if (!form.stem.trim()) { setError("请填写题干"); return; }
    if (opts.length < 2) { setError("选项至少 2 个"); return; }
    if (!form.answer.trim()) { setError("请填写正确答案"); return; }
    setBusy(true);
    try {
      const body = {
        subject: form.subject,
        topic: form.topic,
        difficulty: Number(form.difficulty),
        stem: form.stem,
        options: opts,
        answer: form.answer,
        solution: form.solution,
      };
      if (editingId) await api.put(`/me/questions/${editingId}`, body);
      else await api.post("/me/questions", body);
      setOpen(false);
      setEditingId(null);
      setForm(EMPTY_FORM);
      await load();
      flash(editingId ? "已保存" : "原创题已保存为草稿,提交审核后可入库");
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  function openCreate() {
    setError("");
    setEditingId(null);
    setForm(EMPTY_FORM);
    setOpen(true);
  }

  function openEdit(q: MyQ) {
    setError("");
    setEditingId(q.id);
    setForm({
      subject: q.subject,
      topic: q.topic,
      difficulty: String(q.difficulty),
      stem: q.stem,
      options: [...q.options, ...Array(Math.max(0, 4 - q.options.length)).fill("")].slice(0, 4),
      answer: q.answer,
      solution: q.solution || "",
    });
    setOpen(true);
  }

  async function submitBatch() {
    if (selected.size === 0) { setError("请先勾选要提交审核的题目"); return; }
    setBusy(true);
    try {
      await api.post("/me/questions/submit", { ids: Array.from(selected) });
      setSelected(new Set());
      await load();
      flash("已提交审核,请等待老师处理");
    } catch (e) {
      setError(e instanceof Error ? e.message : "提交失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeQ(id: string) {
    if (!window.confirm("确认删除这道原创题?")) return;
    try {
      await api.del(`/me/questions/${id}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  }

  // 粘贴截图 → 图片识别预填
  async function handlePaste(e: React.ClipboardEvent<HTMLTextAreaElement>) {
    const items = e.clipboardData?.items ? Array.from(e.clipboardData.items) : [];
    if (!items.length) return;
    for (const it of items) {
      if (it.type.startsWith("image/")) {
        const file = it.getAsFile();
        if (!file) continue;
        e.preventDefault();
        setRecog(true);
        setError("");
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result));
            r.onerror = () => reject(new Error("读取图片失败"));
            r.readAsDataURL(file);
          });
          const d = await api.post<{ subject: string; options: string[]; answer: string; stem: string; solution: string | null }>(
            "/me/questions/import-image", { data: dataUrl }
          );
          setForm((f) => ({
            ...f,
            subject: d.subject || f.subject,
            stem: d.stem || f.stem,
            options: [...(d.options || []), ...Array(Math.max(0, 4 - (d.options?.length || 0))).fill("")].slice(0, 4),
            answer: d.answer || f.answer,
            solution: d.solution || f.solution,
          }));
          flash("识别成功,请核对题目内容后保存");
        } catch (err) {
          setError(err instanceof Error ? err.message : "识别失败");
        } finally {
          setRecog(false);
        }
        break;
      }
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold">✏️ 我的原创题</h1>
          <p className="mt-1 text-sm text-slate-500">自己上传/新建题目,提交老师审核通过后进入题库(题源标注「学生原创题」)</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => window.history.back()} className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-600 hover:bg-slate-50">
            ← 返回
          </button>
          <button onClick={openCreate} className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
            + 新建题目
          </button>
        </div>
      </div>

      {msg && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}

      {list.length > 0 && (
        <div className="flex items-center justify-between rounded-xl bg-white px-4 py-2.5 shadow-sm">
          <span className="text-sm text-slate-600">已选 {selected.size} 题</span>
          <button
            onClick={submitBatch}
            disabled={busy || selected.size === 0}
            className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "提交中..." : "批量提交审核"}
          </button>
        </div>
      )}

      {loading ? (
        <p className="py-10 text-center text-sm text-slate-400">加载中...</p>
      ) : list.length === 0 ? (
        <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-sm text-slate-400">
          还没有原创题。点「+ 新建题目」手动录入,或在题干框里直接<strong>粘贴截图</strong>(自动识别)生成题目。
        </p>
      ) : (
        list.map((q) => (
          <div key={q.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex flex-wrap items-center gap-2">
              {q.status === "DRAFT" && (
                <input
                  type="checkbox"
                  checked={selected.has(q.id)}
                  onChange={() => setSelected((prev) => { const n = new Set(prev); if (n.has(q.id)) n.delete(q.id); else n.add(q.id); return n; })}
                  className="h-4 w-4 accent-indigo-600"
                  title="勾选后批量提交审核"
                />
              )}
              <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[q.status] ?? "bg-slate-100 text-slate-500"}`}>
                {STATUS_LABEL[q.status] ?? q.status}
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">{q.subject}</span>
              <span className="rounded-full bg-indigo-50 px-2 py-0.5 text-[11px] text-indigo-600">{q.topic || "未分类"}</span>
              <span className="text-xs text-slate-400">难度 {q.difficulty} · {new Date(q.createdAt).toLocaleString("zh-CN", { hour12: false })}</span>
              <div className="ml-auto flex gap-2">
                {q.status === "DRAFT" && (
                  <button onClick={() => openEdit(q)} className="text-xs text-indigo-600 hover:underline">编辑</button>
                )}
                {(q.status === "DRAFT" || q.status === "REJECTED") && (
                  <button onClick={() => removeQ(q.id)} className="text-xs text-red-500 hover:underline">删除</button>
                )}
              </div>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-[15px] leading-relaxed text-slate-800">{q.stem}</p>
            <div className="mt-2 space-y-1">
              {q.options.map((opt, j) => {
                const isAns = opt === q.answer;
                return (
                  <div key={j} className={`rounded px-3 py-1 text-[14px] ${isAns ? "bg-emerald-50 font-medium text-emerald-800" : "text-slate-600"}`}>
                    <span className="mr-1 font-bold text-indigo-600">{LETTERS[j]}.</span>
                    {opt}
                    {isAns && <span className="ml-2 text-xs text-emerald-600">✓</span>}
                  </div>
                );
              })}
            </div>
            {q.status === "REJECTED" && q.reviewNote && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">驳回原因:{q.reviewNote}</p>
            )}
            {q.status === "PUBLISHED" && (
              <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-600">已通过审核入库,所有学生都能做到这道题(题源标注:学生原创题)</p>
            )}
          </div>
        ))
      )}

      {/* 新建/编辑弹窗 */}
      {open && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={() => !busy && setOpen(false)}>
          <div className="mt-6 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">{editingId ? "编辑原创题" : "新建原创题"}</h2>
              <button onClick={() => !busy && setOpen(false)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-3">
              <div>
                <label className="mb-1 block text-sm text-slate-600">科目</label>
                <select className={`${input} ui-select`} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })}>
                  <option value="数学">数学</option>
                  <option value="物理">物理</option>
                  <option value="化学">化学</option>
                  <option value="生物">生物</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">知识点</label>
                <input className={input} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} placeholder="如:数列、微积分" />
              </div>
              <div>
                <label className="mb-1 block text-sm text-slate-600">难度</label>
                <select className={`${input} ui-select`} value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })}>
                  {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>难度 {n}</option>)}
                </select>
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1 flex items-center justify-between text-sm text-slate-600">
                <span>题干(可直接粘贴题目截图自动识别)</span>
                {recog && <span className="text-xs text-indigo-500">识别中...</span>}
              </label>
              <textarea
                className={`${input} min-h-[80px]`}
                value={form.stem}
                onChange={(e) => setForm({ ...form, stem: e.target.value })}
                placeholder="粘贴图片(Ctrl/Cmd+V)可自动识别题干、选项与答案;也可直接输入题干"
                onPaste={handlePaste}
              />
            </div>

            <div className="mt-3 grid grid-cols-2 gap-2">
              {form.options.map((opt, j) => (
                <div key={j}>
                  <label className="mb-1 block text-sm text-slate-600">选项 {LETTERS[j]}</label>
                  <input
                    className={input}
                    value={opt}
                    onChange={(e) => setForm((f) => ({ ...f, options: f.options.map((o, i) => (i === j ? e.target.value : o)) }))}
                  />
                </div>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm text-slate-600">正确答案</label>
                <select className={`${input} ui-select`} value={form.answer} onChange={(e) => setForm({ ...form, answer: e.target.value })}>
                  <option value="">选择正确选项</option>
                  {form.options.map((opt, j) => opt.trim() ? (
                    <option key={j} value={opt}>{LETTERS[j]}. {opt}</option>
                  ) : null)}
                </select>
              </div>
            </div>

            <div className="mt-3">
              <label className="mb-1 block text-sm text-slate-600">解析(可选)</label>
              <textarea className={`${input} min-h-[60px]`} value={form.solution} onChange={(e) => setForm({ ...form, solution: e.target.value })} placeholder="答案解析" />
            </div>

            <p className="mt-3 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              保存后为草稿,勾选后「批量提交审核」交给老师;审核通过后入库,题源标注「学生原创题」并永久标记你的姓名。
            </p>
            {error && open && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>}
            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setOpen(false)} disabled={busy} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                取消
              </button>
              <button onClick={saveQ} disabled={busy} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                {busy ? "保存中..." : "保存草稿"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
