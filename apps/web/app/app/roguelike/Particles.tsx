"use client";

import { useEffect, useRef } from "react";

export interface Burst {
  x: number;
  y: number;
  kind: "gold" | "red" | "coins" | "confetti";
}
const PALETTES: Record<Burst["kind"], string[]> = {
  gold: ["#fbbf24", "#f59e0b", "#fde68a", "#fff7ed"],
  red: ["#ef4444", "#f87171", "#b91c1c", "#fecaca"],
  coins: ["#facc15", "#eab308", "#fff7ed", "#fde047"],
  confetti: ["#6366f1", "#22d3ee", "#f472b6", "#34d399", "#fbbf24", "#a78bfa"],
};

interface Particle {
  x: number; y: number; vx: number; vy: number; life: number; decay: number; size: number; color: string; spin: number;
}

export default function Particles({ burst, onDone }: { burst: Burst | null; onDone?: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!burst) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const palette = PALETTES[burst.kind];
    // Phase C 移动端/低配:粒子数自动降级(prefers-reduced-motion 减到 1/4,窄屏按比例减)
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const w = window.innerWidth;
    let scale = 1;
    if (reducedMotion) scale = 0.25;
    if (w < 480) scale = Math.min(scale, 0.4);
    else if (w < 768) scale = Math.min(scale, 0.65);
    const baseCount = burst.kind === "confetti" ? 100 : burst.kind === "coins" ? 40 : 60;
    const count = Math.max(8, Math.round(baseCount * scale));
    const parts: Particle[] = Array.from({ length: count }, () => ({
      x: burst.x,
      y: burst.y,
      vx: (Math.random() - 0.5) * 13,
      vy: (Math.random() - 0.5) * 13 - 6,
      life: 1,
      decay: 0.006 + Math.random() * 0.012,
      size: burst.kind === "confetti" ? 4 + Math.random() * 5 : 3 + Math.random() * 4,
      color: palette[Math.floor(Math.random() * palette.length)],
      spin: Math.random() * Math.PI * 2,
    }));

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 16.7, 3);
      last = now;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      let alive = false;
      for (const p of parts) {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vy += 0.28 * dt;
        p.vx *= 0.985;
        p.life -= p.decay * dt;
        if (p.life <= 0) continue;
        alive = true;
        ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
        ctx.fillStyle = p.color;
        if (burst.kind === "confetti") {
          // 彩带:旋转矩形
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.spin);
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size / 1.5);
          ctx.restore();
        } else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      if (alive) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        onDone?.();
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [burst, onDone]);

  return <canvas ref={canvasRef} className="pointer-events-none fixed inset-0 z-50" aria-hidden />;
}
