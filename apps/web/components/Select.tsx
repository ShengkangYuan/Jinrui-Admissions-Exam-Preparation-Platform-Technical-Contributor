"use client";

import { useEffect, useRef, useState } from "react";

export interface SelectOption {
  value: string;
  label: string;
}

interface SelectProps {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  /** 占位文案:当 value 为空时展示,并作为值为 "" 的首选项 */
  placeholder?: string;
  /** 覆盖触发按钮样式(默认与输入框一致) */
  className?: string;
  /** sm:紧凑尺寸,用于筛选/小卡片内;md:标准尺寸(默认) */
  size?: "sm" | "md";
  /** 面板对齐方向 */
  align?: "left" | "right";
}

/**
 * 语言模块统一下拉组件
 * —— 触发态外观与表单输入框(rounded-lg border-slate-200)保持一致
 * —— 展开面板与「填选窗口」弹窗(rounded-2xl bg-white shadow-xl)保持统一风格
 */
export default function Select({ value, onChange, options, placeholder, className, size = "md", align = "left" }: SelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const allOptions = placeholder ? [{ value: "", label: placeholder }, ...options] : options;
  const selected = allOptions.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function choose(v: string) {
    onChange(v);
    setOpen(false);
  }

  function onTriggerKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      setOpen((o) => !o);
    }
  }

  const triggerBase =
    size === "sm"
      ? "rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-sm text-slate-700"
      : "rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700";

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`flex w-full items-center justify-between gap-2 text-left transition focus:border-indigo-400 focus:outline-none ${className || triggerBase}`}
      >
        <span className={`truncate ${selected ? "" : "text-slate-400"}`}>{selected?.label ?? placeholder ?? "请选择"}</span>
        <svg
          className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`}
          width="14" height="14" viewBox="0 0 20 20" fill="currentColor"
        >
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div
          role="listbox"
          className={`absolute z-50 mt-1 max-h-64 w-full overflow-y-auto rounded-2xl border border-slate-100 bg-white p-1.5 shadow-xl ${align === "right" ? "right-0" : "left-0"}`}
        >
          {allOptions.map((o) => {
            const isSel = o.value === value;
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isSel}
                onClick={() => choose(o.value)}
                className={`flex w-full items-center justify-between gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${isSel ? "bg-indigo-50 font-medium text-indigo-700" : "text-slate-700 hover:bg-slate-50"}`}
              >
                <span className="truncate">{o.label}</span>
                {isSel && (
                  <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" className="shrink-0 text-indigo-600">
                    <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0l-3.5-3.5a1 1 0 111.4-1.4l2.8 2.79 6.8-6.79a1 1 0 011.4 0z" clipRule="evenodd" />
                  </svg>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
