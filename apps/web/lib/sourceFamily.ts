// ESAT 题源家族:勾选 / 筛选 ESAT 即同时覆盖 ENGAA 与 NSAA。
// 与后端 apps/api/src/lib/teacherPerms.js 的 ESAT_FAMILY / expandSourceType 保持一致。
// 注意:不改数据库原始 sourceType 值,仅在「筛选」与「显示徽标」两层做归组。
export const ESAT_FAMILY = ["ESAT", "ENGAA", "NSAA"];

// 该项题源是否属于 ESAT 家族(用于筛选/权限展开)
export function isEsatFamily(sourceType?: string | null): boolean {
  return !!sourceType && ESAT_FAMILY.includes(sourceType);
}

// 列表中是否应额外显示「ESAT 家族」徽标:
// 原始题源就是 ESAT 时已有 indigo 题源 chip,无需重复显示;仅 ENGAA/NSAA 需要补徽标。
export function showEsatFamilyBadge(sourceType?: string | null): boolean {
  return sourceType === "ENGAA" || sourceType === "NSAA";
}

// 客户端题源筛选是否命中:filter 为选中的题源(可能含 ESAT),value 为该项真实题源。
// - 精确相等则命中;
// - filter === "ESAT" 时,家族成员(ENGAA / NSAA)也视为命中。
export function sourceTypeMatchesEsatFilter(filter: string, value?: string | null): boolean {
  if (!value) return false;
  if (filter === value) return true;
  if (filter === "ESAT" && ESAT_FAMILY.includes(value)) return true;
  return false;
}

// 将选中的题源集合展开为等价匹配集合(用于多选筛选时 ESAT 同时覆盖 ENGAA/NSAA)
export function expandEsatFilters(filters: string[]): string[] {
  const out = new Set<string>();
  for (const f of filters) {
    if (f === "ESAT") {
      ESAT_FAMILY.forEach((t) => out.add(t));
    } else {
      out.add(f);
    }
  }
  return Array.from(out);
}
