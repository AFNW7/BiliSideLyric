const candidates = {
  video: ['.bpx-player-video-area video', '.bilibili-player-video video', '#bilibili-player video', 'video'],
  area: ['.bpx-player-video-area', '.bilibili-player-video-wrap', '#bilibili-player', '#bofqi'],
  subtitle: ['.bpx-player-subtitle-panel-text', '.bilibili-player-video-subtitle-panel-text', '.bpx-player-subtitle-panel .subtitle-item'],
  title: ['h1.video-title', '.video-title', '.media-title', 'h1'],
  identity: ['[data-cid]', '[cid]']
};

function first(group) {
  return candidates[group].map(selector => document.querySelector(selector)).find(Boolean) || null;
}

export function getVideo() { return first('video'); }
export function getTitle() { return first('title')?.textContent?.trim() || document.title.replace(/_哔哩哔哩.*$/, ''); }
export function getDOMSubtitle() {
  for (const selector of candidates.subtitle) {
    const text = [...document.querySelectorAll(selector)].filter(node => node.getClientRects().length).map(node => node.textContent.trim()).filter(Boolean).join('\n');
    if (text) return text;
  }
  return '';
}
export function getDOMIdentity() {
  const element = first('identity');
  return element?.getAttribute('data-cid') || element?.getAttribute('cid') || '';
}

export function isFullscreen() {
  return !!document.fullscreenElement || !!document.querySelector('.bpx-state-web, .bpx-player-web-fullscreen, .bilibili-player.mode-webfullscreen');
}

/** 只选择已定位的播放器祖先，不修改站点元素的样式或结构。 */
export function getMount(video = getVideo()) {
  const area = first('area') || video;
  let element = area;
  for (let depth = 0; element && depth < 7; depth++, element = element.parentElement) {
    if (getComputedStyle(element).position !== 'static') return { parent: element, area, fixed: false };
  }
  return { parent: document.body, area, fixed: true };
}

export function pageKey(href = location.href) {
  const url = new URL(href);
  return `${url.pathname.replace(/\/$/, '')}?p=${Math.max(1, Number(url.searchParams.get('p')) || 1)}`;
}
