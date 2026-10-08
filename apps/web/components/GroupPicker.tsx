"use client";

import { GroupSummary } from "@/lib/types";

// 紧凑的分组多选控件:以 chip 形式展示当前老师的分组,点击切换选中。
// 用于"作业分发 / 考试安排"的"按组布置"入口。
export default function GroupPicker({
  groups,
  selected,
  onToggle,
  label = "按分组选择(可选)",
}: {
  groups: GroupSummary[];
  selected: Set<string>;
  onToggle: (id: string) => void;
  label?: string;
}) {
  if (groups.length === 0) return null;
  return (
    <div className="mb-3">
      <label className="mb-1 block text-sm text-slate-600">{label}</label>
      <div className="flex flex-wrap gap-2">
        {groups.map((g) => {
          const on = selected.has(g.id);
          return (
            <button
              key={g.id}
              type="button"
              onClick={() => onToggle(g.id)}
              title={g.note || g.name}
              className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition ${
                on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${on ? "bg-indigo-500" : "bg-slate-300"}`} />
              {g.name}
              <span className="text-xs text-slate-400">{g.memberCount}人</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
