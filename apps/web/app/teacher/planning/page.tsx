"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getUser } from "@/lib/api";

// 教师端「升学规划」：同源 iframe 嵌入 public/planning.html
// 传 role=teacher：HTML 显示全部 5 个板块(含「档案填写」)，并提供学生下拉选择器，
// 教师选定学生后可读写其档案。学生档案读取/写入均走 /api/planning(隔离命名空间)。
export default function TeacherPlanningPage() {
  const router = useRouter();
  const [src, setSrc] = useState("/planning.html?role=teacher");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const u = getUser();
    if (!u || u.role === "STUDENT") {
      router.replace("/login");
      return;
    }
    setReady(true);
  }, [router]);

  if (!ready) return null;

  return (
    <div className="-mx-4 -my-6">
      <iframe
        src={src}
        title="升学规划(教师端)"
        style={{ width: "100%", height: "calc(100vh - 88px)", border: "0", minHeight: "600px" }}
      />
    </div>
  );
}
