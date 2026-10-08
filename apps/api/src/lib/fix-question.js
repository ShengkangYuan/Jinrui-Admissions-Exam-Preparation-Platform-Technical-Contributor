// 用 question-fixer skill(LLM 语义修正)对退回题目进行「按原因重调」。
// 单一真源: apps/api/skills/question-fixer.md(系统提示词 + 格式规范 + few-shot)。
// 流程:规则引擎先做机械清洗 → 组装 skill prompt → 调 LLM 产出修正 JSON → 再用规则引擎兜底清洗 LLM 输出 → 体检返回。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chatComplete, llmConfigured, llmInfo } from "./llm.js";
import { planAutoFix, healthCheck } from "./autofix.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SKILL_PATH = path.join(__dirname, "../../skills/question-fixer.md");

let _skillCache = null;
function loadSkill() {
  if (_skillCache == null) _skillCache = fs.readFileSync(SKILL_PATH, "utf8");
  return _skillCache;
}

// 解析 options(JSON 字符串或数组) → 字符串数组(本地实现,避免与 routes/questions.js 形成循环依赖)
function safeParseOptions(raw) {
  if (Array.isArray(raw)) return raw;
  if (typeof raw === "string") {
    try {
      const v = JSON.parse(raw);
      return Array.isArray(v) ? v : [];
    } catch {
      return [];
    }
  }
  return [];
}

// 把对象用规则引擎再洗一遍(防 LLM 输出残留 HTML / 定界符不成对等),返回干净对象
function applyRuleClean(obj) {
  const synth = { ...obj, options: JSON.stringify(obj.options) };
  const p = planAutoFix(synth);
  let opts = obj.options;
  try {
    if (p.patch.options) opts = JSON.parse(p.patch.options);
  } catch {
    /* 保留原选项 */
  }
  return {
    stem: p.patch.stem ?? obj.stem,
    options: opts,
    answer: p.patch.answer ?? obj.answer,
    solution: p.patch.solution ?? obj.solution,
    difficulty: p.patch.difficulty ?? obj.difficulty,
  };
}

// 从 LLM 原始输出里抠出第一个 JSON 对象
function parseFixJson(raw) {
  let t = String(raw || "").trim();
  const fence = t.match(/^```(?:json|markdown|md)?\s*([\s\S]*?)\s*```$/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return null;
  }
}

function buildFixPrompt(base, reviewNote) {
  const optText = Array.isArray(base.options) && base.options.length
    ? base.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")
    : "(无选项 / 填空题)";
  return [
    "【退回原因】",
    reviewNote || "(未填写具体原因,请按题目规范全面体检并修正)",
    "",
    "【当前题目】",
    `科目/知识点:${base.topic || "数学"}`,
    `题干:${base.stem}`,
    `选项:\n${optText}`,
    `答案:${base.answer || "(见题干或解析)"}`,
    `解析:${base.solution && String(base.solution).trim() ? base.solution : "(暂无)"}`,
    "",
    "【任务】根据退回原因,对题目进行修正。可以修改题干、选项、答案、解析中任何需要改动的字段,使题目正确、规范、符合格式要求。保持知识点与难度不变。只输出 JSON(见 skill 规范第 3 节)。",
  ].join("\n");
}

/**
 * 计算一道退回题的「skill 语义修正」方案(不落库)。
 * 未配置 LLM 时抛出 code=LLM_NOT_CONFIGURED 的错误。
 * @returns {{ fixed: {stem,options,answer,solution,difficulty}, changes, remaining, clean, model }}
 */
export async function planSkillFix(q) {
  if (!llmConfigured()) {
    const e = new Error(
      "服务端未配置 LLM_API_KEY,无法使用 AI 按原因重调。请在 .env 配置 LLM_API_KEY / LLM_BASE_URL / LLM_MODEL。"
    );
    e.code = "LLM_NOT_CONFIGURED";
    throw e;
  }

  // 1) 规则引擎先做机械清洗,作为 LLM 输入基线,减少 LLM 负担
  const rulePlan = planAutoFix(q);
  let baseOptions = safeParseOptions(q.options);
  try {
    if (rulePlan.patch.options) baseOptions = JSON.parse(rulePlan.patch.options);
  } catch {
    /* keep */
  }
  const base = {
    stem: rulePlan.patch.stem ?? q.stem ?? "",
    options: baseOptions,
    answer: rulePlan.patch.answer ?? q.answer ?? "",
    solution: rulePlan.patch.solution ?? q.solution ?? "",
    topic: q.topic,
    difficulty: q.difficulty,
  };

  // 2) 调 LLM(系统提示词 = skill 内容)
  const raw = await chatComplete({
    system: loadSkill(),
    user: buildFixPrompt(base, q.reviewNote),
    temperature: 0.2,
    maxTokens: 1600,
  });

  const parsed = parseFixJson(raw);
  if (!parsed) {
    const e = new Error("LLM 返回内容无法解析为题目 JSON,请重试或改为人工修正");
    e.code = "LLM_BAD_RESPONSE";
    throw e;
  }

  // 3) 合并 LLM 结果,再用规则引擎兜底清洗一次
  const merged = {
    stem: parsed.stem ?? base.stem,
    options: Array.isArray(parsed.options) ? parsed.options.map(String) : base.options,
    answer: parsed.answer ?? base.answer,
    solution: parsed.solution ?? base.solution,
    difficulty: base.difficulty,
  };
  const cleaned = applyRuleClean(merged);

  // 4) 体检,如实报告仍未解决的问题(options 为数组,healthCheck 内部按数组处理)
  const remaining = healthCheck(cleaned);
  return {
    fixed: cleaned,
    changes: Array.isArray(parsed.changes) ? parsed.changes : [],
    remaining,
    clean: remaining.length === 0,
    model: llmInfo().model,
  };
}
