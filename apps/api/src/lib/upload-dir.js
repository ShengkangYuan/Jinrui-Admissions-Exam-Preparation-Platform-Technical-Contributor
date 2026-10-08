// 上传文件目录解析(图片/音频):
//   1) 优先使用环境变量 UPLOAD_DIR(Linux 生产环境可设为 /var/www/uploads,由 Nginx 直接托管)
//   2) 未配置时使用本地默认目录 <仓库>/apps/web/public/uploads
//      —— Next.js 会把 public/ 下的文件静态映射到同名 URL(/uploads/xxx.png),
//         因此本地开发(Windows/macOS/Linux)无需 Nginx 也能正常显示上传的图片与音频。
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_DIR = path.resolve(__dirname, "../../../web/public/uploads");

export function getUploadDir() {
  const dir = process.env.UPLOAD_DIR
    ? path.resolve(process.env.UPLOAD_DIR)
    : DEFAULT_DIR;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
