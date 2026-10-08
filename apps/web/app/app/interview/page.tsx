"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, getUser } from "@/lib/api";

/* =========================================================================
   类型与数据
   ========================================================================= */
interface InterviewQuestion {
  id: string;
  subject: string;
  tagClass: string | null;
  heading: string;
  stem: string;
  focus: string;
  steps: string[];
  sortOrder: number;
}

const CONFIG = {
  title: "Cambridge Mathematics Interview · Practice Set A",
  subtitle: "Number Theory & Combinatorics · STEP style",
  subnote:
    "For students preparing for Cambridge Mathematics / Maths & CS / Natural Sciences (Maths) interviews",
  meta: "Suggested time: 8–12 minutes per question (the live interview is guided, not a closed-book test)",
  intro:
    "<b>About the format.</b> These questions imitate the conventions of the STEP (Sixth Term Examination Paper): " +
    "proof-centred, progressive from easy to hard, with each part building on the last. They also follow the " +
    "emphasis of a Cambridge maths interview — the interviewer cares more about <b>clarity of thought, a firm grasp of " +
    "definitions, and whether you can be nudged forward when stuck</b>, rather than producing a polished final answer on the spot. " +
    "Each question is followed by \"What the interviewer looks for\" and a collapsible <b>\"Detailed solution\"</b> — try each one with pen and paper first, then read the solution slowly.",
  footer:
    "Style inspired by the STEP (Sixth Term Examination Paper) and published Cambridge mathematics admissions interview questions. " +
    "These are fully worked solutions; a real interview still emphasises spoken reasoning and interaction over a written script.",
};

/* =========================================================================
   面试风格 CSS(与 cambridge_maths_interview_set_A.html 完全一致)+ 分页导航
   ========================================================================= */
