/** @type {import('next').NextConfig} */
// 前端把 /api/* 代理到后端。本地开发默认 http://localhost:4000;
// 如需指向其他地址(局域网/远程后端),启动前设置环境变量 API_PROXY_TARGET 即可,无需改代码。
const apiTarget = process.env.API_PROXY_TARGET || "http://localhost:4000";

const nextConfig = {
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${apiTarget.replace(/\/$/, "")}/api/:path*` }];
  },
};

export default nextConfig;
