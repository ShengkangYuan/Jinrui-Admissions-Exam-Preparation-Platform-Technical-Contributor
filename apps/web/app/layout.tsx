import type { Metadata } from "next";
import "./globals.css";
import "katex/dist/katex.min.css";
import { BgmProvider } from "@/components/BgmProvider";

export const metadata: Metadata = {
  title: "金瑞升学金鹰系统",
  description: "金瑞升学 · TMUA / ESAT 在线刷题、模拟考与学情分析平台",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <BgmProvider>{children}</BgmProvider>
      </body>
    </html>
  );
}
