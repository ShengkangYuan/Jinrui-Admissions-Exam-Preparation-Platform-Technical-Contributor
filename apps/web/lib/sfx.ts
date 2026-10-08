// Web Audio 合成音效(零素材):冒险模式反馈音
// 注意:浏览器要求用户先交互后才能播放,首次点击任意按钮会初始化 AudioContext
let ctx: AudioContext | null = null;
let muted = false;

/** 全局静音开关(Phase C:冒险模式"音效"设置) */
export function setSfxMuted(m: boolean) {
  muted = m;
}

function ensureCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!ctx) ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    if (ctx.state === "suspended") void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(freq: number, dur: number, type: OscillatorType = "sine", vol = 0.2, when = 0) {
  const c = ensureCtx();
  if (!c) return;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = c.currentTime + when;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.linearRampToValueAtTime(vol, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(c.destination);
  o.start(t);
  o.stop(t + dur + 0.05);
}

export type SfxKind = "correct" | "wrong" | "combo" | "reward" | "boss" | "boss_appear" | "shield" | "death" | "click" | "pick" | "victory";

export function playSfx(kind: SfxKind, combo = 0) {
  if (muted) return;
  try {
    switch (kind) {
      case "correct":
        tone(660, 0.14, "sine", 0.22);
        tone(880, 0.2, "sine", 0.18, 0.07);
        break;
      case "combo": {
        const f = 620 + Math.min(combo, 20) * 70;
        tone(f, 0.12, "triangle", 0.22);
        tone(f * 1.5, 0.16, "triangle", 0.16, 0.06);
        break;
      }
      case "wrong":
        tone(220, 0.28, "sawtooth", 0.12);
        tone(170, 0.34, "sawtooth", 0.1, 0.09);
        break;
      case "shield":
        tone(520, 0.12, "square", 0.1);
        tone(760, 0.16, "triangle", 0.12, 0.05);
        break;
      case "reward":
        [880, 1100, 1320].forEach((f, i) => tone(f, 0.1, "sine", 0.18, i * 0.07));
        break;
      case "boss":
        tone(150, 0.4, "sawtooth", 0.22);
        tone(95, 0.5, "square", 0.16, 0.1);
        tone(190, 0.3, "triangle", 0.14, 0.2);
        break;
      case "boss_appear":
        tone(110, 0.5, "sawtooth", 0.2);
        tone(75, 0.6, "square", 0.18, 0.08);
        tone(140, 0.4, "triangle", 0.14, 0.18);
        tone(200, 0.3, "sine", 0.1, 0.3);
        break;
      case "death":
        [320, 260, 210, 160].forEach((f, i) => tone(f, 0.24, "sawtooth", 0.12, i * 0.12));
        break;
      case "victory":
        [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.18, "triangle", 0.2, i * 0.1));
        tone(1568, 0.3, "sine", 0.16, 0.45);
        break;
      case "click":
        tone(420, 0.05, "triangle", 0.06);
        break;
      case "pick":
        tone(520, 0.08, "triangle", 0.08);
        break;
    }
  } catch {
    // 忽略音频错误(静音环境/无权限)
  }
}
