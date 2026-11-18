/** 仅允许 B 站已知接口与字幕 CDN，防止页面消息变成通用代理。 */
export function allowedURL(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || (url.port && url.port !== '443')) return false;
    if (url.hostname === 'api.bilibili.com') {
      return ['/x/web-interface/view', '/x/web-interface/nav', '/x/player/wbi/v2', '/x/player/v2', '/pgc/view/web/season'].includes(url.pathname);
    }
    return url.hostname.endsWith('.hdslb.com');
  } catch { return false; }
}

/** 字幕按 CDN 域名校验，保留鉴权参数，并将旧版 HTTP 地址升级为 HTTPS。 */
export function normalizeSubtitleURL(value) {
  let url;
  try { url = new URL(value, 'https://www.bilibili.com'); }
  catch { throw Object.assign(new Error('字幕服务返回的地址无效'), { retryable: false }); }
  if (url.protocol === 'http:' && url.hostname.endsWith('.hdslb.com')) url.protocol = 'https:';
  if (!url.hostname.endsWith('.hdslb.com') || !allowedURL(url.href)) {
    throw Object.assign(new Error('字幕服务返回了不支持的地址，请更新扩展'), { retryable: false });
  }
  return url.href;
}

export async function fetchJSON(url, timeout = 8000) {
  if (!allowedURL(url)) throw new Error('不允许请求此字幕地址');
  const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(timeout) });
  if (!response.ok) throw new Error(`字幕服务返回 HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > 4 * 1024 * 1024) throw new Error('字幕响应过大');
  return JSON.parse(text);
}
