import { prisma } from "./db.js";

// 把 groupIds(当前老师拥有的分组)展开为组内学生 id,并与传入的 studentIds 合并去重。
// 返回最终要分发的逐学生 id 数组(已去重)。
// 仅统计属于该 teacherId 的分组,防止越权把别人的组学生纳入。
export async function resolveTargetStudents({ studentIds = [], groupIds = [], teacherId }) {
  const ids = new Set((Array.isArray(studentIds) ? studentIds : []).map(String).filter(Boolean));
  const groups = Array.isArray(groupIds) ? groupIds.map(String).filter(Boolean) : [];
  if (groups.length) {
    const found = await prisma.group.findMany({
      where: { id: { in: groups }, teacherId },
      select: { students: { select: { studentId: true } } },
    });
    for (const g of found) {
      for (const s of g.students) ids.add(s.studentId);
    }
  }
  return [...ids];
}
