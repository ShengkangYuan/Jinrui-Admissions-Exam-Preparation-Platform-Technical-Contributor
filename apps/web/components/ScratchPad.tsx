"use client";
// 批注书写层(完全透明叠在题目上方直接手写,不遮题、不保存、不参与判分)。
// 交互:拖动=书写;轻点=穿透点击(可正常选答案/切题)。工具栏右侧竖排、可拖动、颜色/粗细更清晰。
import { Component, useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type Tool = "browse" | "pen" | "eraser";

interface Stroke {
  tool: "pen" | "eraser";
  color: string;
  size: number;
  points: { x: number; y: number }[];
}

// 12 色
const COLORS = [
  { v: "#1a1a1a", label: "黑色" },
  { v: "#334155", label: "深灰" },
  { v: "#1f6fb2", label: "蓝色" },
  { v: "#283593", label: "藏青" },
  { v: "#00897b", label: "青色" },
  { v: "#2e7d32", label: "绿色" },
  { v: "#b8860b", label: "金黄" },
  { v: "#e65100", label: "橙色" },
  { v: "#c62828", label: "红色" },
  { v: "#6d4c41", label: "棕色" },
  { v: "#7b1fa2", label: "紫色" },
  { v: "#ec407a", label: "粉色" },
];
const DRAW_THRESHOLD = 5; // 拖动超过该距离才开始书写,否则视为轻点(穿透点击)

const TB_W = 58;
const TB_H = 640;

/* ---------- SVG 线性图标 ---------- */
function Svg({ children, title }: { children: ReactNode; title?: string }) {
  return (
    <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label={title}>
      {children}
    </svg>
  );
}
const IconBrowse = () => (
  <Svg title="浏览">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </Svg>
);
const IconPen = () => (
  <Svg title="画笔">
    <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" />
    <path d="m15 5 4 4" />
  </Svg>
);
const IconEraser = () => (
  <Svg title="橡皮">
    <path d="m7 21-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21" />
    <path d="M22 21H7" />
    <path d="m5 11 9 9" />
  </Svg>
);
const IconUndo = () => (
  <Svg title="撤销">
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5v0a5.5 5.5 0 0 1-5.5 5.5H11" />
  </Svg>
);
const IconTrash = () => (
  <Svg title="清空">
    <path d="M3 6h18" />
    <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
    <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
  </Svg>
);
const IconClose = () => (
  <Svg title="收起">
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </Svg>
);
const IconSize = ({ width }: { width: number }) => (
  <svg width={18} height={18} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" aria-label="笔尖粗细">
    <path d="M4 19 20 5" strokeWidth={Math.max(2, Math.min(width * 1.2, 8))} />
  </svg>
);

function ScratchPadInner({
  open,
  onClose,
  onInteractivityChange,
}: {
  open: boolean;
  onClose: () => void;
  onInteractivityChange?: (interactive: boolean) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const strokesRef = useRef<Stroke[]>([]);
  const [tool, setTool] = useState<Tool>("pen");
  const [color, setColor] = useState(COLORS[0].v);
  const [size, setSize] = useState(5);
  // 粗细弹窗(弹出小窗拖动条)
  const [sizeOpen, setSizeOpen] = useState(false);
  const sizeBtnRef = useRef<HTMLButtonElement>(null);
  const drawingRef = useRef(false);
  const currentRef = useRef<Stroke | null>(null);
  const lastRef = useRef<{ x: number; y: number } | null>(null);
  // 按下起点(用于轻点→穿透点击)
  const tapStartRef = useRef<{ x: number; y: number; cx: number; cy: number } | null>(null);
  // 工具栏位置(可拖动)
  const [tpos, setTpos] = useState<{ x: number; y: number } | null>(null);
  const initedRef = useRef(false);
  const dragRef = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

  const browse = tool === "browse";

  useEffect(() => {
    strokesRef.current = strokes;
  }, [strokes]);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of strokesRef.current) {
      if (!s || !Array.isArray(s.points) || s.points.length < 2) continue;
      const isEraser = s.tool === "eraser";
      // 橡皮:destination-out 真正擦除画布像素(仅擦手写笔迹,不影响底层题目)
      try {
        ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
        ctx.strokeStyle = isEraser ? "rgba(0,0,0,1)" : s.color;
        ctx.lineWidth = isEraser ? s.size * 2.5 : s.size;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.beginPath();
        ctx.moveTo(s.points[0].x, s.points[0].y);
        for (let i = 1; i < s.points.length - 1; i++) {
          const mid = { x: (s.points[i].x + s.points[i + 1].x) / 2, y: (s.points[i].y + s.points[i + 1].y) / 2 };
          ctx.quadraticCurveTo(s.points[i].x, s.points[i].y, mid.x, mid.y);
        }
        const last = s.points[s.points.length - 1];
        ctx.lineTo(last.x, last.y);
        ctx.stroke();
      } catch {
        /* 单笔失败不影响整体 */
      }
    }
    ctx.globalCompositeOperation = "source-over";
  }, []);
  const redrawRef = useRef(redraw);
  useEffect(() => {
    redrawRef.current = redraw;
  });

  // 画布尺寸自适应(DPR 高清);仅打开/窗口变化时重建
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
      canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
      canvas.style.width = `${window.innerWidth}px`;
      canvas.style.height = `${window.innerHeight}px`;
      const ctx = canvas.getContext("2d");
      if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      try {
        redrawRef.current();
      } catch {
        /* ignore */
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, [open]);

  // 浏览模式 ↔ 交互性同步
  useEffect(() => {
    onInteractivityChange?.(browse);
  }, [browse, onInteractivityChange]);

  // 打开:重置画笔 + 默认位置(右侧垂直居中);收起:清空草稿(不保存)
  useEffect(() => {
    if (open) {
      setTool("pen");
      if (!initedRef.current) {
        initedRef.current = true;
        setTpos({
          x: Math.max(8, window.innerWidth - TB_W - 16),
          y: Math.max(8, (window.innerHeight - TB_H) / 2),
        });
      }
    } else {
      setStrokes([]);
    }
  }, [open]);

  // iPad/触屏防拖动:书写期间锁定文档 overscroll,避免拉动页面/回弹
  useEffect(() => {
    if (!open) return;
    const html = document.documentElement;
    const body = document.body;
    const prevHtml = html.style.overscrollBehavior;
    const prevBody = body.style.overscrollBehavior;
    html.style.overscrollBehavior = "none";
    body.style.overscrollBehavior = "none";
    return () => {
      html.style.overscrollBehavior = prevHtml;
      body.style.overscrollBehavior = prevBody;
    };
  }, [open]);

  // iOS Safari 兜底:非被动拦截 canvas 的 touchstart/touchmove,彻底阻止页面滚动
  useEffect(() => {
    if (!open) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stop = (e: TouchEvent) => e.preventDefault();
    canvas.addEventListener("touchstart", stop, { passive: false });
    canvas.addEventListener("touchmove", stop, { passive: false });
    return () => {
      canvas.removeEventListener("touchstart", stop);
      canvas.removeEventListener("touchmove", stop);
    };
  }, [open]);

  const pos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: e.clientX, y: e.clientY };
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const drawSegment = (from: { x: number; y: number }, to: { x: number; y: number }, s: Stroke) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const isEraser = s.tool === "eraser";
    try {
      // 橡皮:destination-out 真擦除(只擦手写,不盖题目)
      ctx.globalCompositeOperation = isEraser ? "destination-out" : "source-over";
      ctx.strokeStyle = isEraser ? "rgba(0,0,0,1)" : s.color;
      ctx.lineWidth = isEraser ? s.size * 2.5 : s.size;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    } catch {
      /* ignore */
    } finally {
      ctx.globalCompositeOperation = "source-over";
    }
  };

  /* 按下:记录起点,不立即画。移动超过阈值才开始书写;否则轻点=穿透点击 */
  const onDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (browse) return;
    e.preventDefault();
    const p = pos(e);
    tapStartRef.current = { x: p.x, y: p.y, cx: e.clientX, cy: e.clientY };
    drawingRef.current = false;
    currentRef.current = null;
    lastRef.current = null;
    try {
      canvasRef.current?.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };

  const onMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (browse) return;
    const start = tapStartRef.current;
    if (!start) return;
    try {
      const p = pos(e);
      const drawTool: "pen" | "eraser" = tool === "eraser" ? "eraser" : "pen";
      if (!drawingRef.current) {
        // 未超过阈值:轻点移动,不书写
        if (Math.hypot(p.x - start.x, p.y - start.y) < DRAW_THRESHOLD) return;
        // 超过阈值:开始一笔(从起点画起)
        drawingRef.current = true;
        currentRef.current = { tool: drawTool, color, size, points: [{ x: start.x, y: start.y }] };
        lastRef.current = { x: start.x, y: start.y };
        return;
      }
      const prev = lastRef.current;
      if (prev && currentRef.current) drawSegment(prev, p, currentRef.current);
      currentRef.current = currentRef.current
        ? { ...currentRef.current, points: [...currentRef.current.points, p] }
        : { tool: drawTool, color, size, points: [p] };
      lastRef.current = p;
    } catch {
      /* ignore */
    }
  };

  /* 抬起:若画过则落笔(笔迹已实时画好,无需重绘);否则把点击转发给下层(选答案/切题仍可用) */
  const endStroke = () => {
    try {
      if (drawingRef.current && currentRef.current && currentRef.current.points.length >= 2) {
        const next = [...strokesRef.current, currentRef.current];
        strokesRef.current = next;
        setStrokes(next);
      } else if (!drawingRef.current && tapStartRef.current) {
        forwardClick(tapStartRef.current.cx, tapStartRef.current.cy);
      }
    } catch {
      /* ignore */
    }
    tapStartRef.current = null;
    drawingRef.current = false;
    currentRef.current = null;
    lastRef.current = null;
  };

  const cancelStroke = () => {
    tapStartRef.current = null;
    drawingRef.current = false;
    currentRef.current = null;
    lastRef.current = null;
  };

  /* 轻点穿透:临时隐藏画布,找到下层元素并派发 click */
  const forwardClick = (x: number, y: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      const prev = canvas.style.pointerEvents;
      canvas.style.pointerEvents = "none";
      const el = document.elementFromPoint(x, y);
      canvas.style.pointerEvents = prev;
      if (el && el !== canvas) {
        el.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y })
        );
      }
    } catch {
      /* ignore */
    }
  };

  /* 提交笔画变更(撤销/清空):同步更新 ref → 重绘 → 再通知 React */
  const commitStrokes = (next: Stroke[]) => {
    strokesRef.current = next;
    setStrokes(next);
    try {
      redrawRef.current();
    } catch {
      /* ignore */
    }
  };
  const undo = () => commitStrokes(strokesRef.current.slice(0, -1));
  const clear = () => commitStrokes([]);

  /* ---------- 工具栏拖动 ---------- */
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    setSizeOpen(false);
    dragRef.current = { sx: e.clientX, sy: e.clientY, ox: tpos?.x ?? 0, oy: tpos?.y ?? 0 };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
  };
  const onDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.sx;
    const dy = e.clientY - dragRef.current.sy;
    setTpos({
      x: Math.min(Math.max(4, dragRef.current.ox + dx), Math.max(4, window.innerWidth - TB_W)),
      y: Math.min(Math.max(4, dragRef.current.oy + dy), Math.max(4, window.innerHeight - 44)),
    });
  };
  const endDrag = () => {
    dragRef.current = null;
  };

  /* ---------- 按钮样式 ---------- */
  const toolBtn = (t: Tool, title: string, icon: ReactNode) => (
    <button
      onClick={() => setTool(t)}
      title={title}
      className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
        tool === t ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
      }`}
    >
      {icon}
    </button>
  );

  const actionBtn = (title: string, icon: ReactNode, disabled: boolean, onClick: () => void) => (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 transition-all hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30"
    >
      {icon}
    </button>
  );

  const divider = <div className="my-0.5 h-px w-7 bg-slate-200" />;

  const tbLeft = tpos ? Math.max(8, Math.min(tpos.x, window.innerWidth - TB_W - 8)) : 8;

  return open ? (
    <>
      {/* 完全透明的批注层:只捕获书写,不遮题目 */}
      <div className="pointer-events-none fixed inset-0 z-50" style={{ touchAction: "none" }}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0"
          style={{
            pointerEvents: browse ? "none" : "auto",
            touchAction: "none",
            userSelect: "none",
            WebkitUserSelect: "none",
            WebkitTouchCallout: "none",
          }}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={endStroke}
          onPointerCancel={cancelStroke}
        />
      </div>

      {/* 工具栏:固定定位、可拖动,右侧竖排 */}
      <div
        className="pointer-events-auto fixed z-50 flex flex-col items-center gap-0.5 rounded-2xl border border-slate-200/70 bg-white/90 p-1.5 shadow-[0_10px_34px_rgba(15,23,42,0.16),0_2px_8px_rgba(15,23,42,0.08)] backdrop-blur-md"
        style={{
          left: tbLeft,
          top: tpos?.y ?? 80,
          width: TB_W,
          touchAction: "none",
          userSelect: "none",
          WebkitUserSelect: "none",
        }}
      >
        {/* 拖动把手 */}
        <div
          onPointerDown={startDrag}
          onPointerMove={onDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          className="flex h-6 w-full cursor-grab touch-none items-center justify-center gap-1 active:cursor-grabbing"
          title="按住拖动工具栏"
        >
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span className="h-1 w-1 rounded-full bg-slate-300" />
          <span className="h-1 w-1 rounded-full bg-slate-300" />
        </div>

        {toolBtn("browse", "浏览:可正常答题/切题", <IconBrowse />)}
        {toolBtn("pen", "画笔(拖动书写,轻点可点题)", <IconPen />)}
        {toolBtn("eraser", "橡皮(拖动擦除,轻点可点题)", <IconEraser />)}
        {divider}

        {/* 颜色:竖条小圆点(常驻,点选即用) */}
        <div className="flex flex-col items-center gap-1 py-1">
          {COLORS.map((c) => {
            const active = color === c.v && tool === "pen";
            return (
              <button
                key={c.v}
                onClick={() => { setColor(c.v); setTool("pen"); }}
                title={c.label}
                className={`flex h-5 w-5 items-center justify-center rounded-full transition-transform ${
                  active ? "scale-110 ring-2 ring-indigo-500 ring-offset-1" : "hover:scale-105 hover:ring-1 hover:ring-slate-300"
                }`}
                style={{ background: c.v }}
              >
                {active && <span className="text-[10px] font-bold text-white drop-shadow">✓</span>}
              </button>
            );
          })}
        </div>
        {divider}

        {/* 粗细:弹出小窗拖动条 */}
        <div className="relative">
          <button
            ref={sizeBtnRef}
            onClick={() => setSizeOpen((o) => !o)}
            title="笔尖粗细"
            className={`flex h-10 w-10 items-center justify-center rounded-xl transition-all ${
              sizeOpen ? "bg-indigo-600 text-white shadow-sm" : "text-slate-500 hover:bg-slate-100 hover:text-slate-700"
            }`}
          >
            <IconSize width={size} />
          </button>

          {sizeOpen && (
            <div
              className={`absolute top-0 z-50 rounded-2xl border border-slate-200 bg-white p-2.5 shadow-[0_10px_34px_rgba(15,23,42,0.18)] ${
                (tpos?.x ?? 999) < 250 ? "left-full ml-2" : "right-full mr-2"
              }`}
            >
              <p className="flex items-center justify-between gap-3 text-xs font-medium text-slate-600">
                笔尖粗细
                <span className="rounded bg-indigo-50 px-1.5 py-0.5 font-semibold text-indigo-600">{Math.round(size * 10) / 10}px</span>
              </p>
              <input
                type="range"
                min={1}
                max={14}
                step={0.5}
                value={size}
                onChange={(e) => setSize(Number(e.target.value))}
                style={{ width: 168 }}
                className="mt-2 accent-indigo-600"
                title="拖动调整笔尖粗细"
              />
              <div className="mt-2 flex items-center justify-center rounded-lg bg-slate-50 py-2">
                <span className="block rounded-full bg-slate-800" style={{ width: 100, height: Math.max(2, size) }} />
              </div>
              <div className="mt-2 flex gap-1">
                {[
                  { l: "细", v: 2 },
                  { l: "中", v: 5 },
                  { l: "粗", v: 10 },
                ].map((p) => (
                  <button
                    key={p.l}
                    onClick={() => setSize(p.v)}
                    className={`flex-1 rounded-md py-1 text-xs transition-colors ${
                      size === p.v ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                    }`}
                  >
                    {p.l}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {divider}

        {actionBtn("撤销上一步", <IconUndo />, strokes.length === 0, undo)}
        {actionBtn("清空全部批注", <IconTrash />, strokes.length === 0, clear)}
        {divider}
        <button
          onClick={onClose}
          title="收起批注"
          className="flex h-10 w-10 items-center justify-center rounded-xl text-rose-500 transition-all hover:bg-rose-50"
        >
          <IconClose />
        </button>
      </div>

      {/* 粗细弹窗遮罩:点外部关闭(工具栏在其上层,不受影响) */}
      {sizeOpen && (
        <div className="fixed inset-0 z-40" onClick={() => setSizeOpen(false)} />
      )}

      <p className="pointer-events-none fixed bottom-4 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-slate-800/60 px-4 py-1.5 text-xs text-white/90 backdrop-blur-sm">
        拖动书写 · 轻点可正常点选答案/切题 · 工具栏可拖动
      </p>
    </>
  ) : null;
}

/* 错误边界:书写板内部异常只降级书写板,不崩整个做题页 */
class ScratchBoundary extends Component<{ children: ReactNode }, { err: boolean; k: number }> {
  state = { err: false, k: 0 };
  static getDerivedStateFromError() {
    return { err: true };
  }
  componentDidCatch(err: unknown) {
    console.error("[ScratchPad] crashed:", err);
  }
  reset = () => this.setState((s) => ({ err: false, k: s.k + 1 }));
  render() {
    if (this.state.err) {
      return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/30">
          <div className="rounded-2xl bg-white p-5 text-center shadow-2xl">
            <p className="text-sm font-medium text-slate-700">书写板遇到问题，已自动恢复</p>
            <p className="mt-1 text-xs text-slate-400">可重新打开书写板继续批注，不影响作答</p>
            <button
              onClick={this.reset}
              className="mt-3 rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500"
            >
              重新打开书写板
            </button>
          </div>
        </div>
      );
    }
    return <div key={this.state.k}>{this.props.children}</div>;
  }
}

export default function ScratchPad(props: {
  open: boolean;
  onClose: () => void;
  onInteractivityChange?: (interactive: boolean) => void;
}) {
  return (
    <ScratchBoundary>
      <ScratchPadInner {...props} />
    </ScratchBoundary>
  );
}
