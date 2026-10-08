// 内存导入任务管理:批量导入改为"任务式"后,前端轮询进度条展示真实进度。
// 任务存内存(单进程 pm2 fork 模式够用);简单 TTL 清理防内存泄漏。
import crypto from "crypto";

const tasks = new Map(); // id -> { id, status, progress, message, result, error, createdAt }
const TTL_MS = 30 * 60 * 1000; // 30 分钟过期

export function createImportTask() {
  const id = crypto.randomUUID();
  const t = { id, status: "running", progress: 0, message: "正在准备...", result: null, error: null, createdAt: Date.now() };
  tasks.set(id, t);
  return t;
}

export function updateImportTask(id, patch) {
  const t = tasks.get(id);
  if (!t) return;
  Object.assign(t, patch);
}

export function finishImportTask(id, result) {
  const t = tasks.get(id);
  if (!t) return;
  t.status = "done";
  t.progress = 100;
  t.message = "导入完成";
  t.result = result;
}

export function failImportTask(id, message) {
  const t = tasks.get(id);
  if (!t) return;
  t.status = "error";
  t.message = message;
  t.error = message;
}

export function getImportTask(id) {
  // 惰性清理过期任务
  for (const [k, v] of tasks) {
    if (Date.now() - v.createdAt > TTL_MS) tasks.delete(k);
  }
  return tasks.get(id) || null;
}

function cleanupImportTasks() {
  for (const [k, v] of tasks) {
    if (Date.now() - v.createdAt > TTL_MS) tasks.delete(k);
  }
}
// 每 5 分钟兜底清理一次
setInterval(cleanupImportTasks, 5 * 60 * 1000).unref();
