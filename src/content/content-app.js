import { loadSettings, saveSettings, watchSettings } from './settings-bridge.js';
import { normalizeSettings } from '../shared/settings.js';
import { Renderer } from './renderer.js';
import { SubtitleSource } from './subtitle-source.js';
import { getVideo, getDOMSubtitle, getDOMIdentity, pageKey } from './selectors.js';
import { askPage } from './page-bridge.js';

/** 绑定播放器生命周期；同一播放器只保留一个动画循环与观察器。 */
export async function start() {
  let settings = await loadSettings();
  let video = null;
  let videoEvents;
  let key = '';
  let identity = '';
  let stateCID = '';
  let checkTimer;
  let frame;
  let destroyed = false;
  const lifetime = new AbortController();
  const preview = patch => { settings = normalizeSettings({ ...settings, ...patch }); renderer.updateSettings(settings); };
  const commit = patch => saveSettings(patch).catch(() => source.update({ detail: '设置保存失败，请重新打开扩展后再试' }));
  const action = async (name, value) => {
    try {
      if (name === 'toggle') { preview({ enabled: !settings.enabled }); await commit({ enabled: settings.enabled }); }
      else if (name === 'retry') await source.start();
      else if (name === 'track') await source.select(value);
      else if (name === 'restore') await source.restore();
      else if (name === 'capture') source.enableDOM();
      else if (name === 'import-file') await source.importFile(value);
    } catch (error) { source.update({ phase: 'error', message: error.message, detail: '请换一个字幕文件，或重新获取在线字幕' }); }
  };
  const renderer = new Renderer(settings, { onPreview: preview, onCommit: commit, onAction: action });
  const source = new SubtitleSource(cues => renderer.setTimeline(cues), status => renderer.updateStatus(status));
  const unwatch = watchSettings(next => { settings = next; renderer.updateSettings(settings); });

  function bind(next) {
    videoEvents?.abort();
    videoEvents = new AbortController();
    video = next;
    if (!video) { renderer.host.remove(); renderer.ui.notice.remove(); return; }
    renderer.attach(video);
    for (const name of ['loadedmetadata', 'resize', 'enterpictureinpicture', 'leavepictureinpicture']) {
      video.addEventListener(name, () => renderer.attach(video), { signal: videoEvents.signal });
    }
    for (const name of ['emptied', 'loadstart']) video.addEventListener(name, () => source.start(), { signal: videoEvents.signal });
  }

  function check() {
    clearTimeout(checkTimer);
    if (destroyed) return;
    if (!/^\/(video\/|bangumi\/play\/)/.test(location.pathname)) {
      if (video) { bind(null); source.destroy(); key = ''; }
      return;
    }
    const next = getVideo();
    if (next !== video) bind(next);
    else if (video && (!renderer.host.isConnected || renderer.mount?.parent !== renderer.host.parentElement)) renderer.attach(video);
    if (video) renderer.ui.mountNotice(video);
    const nextKey = pageKey();
    const nextIdentity = getDOMIdentity();
    if (nextKey !== key || (identity && nextIdentity && nextIdentity !== identity) || (source.info && !source.isCurrent())) {
      key = nextKey;
      stateCID = '';
      source.start();
    }
    identity = nextIdentity;
    if (video && source.domAllowed) source.capture(getDOMSubtitle(video), video.currentTime);
  }
  function schedule() { clearTimeout(checkTimer); checkTimer = setTimeout(check, 120); }
  const observer = new MutationObserver(schedule);
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-cid', 'cid'] });
  const poll = setInterval(check, 1000);
  let checkingContext = false;
  const contextPoll = setInterval(async () => {
    if (!video || destroyed || checkingContext) return;
    checkingContext = true;
    try {
      const currentKey = pageKey();
      const context = await askPage('context');
      if (destroyed || currentKey !== key) return;
      const cid = context?.player ? `${context.player.aid}:${context.player.cid}` : '';
      if ((stateCID && cid !== stateCID) || (cid && source.info && cid !== `${source.info.aid}:${source.info.cid}`)) source.start();
      stateCID = cid;
    } catch { /* MAIN bridge 不可用时后台仍可继续工作。 */ }
    finally { checkingContext = false; }
  }, 500);
  function tick() {
    if (destroyed) return;
    if (video && !document.hidden) {
      if (!source.isCurrent()) { if (renderer.cues.length) renderer.setTimeline([]); }
      else renderer.render(video.currentTime);
    }
    frame = requestAnimationFrame(tick);
  }
  document.addEventListener('fullscreenchange', () => { if (video) renderer.attach(video); }, { signal: lifetime.signal });
  for (const name of ['resize', 'scroll', 'popstate', 'hashchange', 'urlchange']) window.addEventListener(name, schedule, { signal: lifetime.signal, passive: true });
  document.addEventListener('pointermove', event => {
    if (!video || !renderer.host.isConnected) return;
    const rect = renderer.host.getBoundingClientRect();
    const nearEdge = settings.placement === 'right' ? event.clientX >= rect.right - Math.min(rect.width, 560) : event.clientX <= rect.left + Math.min(rect.width, 560);
    if (nearEdge && event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom) renderer.poke();
  }, { signal: lifetime.signal, passive: true });
  document.addEventListener('keydown', event => {
    if (!event.altKey || event.ctrlKey || event.metaKey || !['[', ']'].includes(event.key)) return;
    if (event.composedPath().some(node => node.matches?.('input, textarea, select, [contenteditable="true"]'))) return;
    event.preventDefault();
    const offsetSec = Math.max(-3, Math.min(3, Math.round((settings.offsetSec + (event.key === '[' ? -0.2 : 0.2)) * 10) / 10));
    preview({ offsetSec }); commit({ offsetSec });
  }, { signal: lifetime.signal });

  const messages = (message, sender, respond) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message?.type === 'SL_GET_STATUS') { respond({ ...source.status, settings, connected: !!video, href: location.href }); return false; }
    if (message?.type === 'SL_PREVIEW_SETTINGS') { preview(message.patch); respond({ ok: true }); return false; }
    if (message?.type === 'SL_ACTION') { action(message.action, message.value).then(() => respond({ ok: true })); return true; }
    if (message?.type === 'SL_IMPORT') {
      if (typeof message.text !== 'string' || message.text.length > 2 * 1024 * 1024 || typeof message.name !== 'string') { respond({ ok: false, error: '字幕文件无效或超过 2 MB' }); return false; }
      source.importFile(new File([message.text], message.name.slice(0, 200))).then(() => respond({ ok: true })).catch(error => respond({ ok: false, error: error.message }));
      return true;
    }
    return false;
  };
  chrome.runtime.onMessage.addListener(messages);
  const destroy = () => {
    destroyed = true;
    clearInterval(poll); clearInterval(contextPoll); clearTimeout(checkTimer); cancelAnimationFrame(frame);
    observer.disconnect(); videoEvents?.abort(); lifetime.abort(); unwatch(); source.destroy(); renderer.destroy();
    chrome.runtime.onMessage.removeListener(messages);
  };
  window.addEventListener('pagehide', event => { if (!event.persisted) destroy(); }, { once: true });
  check();
  tick();
}
