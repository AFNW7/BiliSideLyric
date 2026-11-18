const channel = 'sidelyric:bridge:v1';
const pending = new Map();
window.addEventListener('message', event => {
  const message = event.data;
  if (event.source !== window || event.origin !== location.origin || message?.channel !== channel || message.direction !== 'response') return;
  const entry = pending.get(message.id);
  if (!entry) return;
  clearTimeout(entry.timer);
  pending.delete(message.id);
  if (message.error) entry.reject(new Error(message.error));
  else entry.resolve(message.data);
});

export function askPage(kind, payload = {}) {
  return new Promise((resolve, reject) => {
    const id = crypto.randomUUID();
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('页面字幕接口超时')); }, kind === 'context' ? 1000 : 5000);
    pending.set(id, { resolve, reject, timer });
    window.postMessage({ channel, direction: 'request', id, kind, ...payload }, location.origin);
  });
}

export async function askWorker(message) {
  const result = await chrome.runtime.sendMessage(message);
  if (!result?.ok) throw new Error(result?.error || '扩展已更新，请刷新视频页');
  return result.data;
}

export async function readJSON(url) {
  try { return await askPage('fetch', { url }); }
  catch { return askWorker({ type: 'SL_FETCH', url }); }
}
