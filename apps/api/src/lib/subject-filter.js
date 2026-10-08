// 把前端「科目」下拉里的 TMUA/ESAT(题源)映射为正确的 Prisma where。
// 规范数据:subject=四科(数学/物理/化学/生物),sourceType=TMUA/ESAT;
// 历史遗留:subject=TMUA/ESAT/Mathematics 等且 sourceType 可能为空,需兼容。
export function buildSubjectFilter(subject) {
  const s = String(subject || "").trim();
  if (!s) return {};
  if (s === "TMUA") {
    return {
      OR: [
        { subject: "TMUA", sourceType: null },
        { subject: "TMUA", sourceType: "TMUA" },
        { subject: "数学", sourceType: "TMUA" },
        { subject: "Mathematics", sourceType: "TMUA" },
      ],
    };
  }
  if (s === "ESAT") {
    return {
      OR: [
        { subject: "ESAT", sourceType: null },
        { subject: "ESAT", sourceType: "ESAT" },
        { subject: "数学", sourceType: "ESAT" },
        { subject: "物理", sourceType: "ESAT" },
      ],
    };
  }
  return { subject: s };
}
