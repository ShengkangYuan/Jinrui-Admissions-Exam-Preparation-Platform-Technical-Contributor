// 题源(考试类型)公共配置:预设列表 + 从题库动态拉取已存在的题源
import { api } from "./api";

// 常见题源预设(库里可能还没有,但编辑时作为快捷选项)
export const DEFAULT_SOURCE_TYPES = [
  "TMUA",
  "ESAT",
  "NSAA",
  "MAT",
  "BMAT",
  "STEP",
  "PAT",
  "ENGAA",
  "SMC",
];

// 从后端拉取题库中已有的题源,合并预设,去重排序
export async function fetchSourceTypes(): Promise<string[]> {
  let fromServer: string[] = [];
  try {
    const d = await api.get<{ list?: string[] }>("/questions/source-types");
    if (d && Array.isArray(d.list)) fromServer = d.list.map(String);
  } catch {
    fromServer = [];
  }
  const set = new Set<string>([...DEFAULT_SOURCE_TYPES, ...fromServer]);
  return Array.from(set)
    .filter((s) => s.trim().length > 0)
    .sort((a, b) => a.localeCompare(b));
}
