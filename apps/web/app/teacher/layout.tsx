"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearAuth, getUser } from "@/lib/api";
import { APP_VERSION } from "@/lib/version";
import BgmPlayer from "@/components/BgmPlayer";

export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<ReturnType<typeof getUser>>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u || u.role === "STUDENT") {
      router.replace("/login");
    } else {
      setUser(u);
      setReady(true);
    }
  }, [router]);

  if (!ready) return null;

  const nav = [
    { href: "/teacher", label: "题库管理" },
    { href: "/teacher/language", label: "语言学习" },
    { href: "/teacher/papers", label: "试卷组卷" },
    { href: "/teacher/students", label: "教学管理" },
    { href: "/teacher/knowledge", label: "知识点管理" },
    { href: "/teacher/student-questions", label: "原创题审核" },
    { href: "/teacher/planning", label: "升学规划" },
    // 仅最高权限管理员可见
    ...(user?.role === "ADMIN" ? [{ href: "/teacher/teachers", label: "教师管理" }] : []),
  ];

  // 导航标签固定断行：4 字 → 2+2，5 字 → 3+2，避免浏览器随机断行（如「题库管/理」）
  const splitLabel = (label: string): [string, string] =>
    label.length >= 5 ? [label.slice(0, 3), label.slice(3)] : [label.slice(0, 2), label.slice(2)];

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2">
              {/* 金瑞校 logo（彩色横版） */}
              <img src="/images/jinrui-logo-c.png" alt="上海金瑞学校" className="h-8 w-auto" />
              <span className="text-sm font-bold text-indigo-600">金瑞升学金鹰系统 · 老师端</span>
            </span>
            <nav className="flex gap-1">
              {nav.map((n) => {
                const [l1, l2] = splitLabel(n.label);
                return (
                  <Link
                    key={n.href}
                    href={n.href}
                    className={`rounded-md px-3 py-1.5 text-center text-sm leading-snug transition ${
                      pathname === n.href ? "bg-indigo-50 font-medium text-indigo-600" : "text-slate-600 hover:bg-slate-100"
                    }`}
                  >
                    <span className="block whitespace-nowrap">{l1}</span>
                    <span className="block whitespace-nowrap">{l2}</span>
                  </Link>
                );
              })}
            </nav>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-xs text-slate-300">{APP_VERSION}</span>
            <div className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">{user?.name}({user?.role === "ADMIN" ? "管理员" : "老师"})</span>
                <button
                  onClick={() => { clearAuth(); router.push("/login"); }}
                  className="rounded-md px-2 py-0.5 text-sm text-slate-500 hover:bg-slate-100"
                >
                  退出
                </button>
              </div>
              <BgmPlayer variant="inline" />
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
