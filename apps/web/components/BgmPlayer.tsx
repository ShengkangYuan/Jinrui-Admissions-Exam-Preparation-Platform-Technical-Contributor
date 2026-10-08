"use client";

/**
 * 背景音乐播放控件。
 * - floating: 右下角浮动面板(全局)。
 * - inline:   顶栏内联小控件(学生端/教师端 header 右上角)。
 * 所有实例共享 BgmProvider 里的同一 Audio 实例与状态。
 */
import { useBgm } from "./BgmProvider";

function PlayIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M8 5v14l11-7z" />
    </svg>
  );
}

function PauseIcon({ size = 18 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M6 5h4v14H6zM14 5h4v14h-4z" />
    </svg>
  );
}

function MusicIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6z" />
    </svg>
  );
}

function SkipIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M6 5l9 7-9 7V5zM17 5h2v14h-2z" />
    </svg>
  );
}

type BgmPlayerProps = { variant?: "floating" | "inline" };

export default function BgmPlayer({ variant = "floating" }: BgmPlayerProps) {
  const { enabled, volume, toggle, setVolume, skip, trackIndex, trackTotal } = useBgm();

  const button = (
    <button
      type="button"
      onClick={toggle}
      aria-label={enabled ? "关闭背景音乐" : "播放背景音乐"}
      title={enabled ? "关闭背景音乐" : "播放背景音乐"}
      className={
        variant === "inline"
          ? "flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500 text-white transition hover:bg-indigo-600"
          : "flex h-9 w-9 items-center justify-center rounded-full bg-indigo-500 text-white transition hover:bg-indigo-600"
      }
    >
      {enabled ? <PauseIcon size={variant === "inline" ? 14 : 18} /> : <PlayIcon size={variant === "inline" ? 14 : 18} />}
    </button>
  );

  const slider = (
    <input
      type="range"
      min={0}
      max={1}
      step={0.01}
      value={volume}
      onChange={(e) => setVolume(parseFloat(e.target.value))}
      aria-label="背景音乐音量"
      title="背景音乐音量"
      className={variant === "inline" ? "w-14 cursor-pointer accent-indigo-500" : "w-24 cursor-pointer accent-indigo-500"}
    />
  );

  const skipBtn = (
    <button
      type="button"
      onClick={skip}
      aria-label="切换下一首"
      title="切换下一首"
      className={
        variant === "inline"
          ? "flex h-6 w-6 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-200/70 hover:text-slate-700"
          : "flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700 dark:text-zinc-300 dark:hover:bg-zinc-700/60"
      }
    >
      <SkipIcon size={variant === "inline" ? 14 : 18} />
    </button>
  );

  const trackLabel = (
    <span
      className={
        variant === "inline"
          ? "select-none text-[10px] font-medium tabular-nums text-slate-400"
          : "select-none text-xs font-medium tabular-nums text-slate-400"
      }
    >
      {trackIndex + 1}/{trackTotal}
    </span>
  );

  if (variant === "inline") {
    return (
      <div className="flex items-center gap-1 rounded-full bg-slate-100/70 px-1.5 py-0.5 ring-1 ring-slate-200/60 backdrop-blur">
        {button}
        {enabled && skipBtn}
        {slider}
        {enabled && trackLabel}
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[100] flex items-center gap-2 rounded-full bg-white/90 px-3 py-2 shadow-lg ring-1 ring-black/5 backdrop-blur transition hover:shadow-xl dark:bg-zinc-800/90 dark:ring-white/10">
      {button}
      {enabled && skipBtn}
      <div className="flex items-center gap-1">
        <MusicIcon />
        {slider}
      </div>
      {enabled && trackLabel}
    </div>
  );
}
