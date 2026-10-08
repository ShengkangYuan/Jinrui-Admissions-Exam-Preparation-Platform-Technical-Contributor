"use client";
// 考试管理已并入「教学管理」模块(子模块:学情统计 / 作业分发 / 考试管理)。
// 此页保留为薄包装,便于直接访问 /teacher/exams 时仍可用。
import ExamsPanel from "@/components/ExamsPanel";

export default function TeacherExamsPage() {
  return <ExamsPanel />;
}
