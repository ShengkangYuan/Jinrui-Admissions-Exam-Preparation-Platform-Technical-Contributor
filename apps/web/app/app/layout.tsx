"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { clearAuth, getUser } from "@/lib/api";
import { APP_VERSION } from "@/lib/version";
import BgmPlayer from "@/components/BgmPlayer";

export default function StudentLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<ReturnType<typeof getUser>>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u || u.role !== "STUDENT") {
      router.replace("/login");
    } else {
      setUser(u);
      setReady(true);
    }
  }, [router]);

  if (!ready) return null;

  const nav = [
    { href: "/app/space", label: "个人空间" },
    { href: "/app", label: "笔试练习" },
    { href: "/app/language", label: "语言学习" },
    { href: "/app/roguelike", label: "冒险模式" },
    { href: "/app/interview", label: "面试练习" },
    { href: "/app/planning", label: "升学规划" },
  ];

  function logout() {
    clearAuth();
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-6">
            <span className="flex items-center gap-2">
              {/* 金瑞校 logo（彩色横版） */}
              <img src="/images/jinrui-logo-c.png" alt="上海金瑞学校" className="h-8 w-auto" />
              <span className="text-sm font-bold text-indigo-600">金瑞升学金鹰系统</span>
            </span>
            <nav className="flex gap-1">
              {nav.map((n) => (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`rounded-md px-3 py-1.5 text-sm transition ${
                    pathname === n.href ? "bg-indigo-50 font-medium text-indigo-600" : "text-slate-600 hover:bg-slate-100"
                  }`}
                >
                  {n.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-baseline gap-3">
            <span className="text-xs text-slate-300">{APP_VERSION}</span>
            <div className="flex flex-col items-start gap-1">
              <div className="flex items-center gap-2">
                <span className="text-sm text-slate-500">{user?.name}</span>
                <button onClick={logout} className="rounded-md px-2 py-0.5 text-sm text-slate-500 hover:bg-slate-100">
                  退出
                </button>
              </div>
              <BgmPlayer variant="inline" />
            </div>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6">{children}</main>
    </div>
  );
}
