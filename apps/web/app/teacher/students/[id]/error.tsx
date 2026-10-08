"use client";

import { useEffect } from "react";

/**
 * 路由级错误边界（App Router 约定的 error.tsx）。
 *
 * 为什么必须有这个文件：页面组件「函数体自己」抛出的错误（例如 Rules of Hooks 违反、
 * 数据取值 TypeError），用页面 return 里的 <PageErrorBoundary> 是拦不住的 ——
 * 那个边界是页面的**子组件**，页面自己抛错时它还没被挂载，错误会一路冒泡到根，
 * 于是浏览器只显示 Next.js 默认的 "Application error: a client-side exception has occurred"。
 * error.tsx 是**上层**边界，能接住这些错误并把真实 message/stack 显示出来。
 */
export default function StudentDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 同时打到 console，便于用户按 F12 复制完整堆栈
    console.error("[teacher/students/[id]] render error:", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl rounded-2xl border border-red-200 bg-red-50 p-6 text-sm text-red-700">
      <p className="text-base font-semibold">学情详情页渲染出错（已拦截，其他页面不受影响）</p>
      <p className="mt-2 whitespace-pre-wrap break-all font-mono text-[12px]">
        {error?.message || String(error)}
      </p>
      {error?.digest && <p className="mt-1 font-mono text-[11px] text-red-500">digest: {error.digest}</p>}
      <pre className="mt-3 max-h-56 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white/70 p-3 font-mono text-[10.5px] leading-relaxed text-red-600">
        {String(error?.stack || "").split("\n").slice(0, 12).join("\n")}
      </pre>
      <button
        type="button"
        onClick={reset}
        className="mt-3 rounded-md bg-red-600 px-3 py-1.5 text-[12px] font-semibold text-white"
      >
        重试
      </button>
      <p className="mt-2 text-[11px] text-red-500">
        若持续出现，请把上面这段文字截图反馈；硬刷新（Cmd/Ctrl+Shift+R）后重试。
      </p>
    </div>
  );
}