const PAGE_CSS = `
.iw-scope{background:#e9e4d8; min-height:100%; padding:24px 0;}
.iw-wrap{max-width:880px; margin:0 auto; background:#fbf8f1; color:#1a1a1a;
  box-shadow:0 8px 30px rgba(0,0,0,.18); border-radius:4px; overflow:hidden;
  font-family:"Iowan Old Style","Palatino Linotype",Georgia,"Noto Serif",serif; line-height:1.75;}
.iw-wrap *{box-sizing:border-box;}
.iw-header{background:linear-gradient(135deg,#00467F,#1f6fb2); color:#fff; padding:34px 44px;}
.iw-header h1{margin:0 0 6px; font-size:26px; letter-spacing:.5px; font-weight:bold;}
.iw-header p{margin:2px 0; opacity:.92; font-size:14px;}
.iw-header .meta{margin-top:14px; font-size:13px; opacity:.85;}
.iw-main{padding:30px 44px 46px;}
.iw-intro{background:#f1ead9; border-left:4px solid #b8860b; padding:14px 18px; border-radius:3px;
  font-size:14.5px; margin-bottom:22px;}
.iw-footer{padding:18px 44px 30px; font-size:12.5px; color:#6b6357; border-top:1px solid #d9d2c2;}

/* ---- 单题分页导航 ---- */
.iw-nav{display:flex; align-items:center; gap:16px; flex-wrap:wrap; margin-bottom:22px;
  background:#fffdf7; border:1px solid #d9d2c2; border-radius:4px; padding:12px 16px;}
.iw-nav .grid{display:flex; gap:6px; flex-wrap:wrap; align-items:center;}
.iw-nav .num{cursor:pointer; width:32px; height:32px; border-radius:50%; border:1px solid #d9d2c2;
  background:#fff; color:#00467F; font-family:inherit; font-size:13.5px; font-weight:bold;
  display:flex; align-items:center; justify-content:center; transition:all .15s;}
.iw-nav .num:hover{background:#00467F; color:#fff;}
.iw-nav .num.current{border:2px solid #b8860b; background:#00467F; color:#fff;}
.iw-nav .num.done{background:#1f6fb2; color:#fff; border-color:#1f6fb2;}
.iw-nav .counter{margin-left:auto; font-size:13px; color:#5a5346; font-variant-numeric:tabular-nums; white-space:nowrap;}

/* ---- 题目卡片(与原 HTML 完全一致) ---- */
.iw-q{margin:24px 0; padding-bottom:8px;}
.iw-q h2{font-size:18px; color:#00467F; margin:0 0 4px;}
.iw-tag{display:inline-block; font-size:12px; padding:2px 10px; border-radius:20px; background:#00467F;
  color:#fff; margin-right:8px; vertical-align:middle;}
.iw-tag.nt{background:#00467F;} .iw-tag.comb{background:#7a3b8f;}
.iw-stem{margin:12px 0; font-size:15.5px;}
.iw-stem .part{margin:10px 0;}
.iw-stem .part b{color:#333;}
.iw-stem .eq{font-style:italic;}
.iw-stem sup,.iw-sol sup{font-size:.72em;}
.iw-stem sub,.iw-sol sub{font-size:.72em;}
.iw-stem code{background:#efe9da; padding:1px 5px; border-radius:3px; font-size:.92em;}
.iw-focus{font-size:13.8px; color:#5a5346; background:#f4efe2; border:1px dashed #d9d2c2;
  padding:10px 14px; border-radius:3px; margin-top:10px;}
.iw-focus b{color:#b8860b;}
.iw-focus code{background:#efe9da; padding:1px 5px; border-radius:3px; font-size:.92em;}
.iw-sol details{margin-top:10px; background:#f6f2e8; border:1px solid #d9d2c2; border-radius:3px;}
.iw-sol details summary{cursor:pointer; padding:9px 14px; font-weight:bold; color:#00467F; font-size:14px;}
.iw-sol .sol{padding:8px 18px 18px; font-size:15px;}
.iw-sol .sol .eq{font-style:italic;}
.iw-sol .sol .step{margin:12px 0; padding-left:12px; border-left:3px solid #c9b98f;}
.iw-sol .sol .step b{color:#00467F;}
.iw-sol .sol .key{background:#efe7d2; border-radius:3px; padding:2px 6px; font-weight:bold; color:#7a3b8f;}
.iw-sol .sol b{color:#7a3b8f;}

/* ---- 录音器 ---- */
.iw-rec{margin-top:14px; background:#fffdf7; border:1px solid #d9d2c2; border-radius:4px; padding:10px 14px; font-size:14px;}
.iw-rec .rec-title{font-weight:bold; color:#00467F; font-size:13px; letter-spacing:.3px; margin-bottom:8px;}
.iw-rec .rec-controls{display:flex; align-items:center; gap:10px; flex-wrap:wrap;}
.iw-rec button{cursor:pointer; font-family:inherit; font-size:13px; border:1px solid #00467F; background:#fff;
  color:#00467F; padding:5px 16px; border-radius:20px; transition:background .15s,color .15s;}
.iw-rec button:hover{background:#00467F; color:#fff;}
.iw-rec button:disabled{opacity:.45; cursor:not-allowed;}
.iw-rec button.rec-on{background:#c62828; border-color:#c62828; color:#fff;}
.iw-rec .rec-timer{font-variant-numeric:tabular-nums; color:#5a5346; font-size:13.5px;}
.iw-rec .rec-status{margin-top:8px; font-size:13px; color:#6b6357; min-height:18px;}
.iw-rec .rec-status.live{color:#c62828;}
.iw-rec .rec-status.err{color:#c62828;}
.iw-rec .rec-status.ok{color:#2a7d5a;}
.iw-rec .rec-dot{display:inline-block; width:9px; height:9px; border-radius:50%; background:#c62828;
  margin-right:6px; animation:recblink 1s infinite;}
@keyframes recblink{50%{opacity:.15;}}
.iw-rec .rec-note{font-size:11.5px; color:#8a8272; margin:6px 0 0;}
.iw-rec .rec-saved{margin-top:10px;}
.iw-rec .rec-saved .chip{display:flex; align-items:center; gap:8px; flex-wrap:wrap; border:1px solid #d9d2c2;
  background:#f7f2e4; padding:6px 10px; border-radius:3px; margin-bottom:6px;}
.iw-rec .rec-saved .chip .meta{color:#6b6357; font-size:12px; flex:1 1 auto; min-width:130px;}
.iw-rec .rec-saved .chip audio{height:32px; max-width:220px;}

/* ---- 分页按钮 ---- */
.iw-pager{display:flex; align-items:center; justify-content:space-between; margin-top:24px;}
.iw-pager button{cursor:pointer; font-family:inherit; font-size:14px; font-weight:600;
  border:1px solid #00467F; background:#fff; color:#00467F; padding:8px 24px; border-radius:24px; transition:all .15s;}
.iw-pager button:hover:not(:disabled){background:#00467F; color:#fff;}
.iw-pager button:disabled{opacity:.35; cursor:not-allowed;}
.iw-pager .pager-count{font-size:13px; color:#5a5346;}

/* ---- 便携导出 ---- */
.iw-export{max-width:880px; margin:22px auto 0; padding:16px 20px; border:2px dashed #00467F;
  border-radius:6px; background:#fbf7ec; text-align:center;}
.iw-export p{font-size:13px; color:#6b6357; margin:0 0 12px; line-height:1.5; font-family:"Iowan Old Style","Palatino Linotype",Georgia,serif;}
.iw-export button{cursor:pointer; font-family:inherit; font-size:14px; font-weight:600;
  border:1px solid #00467F; background:#00467F; color:#fff; padding:9px 22px; border-radius:24px; transition:opacity .15s;}
.iw-export button:hover{opacity:.88;}
.iw-export button:disabled{opacity:.5; cursor:wait;}
.iw-export span{display:block; margin-top:10px; font-size:12.5px; color:#2a7d5a; min-height:16px;}
.iw-loading{text-align:center; padding:80px 20px; color:#5a5346; font-family:Georgia,serif; font-size:16px;}
.iw-error{text-align:center; padding:60px 20px; color:#c62828; font-family:Georgia,serif;}
`;

