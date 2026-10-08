"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api";
import type { GroupSummary, GroupAssignment } from "@/lib/types";
import ExamAnalysisView from "@/components/ExamAnalysisView";

interface StudentOption {
  id: string;
  name: string;
  email: string;
}

export default function GroupsPanel() {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [students, setStudents] = useState<StudentOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");

  // 新建分组表单
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newNote, setNewNote] = useState("");

  // 成员管理弹窗
  const [manageId, setManageId] = useState<string | null>(null);
  const [manageSel, setManageSel] = useState<Set<string>>(new Set());
  const [searchM, setSearchM] = useState("");
  const [savingMembers, setSavingMembers] = useState(false);

  const flash = (t: string) => {
    setMsg(t);
    setTimeout(() => setMsg(""), 3000);
  };

  const loadGroups = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get<{ list: GroupSummary[] }>("/teacher/groups");
      setGroups(d.list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "分组加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGroups();
    api.get<{ list: StudentOption[] }>("/teacher/students").then((d) => setStudents(d.list || [])).catch(() => {});
  }, [loadGroups]);

  async function createGroup() {
    const name = newName.trim();
    if (!name) {
      setErr("请填写分组名称");
      return;
    }
    setErr("");
    try {
      await api.post("/teacher/groups", { name, note: newNote.trim() || undefined });
      flash(`已创建分组「${name}」`);
      setNewName("");
      setNewNote("");
      setCreating(false);
      await loadGroups();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "创建失败");
    }
  }

  async function renameGroup(g: GroupSummary) {
    const name = window.prompt("修改分组名称", g.name);
    if (name == null) return;
    if (!name.trim()) {
      setErr("分组名称不能为空");
      return;
    }
    setErr("");
    try {
      await api.put(`/teacher/groups/${g.id}`, { name: name.trim(), note: g.note });
      flash("分组已重命名");
      await loadGroups();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "操作失败");
    }
  }

  async function deleteGroup(g: GroupSummary) {
    if (!window.confirm(`确认删除分组「${g.name}」?该分组仅用于快捷选择,不会删除组内学生。`)) return;
    setErr("");
    try {
      await api.del(`/teacher/groups/${g.id}`);
      flash(`已删除分组「${g.name}」`);
      await loadGroups();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "删除失败");
    }
  }

  function openManage(g: GroupSummary) {
    setManageId(g.id);
    setManageSel(new Set(g.students.map((s) => s.id)));
    setSearchM("");
  }

  const filteredStudents = useMemo(() => {
    const kw = searchM.trim().toLowerCase();
    if (!kw) return students;
    return students.filter((s) => s.name.toLowerCase().includes(kw) || s.email.toLowerCase().includes(kw));
  }, [students, searchM]);

  function toggleMember(id: string) {
    setManageSel((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  }

  async function saveMembers() {
    if (manageId == null) return;
    setSavingMembers(true);
    setErr("");
    try {
      await api.put(`/teacher/groups/${manageId}/students`, { studentIds: Array.from(manageSel) });
      flash("分组成员已保存");
      setManageId(null);
      await loadGroups();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSavingMembers(false);
    }
  }

  // 抽屉:查看分组已布置的模考与作业
  const [viewGroup, setViewGroup] = useState<GroupSummary | null>(null);
  const [assignments, setAssignments] = useState<GroupAssignment[]>([]);
  const [drawerLoading, setDrawerLoading] = useState(false);
  const [drawerErr, setDrawerErr] = useState("");
  const [analysisExamId, setAnalysisExamId] = useState<string | null>(null);

  function closeDrawer() {
    setViewGroup(null);
    setAssignments([]);
    setAnalysisExamId(null);
    setDrawerErr("");
  }

  async function openAssignments(g: GroupSummary) {
    setViewGroup(g);
    setAnalysisExamId(null);
    setAssignments([]);
    setDrawerErr("");
    setDrawerLoading(true);
    try {
      const d = await api.get<{ groupId: string; groupName: string; list: GroupAssignment[] }>(`/teacher/groups/${g.id}/assignments`);
      setAssignments(d.list || []);
    } catch (e) {
      setDrawerErr(e instanceof Error ? e.message : "加载布置记录失败");
    } finally {
      setDrawerLoading(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-medium text-slate-700">学生分组</h2>
            <p className="mt-1 text-xs text-slate-400">把学生归入分组后,在「作业分发 / 考试管理」中即可按组一键布置,无需逐个勾选。</p>
          </div>
          <button
            onClick={() => setCreating((v) => !v)}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
          >
            {creating ? "收起" : "+ 新建分组"}
          </button>
        </div>

        {creating && (
          <div className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            <div className="md:col-span-1">
              <label className="mb-1 block text-sm text-slate-600">分组名称</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="如:2024届冲刺班"
                onKeyDown={(e) => e.key === "Enter" && createGroup()}
              />
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm text-slate-600">备注(可选)</label>
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                value={newNote}
                onChange={(e) => setNewNote(e.target.value)}
                placeholder="如:每周三模考对象"
                onKeyDown={(e) => e.key === "Enter" && createGroup()}
              />
            </div>
            <div className="md:col-span-3">
              <button
                onClick={createGroup}
                className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700"
              >
                创建分组
              </button>
            </div>
          </div>
        )}

        {msg && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{msg}</p>}
        {err && <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}

        <div className="mt-4">
          {loading ? (
            <p className="text-sm text-slate-400">加载中…</p>
          ) : groups.length === 0 ? (
            <p className="text-sm text-slate-400">还没有任何分组。点「新建分组」开始建立学生分组吧。</p>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {groups.map((g) => (
                <div key={g.id} className="rounded-xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium text-slate-800">{g.name}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {g.memberCount} 名学生{g.note ? ` · ${g.note}` : ""}
                      </p>
                    </div>
                    <div className="flex shrink-0 gap-1.5 text-xs">
                      <button onClick={() => openAssignments(g)} className="rounded border border-emerald-200 px-2 py-0.5 text-emerald-600 hover:bg-emerald-50">
                        查看布置
                      </button>
                      <button onClick={() => openManage(g)} className="rounded border border-indigo-200 px-2 py-0.5 text-indigo-600 hover:bg-indigo-50">
                        管理成员
                      </button>
                      <button onClick={() => renameGroup(g)} className="rounded border border-slate-200 px-2 py-0.5 text-slate-500 hover:bg-slate-50">
                        重命名
                      </button>
                      <button onClick={() => deleteGroup(g)} className="rounded border border-red-200 px-2 py-0.5 text-red-500 hover:bg-red-50">
                        删除
                      </button>
                    </div>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    {g.students.slice(0, 8).map((s) => (
                      <span key={s.id} className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-500">
                        {s.name}
                      </span>
                    ))}
                    {g.memberCount > 8 && (
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-400">+{g.memberCount - 8}</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 成员管理弹窗 */}
      {manageId && (
        <div className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={() => !savingMembers && setManageId(null)}>
          <div className="mt-8 w-full max-w-lg rounded-2xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">管理分组成员</h2>
              <button onClick={() => !savingMembers && setManageId(null)} className="text-slate-400 hover:text-slate-600">✕</button>
            </div>
            <p className="mt-1 text-xs text-slate-400">勾选要加入该分组的学生,保存后整组替换。已选 {manageSel.size} 人。</p>

            <div className="mt-3 flex items-center gap-2">
              <input
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-indigo-500"
                placeholder="搜索学生姓名/邮箱…"
                value={searchM}
                onChange={(e) => setSearchM(e.target.value)}
              />
              <button
                onClick={() => setManageSel((prev) => (prev.size === filteredStudents.length ? new Set() : new Set(filteredStudents.map((s) => s.id))))}
                className="shrink-0 text-xs text-indigo-600 hover:underline"
              >
                {manageSel.size === students.length ? "取消全选" : "全选"}
              </button>
            </div>

            <div className="mt-3 max-h-72 overflow-y-auto rounded-lg border border-slate-200 p-2">
              {students.length === 0 ? (
                <p className="text-xs text-slate-400">暂无学生账号。</p>
              ) : (
                <div className="grid grid-cols-1 gap-1">
                  {filteredStudents.map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1 text-sm hover:bg-slate-50">
                      <input type="checkbox" checked={manageSel.has(s.id)} onChange={() => toggleMember(s.id)} className="accent-indigo-600" />
                      <span className="truncate">{s.name}</span>
                      <span className="truncate text-xs text-slate-400">{s.email}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-5 flex justify-end gap-3">
              <button onClick={() => setManageId(null)} disabled={savingMembers} className="rounded-lg border border-slate-300 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                取消
              </button>
              <button onClick={saveMembers} disabled={savingMembers} className="rounded-lg bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60">
                {savingMembers ? "保存中..." : "保存成员"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 抽屉:查看分组已布置的模考与作业 */}
      {viewGroup && (
        <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" onClick={closeDrawer}>
          <div className="flex h-full w-full max-w-2xl flex-col bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
              <div className="min-w-0">
                <h2 className="truncate text-base font-bold text-slate-800">{viewGroup.name} · 已布置</h2>
                <p className="mt-0.5 text-xs text-slate-400">按组布置给该分组的模考与作业(共 {assignments.length} 项)</p>
              </div>
              <button onClick={closeDrawer} className="ml-3 shrink-0 text-slate-400 hover:text-slate-600">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {analysisExamId ? (
                <div>
                  <button
                    onClick={() => setAnalysisExamId(null)}
                    className="mb-3 rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    ← 返回布置列表
                  </button>
                  <ExamAnalysisView examId={analysisExamId} />
                </div>
              ) : drawerLoading ? (
                <p className="py-10 text-center text-sm text-slate-400">加载中…</p>
              ) : drawerErr ? (
                <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{drawerErr}</p>
              ) : assignments.length === 0 ? (
                <p className="py-10 text-center text-sm text-slate-400">该分组还没有通过「按组布置」布置的模考或作业。在作业分发 / 考试管理中选组布置后,会在这里出现。</p>
              ) : (
                <div className="space-y-3">
                  {assignments.map((a) => (
                    <div key={a.id} className="rounded-xl border border-slate-200 p-4">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${a.mode === "EXAM" ? "bg-indigo-50 text-indigo-600" : "bg-amber-50 text-amber-600"}`}>
                              {a.mode === "EXAM" ? "模考" : "作业"}
                            </span>
                            <span className="truncate font-medium text-slate-800">{a.title}</span>
                          </div>
                          <p className="mt-1 truncate text-xs text-slate-400">
                            {a.paperTitle || "—"}
                            {a.subject ? ` · ${a.subject}` : ""}
                            {a.dueAt ? ` · DDL ${new Date(a.dueAt).toLocaleString("zh-CN", { hour12: false })}` : ""}
                          </p>
                        </div>
                        {a.mode === "EXAM" && (
                          <button
                            onClick={() => setAnalysisExamId(a.id)}
                            className="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-700"
                          >
                            查看考情
                          </button>
                        )}
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                        <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                          <p className="text-slate-400">布置人数</p>
                          <p className="mt-0.5 font-medium text-slate-700">{a.stats.total}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                          <p className="text-slate-400">已交 / 进行中 / 未交</p>
                          <p className="mt-0.5 font-medium text-slate-700">
                            {a.stats.submitted} / {a.stats.inProgress} / {a.stats.notSubmitted}
                          </p>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                          <p className="text-slate-400">平均正确率</p>
                          <p className="mt-0.5 font-medium text-slate-700">{a.stats.avgAccuracy != null ? `${a.stats.avgAccuracy}%` : "—"}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 px-2 py-1.5">
                          <p className="text-slate-400">平均分</p>
                          <p className="mt-0.5 font-medium text-slate-700">{a.stats.avgScore != null ? `${a.stats.avgScore}` : "—"}</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
