"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser } from "@/lib/api";

// 学生端「升学规划」：同源 iframe 嵌入 public/planning.html
// 传 role=student + 本人 studentId/name：HTML 会自动隐藏「档案填写」tab，仅展示
// 规划看板 / 考试规划 / 规划方案 / 准备充分度 四个板块，并按 studentId 自动加载本人档案。
export default function StudentPlanningPage() {
  const router = useRouter();
  const [src, setSrc] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u || u.role !== "STUDENT") {
      router.replace("/login");
      return;
    }
    const query = new URLSearchParams({
      role: "student",
      studentId: u.id,
      name: u.name,
    }).toString();
    setSrc(`/planning.html?${query}`);
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <div className="-mx-4 -my-6">
      <iframe
        src={src}
        title="升学规划"
        style={{ width: "100%", height: "calc(100vh - 88px)", border: "0", minHeight: "600px" }}
      />
    </div>
  );
}