/* =========================================================================
   IndexedDB 录音存储(与源 HTML 相同的本地存储方案,永不外传)
   ========================================================================= */
interface Rec {
  id: string;
  qid: string;
  ts: number;
  dur: number;
  size: number;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;
function openDB(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((res, rej) => {
    const rq = indexedDB.open("oxbridge-interview-recordings", 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      if (!d.objectStoreNames.contains("recs")) d.createObjectStore("recs", { keyPath: "id" });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbPromise;
}
async function dbPut(rec: Rec) {
  const db = await openDB();
  return new Promise<void>((res, rej) => {
    const tx = db.transaction("recs", "readwrite");
    tx.objectStore("recs").put(rec);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function dbDel(id: string) {
  const db = await openDB();
  return new Promise<void>((res, rej) => {
    const tx = db.transaction("recs", "readwrite");
    tx.objectStore("recs").delete(id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
async function dbAll(): Promise<Rec[]> {
  const db = await openDB();
  return new Promise((res, rej) => {
    const rq = db.transaction("recs").objectStore("recs").getAll();
    rq.onsuccess = () => res((rq.result as Rec[]) || []);
    rq.onerror = () => rej(rq.error);
  });
}

function fmt(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return (m < 10 ? "0" : "") + m + ":" + (s % 60 < 10 ? "0" : "") + (s % 60);
}
function stamp(t: number) {
  return new Date(t).toLocaleDateString() + " " + new Date(t).toLocaleTimeString();
}

/* =========================================================================
   录音器组件(每道题一个)
   ========================================================================= */
function RecorderBox({ qid, onChanged }: { qid: string; onChanged: () => void }) {
  const [list, setList] = useState<Rec[]>([]);
  const [recording, setRecording] = useState(false);
  const [msg, setMsg] = useState<{ text: string; cls: string }>({ text: "", cls: "" });
  const timerRef = useRef<number | null>(null);
  const recRef = useRef<{ recorder: MediaRecorder; stream: MediaStream; start: number; timerEl: HTMLSpanElement | null } | null>(null);
  const [timer, setTimer] = useState(0);
  const stopCurrentRef = useRef<(() => void) | null>(null);

  // 首次加载时从 IndexedDB 恢复该题录音
  const refresh = useCallback(() => {
    dbAll()
      .then((all) => {
        const mine = all.filter((r) => r.qid === qid).sort((a, b) => a.ts - b.ts);
        setList(mine);
      })
      .catch(() => {});
  }, [qid]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const hasMic = typeof navigator !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
  let MIME = "audio/webm;codecs=opus";
  if (typeof MediaRecorder !== "undefined") {
    if (!MediaRecorder.isTypeSupported(MIME)) {
      MIME = MediaRecorder.isTypeSupported("audio/mp4") ? "audio/mp4" : "";
    }
  }

  function stopActive() {
    const c = recRef.current;
    if (!c) return;
    recRef.current = null;
    if (timerRef.current) window.clearInterval(timerRef.current);
    timerRef.current = null;
    setRecording(false);
    setTimer(0);
    try {
      c.recorder.stop();
    } catch {}
    c.stream.getTracks().forEach((t) => t.stop());
  }

  function toggle() {
    if (recording) {
      stopActive();
      return;
    }
    if (!hasMic || typeof MediaRecorder === "undefined") {
      setMsg({ text: "Recording is not available here — the browser needs microphone permission (a secure context).", cls: "err" });
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const recorder = new MediaRecorder(stream, MIME ? { mimeType: MIME } : undefined);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size) chunks.push(e.data);
        };
        const start = Date.now();
        recRef.current = { recorder, stream, start, timerEl: null };
        setRecording(true);
        setMsg({ text: "Recording… speak your answer, then press Stop.", cls: "live" });
        timerRef.current = window.setInterval(() => {
          setTimer(Date.now() - start);
        }, 250);
        recorder.onstop = () => {
          const blob = new Blob(chunks, { type: MIME || "audio/webm" });
          const rec: Rec = {
            id: qid + "-" + Date.now(),
            qid,
            ts: Date.now(),
            dur: Date.now() - start,
            size: blob.size,
            blob,
          };
          dbPut(rec).then(() => {
            setMsg({ text: "Saved. Play it back below, download it, or delete it.", cls: "ok" });
            refresh();
            onChanged();
          });
        };
        recorder.start();
      })
      .catch((err: DOMException) => {
        setMsg({
          text:
            "Microphone unavailable (" +
            err.name +
            (err.name === "NotAllowedError" ? " — please allow microphone access" : "") +
            ").",
          cls: "err",
        });
      });
  }

  return (
    <div className="iw-rec" data-qid={qid}>
      <div className="rec-title">Voice Answer Practice — record yourself answering this question</div>
      <div className="rec-controls">
        <button type="button" className={recording ? "rec-on" : ""} onClick={toggle}>
          {recording ? "Stop Recording" : "Start Recording"}
        </button>
        <span className="rec-timer">{fmt(timer)}</span>
      </div>
      <div className={`rec-status ${msg.cls}`}>
        {msg.cls === "live" && <span className="rec-dot" />}
        {msg.text}
      </div>
      <div className="rec-saved">
        {list.map((r) => (
          <div className="chip" key={r.id}>
            <span className="meta">
              Saved {stamp(r.ts)} · {fmt(r.dur)} · {Math.max(1, Math.round(r.size / 1024))} KB
            </span>
            <audio controls preload="none" src={URL.createObjectURL(r.blob)} />
            <button
              type="button"
              onClick={() => {
                const a = document.createElement("a");
                a.href = URL.createObjectURL(r.blob);
                a.download = qid + "-answer-" + r.ts + ".webm";
                a.click();
              }}
            >
              Save file
            </button>
            <button
              type="button"
              onClick={() => {
                if (!window.confirm("Delete this recording?")) return;
                dbDel(r.id).then(() => {
                  refresh();
                  onChanged();
                });
              }}
            >
              Delete
            </button>
          </div>
        ))}
      </div>
      <p className="rec-note">
        Recordings stay in this browser (never uploaded) and are auto-saved after you press Stop — play, download, or delete them below.
      </p>
    </div>
  );
}

/* =========================================================================
   便携导出:把录音 base64 嵌入一份独立 HTML 供分享
   ========================================================================= */
function blobToB64(blob: Blob): Promise<string> {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result as string);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(blob);
  });
}

async function exportPortable(questions: InterviewQuestion[]) {
  const all = await dbAll();
  if (!all.length) return { ok: false, text: "No recordings yet — record at least one answer first." };
  const recs = await Promise.all(
    all.map(async (r) => ({ ...r, dataUrl: await blobToB64(r.blob) }))
  );
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const qsHtml = questions
    .map((q, i) => {
      const qid = "q" + (i + 1);
      const steps = (q.steps || [])
        .map((s) => `<div class="step">${s}</div>`)
        .join("");
      const mine = recs
        .filter((r) => r.qid === qid)
        .sort((a, b) => a.ts - b.ts)
        .map(
          (r) =>
            `<div class="chip"><span class="meta">Saved ${esc(stamp(r.ts))} · ${fmt(r.dur)} · ${Math.max(
              1,
              Math.round(r.size / 1024)
            )} KB</span><audio controls preload="none" src="${r.dataUrl}"></audio></div>`
        )
        .join("");
      const tagCls = q.tagClass ? `tag ${q.tagClass}` : "tag";
      return `<section class="q">
  <h2><span class="${tagCls}">${esc(q.subject)}</span>${esc(q.heading)}</h2>
  <div class="stem">${q.stem}</div>
  <div class="focus"><b>What the interviewer looks for:</b> ${q.focus}</div>
  <details><summary>Detailed solution</summary><div class="sol">${steps}</div></details>
  <div class="rec" data-qid="${qid}">
    <div class="rec-title">Voice Answer Practice — record yourself answering this question</div>
    <div class="rec-saved">${mine || '<p class="rec-note">No recording for this question.</p>'}</div>
  </div>
</section>`;
    })
    .join("\n");
  const doc = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(CONFIG.title)} · with recordings</title>
<style>
:root{--ink:#1a1a1a;--paper:#fbf8f1;--band:#00467F;--band-2:#1f6fb2;--accent:#b8860b;--line:#d9d2c2;}
*{box-sizing:border-box;}
body{margin:0;background:#e9e4d8;color:var(--ink);font-family:"Iowan Old Style","Palatino Linotype",Georgia,"Noto Serif",serif;line-height:1.75;}
.wrap{max-width:880px;margin:32px auto;background:var(--paper);box-shadow:0 8px 30px rgba(0,0,0,.18);border-radius:4px;overflow:hidden;}
header{background:linear-gradient(135deg,var(--band),var(--band-2));color:#fff;padding:34px 44px;}
header h1{margin:0 0 6px;font-size:26px;letter-spacing:.5px;}
header p{margin:2px 0;opacity:.92;font-size:14px;}
.meta{margin-top:14px;font-size:13px;opacity:.85;}
main{padding:30px 44px 46px;}
.intro{background:#f1ead9;border-left:4px solid var(--accent);padding:14px 18px;border-radius:3px;font-size:14.5px;margin-bottom:28px;}
.q{margin:30px 0;padding-bottom:8px;border-bottom:1px solid var(--line);}
.q h2{font-size:18px;color:var(--band);margin:0 0 4px;}
.tag{display:inline-block;font-size:12px;padding:2px 10px;border-radius:20px;background:var(--band);color:#fff;margin-right:8px;vertical-align:middle;}
.tag.nt{background:#00467F;}.tag.comb{background:#7a3b8f;}
.stem{margin:12px 0;font-size:15.5px;}
.part{margin:10px 0;}.part b{color:#333;}
.eq{font-style:italic;}
sup{font-size:.72em;}sub{font-size:.72em;}
code{background:#efe9da;padding:1px 5px;border-radius:3px;font-size:.92em;}
.focus{font-size:13.8px;color:#5a5346;background:#f4efe2;border:1px dashed var(--line);padding:10px 14px;border-radius:3px;margin-top:10px;}
.focus b{color:var(--accent);}
details{margin-top:10px;background:#f6f2e8;border:1px solid var(--line);border-radius:3px;}
details summary{cursor:pointer;padding:9px 14px;font-weight:bold;color:var(--band);font-size:14px;}
details .sol{padding:8px 18px 18px;font-size:15px;}
details .sol .step{margin:12px 0;padding-left:12px;border-left:3px solid #c9b98f;}
details .sol .step b{color:#00467F;}
details .sol .key{background:#efe7d2;border-radius:3px;padding:2px 6px;font-weight:bold;color:#7a3b8f;}
.sol b{color:#7a3b8f;}
.rec{margin-top:14px;background:#fffdf7;border:1px solid var(--line);border-radius:4px;padding:10px 14px;font-size:14px;}
.rec .rec-title{font-weight:bold;color:var(--band);font-size:13px;letter-spacing:.3px;margin-bottom:8px;}
.rec .rec-saved{margin-top:10px;}
.rec .rec-saved .chip{display:flex;align-items:center;gap:8px;flex-wrap:wrap;border:1px solid var(--line);background:#f7f2e4;padding:6px 10px;border-radius:3px;margin-bottom:6px;}
.rec .rec-saved .chip .meta{color:#6b6357;font-size:12px;flex:1 1 auto;min-width:130px;}
.rec .rec-saved .chip audio{height:32px;max-width:220px;}
.rec .rec-note{font-size:11.5px;color:#8a8272;margin:6px 0 0;}
footer{padding:18px 44px 30px;font-size:12.5px;color:#6b6357;border-top:1px solid var(--line);}
@media (max-width:640px){header{padding:24px 20px;}main{padding:20px 20px 34px;}footer{padding:16px 20px 24px;}.wrap{margin:12px 8px;}}
</style>
</head>
<body>
<div class="wrap">
<header>
  <h1>${esc(CONFIG.title)}</h1>
  <p>${esc(CONFIG.subtitle)}</p>
  <p>${esc(CONFIG.subnote)}</p>
  <div class="meta">${esc(CONFIG.meta)}</div>
</header>
<main>
  <div class="intro">${CONFIG.intro}</div>
${qsHtml}
  <footer>${esc(CONFIG.footer)}</footer>
</main>
</div>
</body>
</html>`;
  const blob = new Blob([doc], { type: "text/html" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "cambridge_interview_set_A_with_recordings.html";
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  return { ok: true, text: `Downloaded a portable copy with ${recs.length} recording(s). Send that .html file — the recipient can open it and listen right away.` };
}

/* =========================================================================
   主页面:单题分页 + 导航 + 录音
   ========================================================================= */
export default function InterviewPage() {
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [current, setCurrent] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [done, setDone] = useState<Set<string>>(new Set());
  const [exportMsg, setExportMsg] = useState("");
  const [exporting, setExporting] = useState(false);
  const [secureMsg, setSecureMsg] = useState("");

  useEffect(() => {
    const u = getUser();
    if (!u || u.role !== "STUDENT") {
      window.location.href = "/login";
      return;
    }
    if (typeof window !== "undefined" && !window.isSecureContext) {
      setSecureMsg(
        "⚠️ 当前页面不是安全上下文(HTTPS 或 localhost),浏览器会阻止麦克风录音。正式使用时请配置 HTTPS。"
      );
    }
    api
      .get<{ list: InterviewQuestion[] }>("/interview")
      .then((d) => setQuestions(d.list))
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"))
      .finally(() => setLoading(false));
  }, []);

  // 键盘 ← → 翻题(输入框内不触发)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "ArrowLeft") setCurrent((c) => Math.max(0, c - 1));
      if (e.key === "ArrowRight") setCurrent((c) => Math.min(questions.length - 1, c + 1));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [questions.length]);

  // 加载完成后把有录音的题号标记为已练
  const refreshDone = useCallback(() => {
    dbAll()
      .then((all) => setDone(new Set(all.map((r) => r.qid))))
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshDone();
  }, [refreshDone]);

  if (loading)
    return (
      <div className="iw-scope">
        <div className="iw-wrap">
          <div className="iw-loading">Loading interview questions…</div>
        </div>
      </div>
    );

  if (error)
    return (
      <div className="iw-scope">
        <div className="iw-wrap">
          <div className="iw-error">
            <p>Failed to load questions.</p>
            <p style={{ fontSize: 13 }}>{error}</p>
          </div>
        </div>
      </div>
    );

  const q = questions[current];
  if (!q)
    return (
      <div className="iw-scope">
        <div className="iw-wrap">
          <div className="iw-error">No interview questions available yet.</div>
        </div>
      </div>
    );

  const qid = "q" + (current + 1);
  const tagCls = q.tagClass ? `iw-tag ${q.tagClass}` : "iw-tag";
  const stepsHtml = (q.steps || []).map((s) => `<div class="step">${s}</div>`).join("");

  return (
    <>
      <style>{PAGE_CSS}</style>
      <div className="iw-scope">
        <div className="iw-wrap">
          <div className="iw-header">
            <h1>{CONFIG.title}</h1>
            <p>{CONFIG.subtitle}</p>
            <p>{CONFIG.subnote}</p>
            <div className="meta">{CONFIG.meta}</div>
          </div>
          <div className="iw-main">
            <div className="iw-intro" dangerouslySetInnerHTML={{ __html: CONFIG.intro }} />
            {secureMsg && (
              <div className="iw-focus" style={{ marginBottom: 16 }}>
                <b>Note:</b> {secureMsg}
              </div>
            )}

            {/* 单题分页导航 */}
            <div className="iw-nav">
              <div className="grid">
                {questions.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`num ${i === current ? "current" : ""} ${done.has("q" + (i + 1)) ? "done" : ""}`}
                    onClick={() => setCurrent(i)}
                    title={done.has("q" + (i + 1)) ? "Question " + (i + 1) + " (recorded)" : "Question " + (i + 1)}
                  >
                    {i + 1}
                  </button>
                ))}
              </div>
              <span className="counter">
                Question {current + 1} of {questions.length}
              </span>
            </div>

            {/* 当前题卡片(形式与原 HTML 完全一致) */}
            <section className="iw-q">
              <h2>
                <span className={tagCls}>{q.subject}</span>
                {q.heading}
              </h2>
              <div className="iw-stem" dangerouslySetInnerHTML={{ __html: q.stem }} />
              <div className="iw-focus">
                <b>What the interviewer looks for:</b> <span dangerouslySetInnerHTML={{ __html: q.focus }} />
              </div>
              <div className="iw-sol">
                <details>
                  <summary>Detailed solution</summary>
                  <div className="sol" dangerouslySetInnerHTML={{ __html: stepsHtml }} />
                </details>
              </div>
              <RecorderBox qid={qid} onChanged={refreshDone} />
            </section>

            {/* Prev / Next */}
            <div className="iw-pager">
              <button type="button" disabled={current === 0} onClick={() => setCurrent((c) => Math.max(0, c - 1))}>
                ← Prev
              </button>
              <span className="pager-count">
                Question {current + 1} of {questions.length} (use ← → keys to switch)
              </span>
              <button
                type="button"
                disabled={current === questions.length - 1}
                onClick={() => setCurrent((c) => Math.min(questions.length - 1, c + 1))}
              >
                Next →
              </button>
            </div>
          </div>
          <div className="iw-footer">{CONFIG.footer}</div>
        </div>

        {/* 便携导出(录音分享) */}
        <div className="iw-export">
          <p>
            To <strong>share your spoken answers</strong>, press the button below: it downloads a copy of the interview
            set <strong>with the recordings embedded inside the HTML file</strong> (as base64). The recipient just opens
            that file and can listen immediately — nothing is uploaded to any server.
          </p>
          <button
            type="button"
            disabled={exporting}
            onClick={async () => {
              setExporting(true);
              setExportMsg("");
              try {
                const r = await exportPortable(questions);
                setExportMsg(r.text);
              } catch (e) {
                setExportMsg("Export failed: " + (e instanceof Error ? e.message : e));
              } finally {
                setExporting(false);
              }
            }}
          >
            Export portable HTML (with recordings)
          </button>
          <span>{exportMsg}</span>
        </div>
      </div>
    </>
  );
}
