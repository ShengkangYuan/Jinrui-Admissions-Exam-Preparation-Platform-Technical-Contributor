// 教师可见范围权限工具
// 仅对 role=TEACHER 的账号生效:permSubjects / permSourceTypes 为白名单(JSON 数组)。
// 空 / null = 全部可见(不受限);ADMIN 与 STUDENT 一律不受限。
// 作用于「试卷管理 / 组卷」与「题库管理」两个列表查询的 where 条件。

// 将数据库中的 JSON 字符串解析为字符串数组;非法 / 空 → null
export function parseJsonArr(str) {
  if (!str) return null;
  try {
    const v = JSON.parse(str);
    if (Array.isArray(v)) return v.filter((x) => typeof x === "string");
    return null;
  } catch {
    return null;
  }
}

// 将已有的 subject/sourceType 过滤条件与白名单取交集
//   - 未设置 → { in: whitelist }
//   - 标量字符串 → 命中白名单则保留,否则 { in: [] }(匹配空集)
//   - { in: [...] } → 过滤出白名单内的元素;交集为空 → { in: [] }
//   - 其它形状(如 { not }) → 直接以白名单覆盖
function intersect(existing, whitelist) {
  if (!existing) return { in: whitelist };
  if (typeof existing === "string") {
    return whitelist.includes(existing) ? existing : { in: [] };
  }
  if (existing && Array.isArray(existing.in)) {
    const inter = existing.in.filter((x) => whitelist.includes(x));
    return { in: inter };
  }
  return { in: whitelist };
}

// ESAT 题源家族:勾选 ESAT 即同时覆盖 ENGAA / NSAA
// (「把 ENGAA/NSAA 的卷子和题目也打上 ESAT 标签」——不改数据库原始 sourceType 值)
export const ESAT_FAMILY = ["ESAT", "ENGAA", "NSAA"];

// 将单个题源值展开为等价匹配集合。
// 仅 ESAT 作为「伞型」标签展开为其家族(ESAT+ENGAA+NSAA),
// 使「筛选 ESAT / 授予 ESAT 权限」同时覆盖 ENGAA 与 NSAA;
// ENGAA / NSAA 各自保持独立(仅命中自身)。空 / 非法输入返回 []。
export function expandSourceType(t) {
  const v = String(t || "").trim();
  if (!v) return [];
  if (v === "ESAT") return [...ESAT_FAMILY];
  return [v];
}

// 就地修改 where,注入教师可见范围限制;非 TEACHER 直接原样返回
export function applyTeacherPerms(where, user) {
  if (!user || user.role !== "TEACHER") return where;
  const subs = parseJsonArr(user.permSubjects);
  const sts = parseJsonArr(user.permSourceTypes);
  if (subs && subs.length) {
    where.subject = intersect(where.subject, subs);
  }
  if (sts && sts.length) {
    // 教师若拥有 ESAT 权限,则其可见范围同时包含 ENGAA / NSAA
    const expanded = [...new Set(sts.flatMap(expandSourceType))];
    where.sourceType = intersect(where.sourceType, expanded);
  }
  return where;
}
