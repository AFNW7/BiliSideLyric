import { loadSettings, saveSettings, watchSettings } from '../content/settings-bridge.js';
import { createSettingsView } from '../shared/settings-view.js';

let tab;
let statusTimer;
const notice = document.querySelector('#notice');
function tell(message) { notice.textContent = message; notice.hidden = !message; }
async function send(message) {
  if (!tab?.id) throw new Error('先在当前标签页打开一个 B 站视频');
  try { return await chrome.tabs.sendMessage(tab.id, message); }
  catch { throw new Error('请刷新 B 站视频页，让旁白连接播放器'); }
}

async function connect() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const supported = /^https:\/\/www\.bilibili\.com\/(video\/|bangumi\/play\/)/.test(tab?.url || '');
  if (!supported) { tab = null; return; }
  try {
    const status = await send({ type: 'SL_GET_STATUS' });
    document.body.classList.toggle('connected', status.connected);
    document.querySelector('#connection').textContent = status.phase === 'ready' ? '字幕已连接' : status.connected ? '已找到播放器' : '等待播放器';
    document.querySelector('#video-title').textContent = status.title || '正在读取视频信息';
    document.querySelector('#video-detail').textContent = status.phase === 'ready' ? `${status.count} 句字幕 · ${status.detail || '跟随视频播放'}` : status.message;
    document.querySelector('#source-badge').textContent = status.source || 'BILIBILI';
    view.updateStatus(status);
  } catch (error) { document.querySelector('#video-detail').textContent = error.message; }
}

const view = createSettingsView(document.querySelector('#settings'), {
  settings: await loadSettings(),
  onPreview: patch => { if (tab) send({ type: 'SL_PREVIEW_SETTINGS', patch }).catch(() => {}); },
  onCommit: patch => saveSettings(patch).catch(() => tell('设置保存失败，请稍后重试')),
  onAction: async (action, value) => {
    tell('');
    if (action === 'import') {
      if (!tab) return tell('先在当前标签页打开一个 B 站视频');
      document.querySelector('#file').click();
      return;
    }
    try { await send({ type: 'SL_ACTION', action, value }); await connect(); }
    catch (error) { tell(error.message); }
  }
});
const unwatch = watchSettings(next => view.updateSettings(next));
document.querySelector('#file').addEventListener('change', async event => {
  const file = event.target.files[0];
  if (!file) return;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('请选择不超过 2 MB 的字幕文件');
    const result = await send({ type: 'SL_IMPORT', name: file.name, text: await file.text() });
    if (!result?.ok) throw new Error(result?.error || '导入失败');
    tell('字幕已导入，并为当前视频保存。');
    await connect();
  } catch (error) { tell(error.message); }
  event.target.value = '';
});
await connect();
statusTimer = setInterval(connect, 1500);
window.addEventListener('pagehide', () => { clearInterval(statusTimer); unwatch(); }, { once: true });
