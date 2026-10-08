// 文本规范化:清洗视觉模型/导入数据中的 LaTeX 单位写法,还原为普通文本+Unicode 上下标
// 避免 KaTeX 渲染小段单位时与正文字体混排/报错
const SUP = { "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹", "-": "⁻", "+": "⁺", ".": "˙" };
const SUB = { "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉" };
const toSup = (s) => String(s).split("").map((c) => SUP[c] || c).join("");
const toSub = (s) => String(s).split("").map((c) => SUB[c] || c).join("");

// 匹配 $...$ 内"纯单位/数字/化学式/上下标"内容(支持 \mathrm{...} 嵌套花括号)
const UNIT_RE = /\$((?:[-−\d.,\s]|\\mathrm\{(?:[^{}]|\{[^{}]*\})*\}|\\text\{(?:[^{}]|\{[^{}]*\})*\}|\\,|\\ |\^\{[^}]*\}|\^[a-zA-Z0-9]|_\{?[a-zA-Z0-9-]+\}?)+)\$/g;

export function cleanUnits(s) {
  return String(s || "")
    .replace(UNIT_RE, (_all, inner) =>
      inner
        .replace(/\^\{([^}]*)\}/g, (_a, n) => toSup(n))
        .replace(/\^([a-zA-Z0-9])/g, (_a, c) => toSup(c))
        .replace(/_\{([^}]*)\}/g, (_a, n) => toSub(n))
        .replace(/_([a-zA-Z0-9])/g, (_a, c) => toSub(c))
        .replace(/\\mathrm\{([^}]*)\}/g, "$1")
        .replace(/\\text\{([^}]*)\}/g, "$1")
        .replace(/\\,/g, " ")
        .replace(/\\ /g, " ")
        .replace(/\s+/g, " ")
        .trim()
    )
    // 裸文本单位上标:cm^3 → cm³
    .replace(/(?<![a-zA-Z0-9\\}])cm\^(\d)/gi, (_a, n) => `cm${toSup(n)}`)
    .replace(/(?<![a-zA-Z0-9\\}])dm\^(\d)/gi, (_a, n) => `dm${toSup(n)}`)
    .replace(/(?<![a-zA-Z0-9\\}])m\^(\d)/gi, (_a, n) => `m${toSup(n)}`)
    .replace(/(?<![a-zA-Z0-9\\}])s\^(\d)/gi, (_a, n) => `s${toSup(n)}`)
    // 裸文本单位负幂次:kJ mol^{-1} → kJ mol⁻¹
    .replace(/\b(mol|kg|g|cm|dm|mm|m|s|min|h|K|J|kJ|Pa|Hz|V|A)\s*\^\{(-?\d+)\}/g, (_a, u, n) => `${u}${toSup(n)}`)
    // 裸文本化学式下标:HNO_3 → HNO₃、CuNO_3 → CuNO₃、H_2O → H₂O、NO_2 → NO₂(见 #20)
    .replace(/([A-Z][a-z]?)_(\d+)/g, (_a, formula, n) => `${formula}${toSub(n)}`)
    // LaTeX 度符号:^\circ → °(如 4 J g⁻¹ ^\circ C⁻¹ → 4 J g⁻¹ °C⁻¹)
    .replace(/\^\\circ\b/gi, "°")
    .replace(/\^\{?\\circ\}?/g, "°");
}