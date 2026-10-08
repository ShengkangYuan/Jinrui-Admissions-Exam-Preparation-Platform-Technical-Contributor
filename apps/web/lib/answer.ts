// 把存储的 answer(单字母 A-H / 多选 "A, C" / 完整文本)翻译成完整选项内容用于显示与高亮
// 数据存字母是判分引擎的要求(grading.js: a === s),不要把字母替换进数据库
// 字母→索引(0-7)对应 A-H;a/b 视为同一字母
function letterToIndex(s: string): number {
  const t = String(s ?? "").trim().toUpperCase();
  if (!/^[A-H]$/.test(t)) return -1;
  return t.charCodeAt(0) - 65;
}

export function letterToOption(
  answer: string | null | undefined,
  options: string[] | null | undefined,
): string | null {
  const a = String(answer ?? "").trim();
  if (!a || !Array.isArray(options) || !options.length) return null;
  // 只有「纯字母答案」(单字母 A-H / 多选 "A, C" / "A C" / "A、C")才走字母索引解析;否则视为完整文本
  if (/^[A-Ha-h](?:[\s,，、]+[A-Ha-h])*$/.test(a)) {
    const parts = a.split(/[,，、\s]+/).map((s) => s.trim()).filter(Boolean);
    const texts: string[] = [];
    for (const p of parts) {
      const idx = letterToIndex(p);
      if (idx >= 0 && idx < options.length) texts.push(options[idx]);
    }
    if (texts.length) return texts.length > 1 ? texts.join(" / ") : texts[0];
    return null;
  }
  // 完整文本答案(老数据 / OCR 偶发直接识别成内容)——确认在 options 里再返回
  if (options.includes(a)) return a;
  return null;
}

// 判断某个选项是否就是答案(支持字母存数据 + 完整内容存数据两种情况)
export function isAnswerOption(
  opt: string,
  answer: string | null | undefined,
  options?: string[] | null,
): boolean {
  const a = String(answer ?? "").trim();
  if (!a) return false;
  if (a === opt) return true;
  return letterToOption(a, options) === opt;
}
