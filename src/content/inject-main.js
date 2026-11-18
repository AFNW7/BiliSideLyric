(() => {
  if (window.__SIDELYRIC_MAIN__) return;
  window.__SIDELYRIC_MAIN__ = true;
  const channel = 'sidelyric:bridge:v1';
  function activePlayer() {
    try {
      const player = window.player;
      const info = player?.getManifest?.() || player?.getVideoMessage?.();
      if (!/^[1-9]\d*$/.test(String(info?.aid)) || !/^[1-9]\d*$/.test(String(info?.cid))) return null;
      return { aid: info.aid, cid: info.cid, bvid: info.bvid, page: info.p || info.page, episodeId: info.episodeId };
    } catch { return null; }
  }
  function context() {
    const state = window.__INITIAL_STATE__ || {};
    const data = state.videoData || {};
    const url = new URL(location.href);
    const page = Math.max(1, Number(url.searchParams.get('p')) || 1);
    const part = data.pages?.find(item => item.page === page);
    const episode = state.epInfo || {};
    const episodeKey = url.pathname.match(/^\/bangumi\/play\/(ep|ss)(\d+)/)?.[0];
    const player = activePlayer();
    if (episodeKey) {
      const valid = episodeKey === `/bangumi/play/ep${episode.id}`;
      return { ...(valid ? { aid: episode.aid, cid: episode.cid, bvid: episode.bvid, title: episode.long_title || episode.title, episodeKey } : {}), player };
    }
    return { aid: data.aid || state.aid, bvid: data.bvid || state.bvid, cid: part?.cid || (page === 1 ? data.cid || state.cid : undefined), title: data.title, page, player };
  }
  window.addEventListener('message', async event => {
    const message = event.data;
    if (event.source !== window || event.origin !== location.origin || message?.channel !== channel || message.direction !== 'request' || typeof message.id !== 'string') return;
    let data;
    let error;
    try {
      if (message.kind === 'context') data = context();
      else if (message.kind === 'fetch') {
        const url = new URL(message.url);
        const api = url.hostname === 'api.bilibili.com' && ['/x/player/wbi/v2', '/x/player/v2'].includes(url.pathname);
        const subtitle = url.hostname.endsWith('.hdslb.com');
        if (url.protocol !== 'https:' || url.username || url.password || url.port || (!api && !subtitle)) throw new Error('无效字幕地址');
        const response = await fetch(url.href, { credentials: 'include', signal: AbortSignal.timeout(4500) });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (text.length > 4 * 1024 * 1024) throw new Error('字幕响应过大');
        data = JSON.parse(text);
      } else return;
    } catch (failure) { error = failure.message; }
    window.postMessage({ channel, direction: 'response', id: message.id, data, error }, location.origin);
  });
})();
