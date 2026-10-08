import express from "express";
import fs from "fs";
import path from "path";
import crypto from "crypto";
import { ok, fail } from "../lib/res.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { getUploadDir } from "../lib/upload-dir.js";

const ALLOWED_EXT = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

// 解析 data URL(支持 "data:image/png;base64,...." 或裸 base64)
function parseDataUrl(input) {
  const m = /^data:([^;]+);base64,(.+)$/s.exec(input || "");
  if (m) return { mime: m[1], b64: m[2] };
  return { mime: null, b64: input || "" };
}

const router = express.Router();

// 仅教师/管理员可上传图表;图片存入 web/public/uploads,由 Next.js 静态服务
router.post("/", requireAuth, requireRole("TEACHER", "ADMIN"), async (req, res) => {
  try {
    const { filename, data } = req.body || {};
    if (!data || typeof data !== "string") return fail(res, 400, "缺少图片数据");

    const { mime, b64 } = parseDataUrl(data);
    let ext = ALLOWED_EXT[mime];
    if (!ext) {
      const fe = String(filename || "").toLowerCase().match(/\.([a-z0-9]+)$/);
      if (!fe || !Object.values(ALLOWED_EXT).includes(fe[1])) {
        return fail(res, 400, "不支持的图片格式(仅 png / jpg / webp / gif)");
      }
      ext = fe[1];
    }

    let buf;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      return fail(res, 400, "图片解码失败");
    }
    if (!buf.length) return fail(res, 400, "图片内容为空");
    if (buf.length > MAX_BYTES) return fail(res, 400, "图片过大,上限 5MB");

    // 随机文件名杜绝路径遍历/覆盖
    const name = crypto.randomBytes(12).toString("hex") + "." + ext;
    fs.writeFileSync(path.join(getUploadDir(), name), buf);

    ok(res, { url: "/uploads/" + name, filename: name });
  } catch (e) {
    console.error("[uploads] error", e);
    fail(res, 500, "上传失败");
  }
});

export default router;
