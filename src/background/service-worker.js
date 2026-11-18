import { fetchJSON } from '../shared/network.js';
import { signWbi } from './wbi.js';
import { resolveVideo } from './video-info.js';

let keyCache;
async function playerURLs(info) {
  if (!/^\d+$/.test(String(info?.aid)) || !/^\d+$/.test(String(info?.cid))) throw new Error('视频标识无效');
  const params = { aid: info.aid, cid: info.cid };
  if (/^BV\w+$/.test(info.bvid || '')) params.bvid = info.bvid;
  const urls = [];
  try {
    if (!keyCache || Date.now() - keyCache.time > 3600000) {
      const data = (await fetchJSON('https://api.bilibili.com/x/web-interface/nav')).data;
      const key = value => new URL(value).pathname.split('/').pop().split('.')[0];
      keyCache = { img: key(data.wbi_img.img_url), sub: key(data.wbi_img.sub_url), time: Date.now() };
    }
    urls.push(`https://api.bilibili.com/x/player/wbi/v2?${signWbi(params, keyCache.img, keyCache.sub)}`);
  } catch { keyCache = null; }
  urls.push(`https://api.bilibili.com/x/player/v2?${new URLSearchParams(params)}`);
  return urls;
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || !['SL_FETCH', 'SL_RESOLVE', 'SL_PLAYER_URLS'].includes(message?.type)) return false;
  const task = message.type === 'SL_FETCH' ? fetchJSON(message.url) :
    message.type === 'SL_RESOLVE' ? resolveVideo(message.href, message.hint) : playerURLs(message.info);
  Promise.resolve(task).then(data => respond({ ok: true, data })).catch(error => respond({ ok: false, error: error.message || '字幕请求失败' }));
  return true;
});

chrome.commands.onCommand.addListener(async command => {
  if (command !== 'toggle-lyrics') return;
  const { enabled = true } = await chrome.storage.sync.get('enabled');
  await chrome.storage.sync.set({ enabled: !enabled });
});
