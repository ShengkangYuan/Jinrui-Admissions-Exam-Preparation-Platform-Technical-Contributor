// 兼容壳:清洗规则已下沉到 src/lib/text-clean.js,让 API 运行时(一键修正)与离线脚本共用同一套标准。
// 历史脚本仍可继续 `import { toCanonical, toCanonicalText } from "./adapters/sanitize.js"`。
export { toCanonicalText, toCanonical } from "../../src/lib/text-clean.js";
