"use client";

/**
 * 全局背景音乐状态管理。
 * - 只创建一个 Audio 实例, 供所有 BgmPlayer 控件共享。
 * - 播放列表(无缝循环原创 Ambient, 纯数学合成, 无版权):
 *   ambient1 / ambient2 / ambient3 / bgm, 单曲结束自动切下一首, 末首回到第一首。
 * - 默认关闭: 浏览器自动播放策略要求首次用户手势后才能出声。
 * - 若用户此前开启过, 会在其首次点击/按键时自动续播(从当前曲目开始)。
 * - 偏好(enabled/volume)持久化到 localStorage。
 */
import { createContext, useContext, useEffect, useRef, useState, ReactNode } from "react";

const LS_KEY = "jr_bgm_pref";
export type BgmPref = { enabled: boolean; volume: number };

/** 背景音乐播放列表(全部位于 /audio/, 由 scripts/gen_ambient.py 生成, 无版权)。 */
export const BGM_PLAYLIST = [
  "/audio/ambient1.wav",
  "/audio/ambient2.wav",
  "/audio/ambient3.wav",
  "/audio/bgm.wav",
];

type BgmContextValue = {
  enabled: boolean;
  volume: number;
  ready: boolean;
  trackIndex: number;
  trackTotal: number;
  toggle: () => void;
  setVolume: (v: number) => void;
  skip: () => void;
};

const BgmContext = createContext<BgmContextValue | null>(null);

export function useBgm() {
  const ctx = useContext(BgmContext);
  if (!ctx) throw new Error("useBgm must be used inside BgmProvider");
  return ctx;
}

function loadPref(): BgmPref {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<BgmPref>;
      return {
        enabled: !!p.enabled,
        volume: typeof p.volume === "number" ? Math.min(1, Math.max(0, p.volume)) : 0.5,
      };
    }
  } catch {
    /* ignore */
  }
  return { enabled: false, volume: 0.5 };
}

function savePref(p: BgmPref) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export function BgmProvider({ children }: { children: ReactNode }) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const idxRef = useRef(0);
  const [enabled, setEnabled] = useState(false);
  const [volume, setVolumeState] = useState(0.5);
  const [ready, setReady] = useState(false);
  const [trackIndex, setTrackIndex] = useState(0);

  // 1) 从 localStorage 恢复偏好
  useEffect(() => {
    const p = loadPref();
    setEnabled(p.enabled);
    setVolumeState(p.volume);
    setReady(true);
  }, []);

  // 2) 创建 Audio 元素(播放列表, 单曲结束自动切下一首), 并注册"首次手势续播"
  useEffect(() => {
    if (!ready) return;
    const audio = new Audio(BGM_PLAYLIST[idxRef.current]);
    audio.loop = false; // 改为播放列表模式: 结束即切下一首
    audio.preload = "auto";
    audio.volume = volume;
    audioRef.current = audio;

    const advance = (autoplay: boolean) => {
      idxRef.current = (idxRef.current + 1) % BGM_PLAYLIST.length;
      audio.src = BGM_PLAYLIST[idxRef.current];
      audio.currentTime = 0;
      setTrackIndex(idxRef.current);
      if (autoplay) {
        audio.play().catch(() => {
          /* 自动播放被拦截则保持现状 */
        });
      }
    };

    const onEnded = () => advance(true);

    let gestureFired = false;
    const startOnGesture = () => {
      if (gestureFired) return;
      gestureFired = true;
      window.removeEventListener("pointerdown", startOnGesture);
      window.removeEventListener("keydown", startOnGesture);
      if (enabled) {
        audio
          .play()
          .then(() => setEnabled(true))
          .catch(() => {
            /* 保持关闭态, 等用户手动点开 */
          });
      }
    };

    audio.addEventListener("ended", onEnded);
    if (enabled) {
      window.addEventListener("pointerdown", startOnGesture);
      window.addEventListener("keydown", startOnGesture);
    }

    return () => {
      audio.removeEventListener("ended", onEnded);
      window.removeEventListener("pointerdown", startOnGesture);
      window.removeEventListener("keydown", startOnGesture);
      audio.pause();
      audioRef.current = null;
    };
    // 仅在偏好加载完成后创建一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // 3) 音量 / 开关变化时同步到 audio 并持久化
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    savePref({ enabled, volume });
  }, [volume, enabled]);

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (enabled) {
      audio.pause();
      setEnabled(false);
    } else {
      audio.volume = volume;
      audio.src = BGM_PLAYLIST[idxRef.current];
      audio.currentTime = 0;
      audio
        .play()
        .then(() => setEnabled(true))
        .catch(() => {
          /* 播放被拒(极少), 保持关闭 */
        });
    }
  };

  const skip = () => {
    const audio = audioRef.current;
    if (!audio) return;
    const wasPlaying = enabled;
    idxRef.current = (idxRef.current + 1) % BGM_PLAYLIST.length;
    audio.src = BGM_PLAYLIST[idxRef.current];
    audio.currentTime = 0;
    setTrackIndex(idxRef.current);
    if (wasPlaying) {
      audio
        .play()
        .catch(() => {
          /* ignore */
        });
    }
  };

  const setVolume = (v: number) => {
    setVolumeState(Math.min(1, Math.max(0, v)));
  };

  return (
    <BgmContext.Provider
      value={{ enabled, volume, ready, trackIndex, trackTotal: BGM_PLAYLIST.length, toggle, setVolume, skip }}
    >
      {children}
    </BgmContext.Provider>
  );
}
