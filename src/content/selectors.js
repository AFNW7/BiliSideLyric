const candidates = {
  video: ['.bpx-player-video-area video', '.bilibili-player-video video', '#bilibili-player video', 'video'],
  area: ['.bpx-player-video-area', '.bilibili-player-video-wrap', '#bilibili-player', '#bofqi'],
  player: ['#bilibili-player', '#bofqi', '.bpx-player-container', '.bilibili-player'],
  notice: ['#playerWrap', '.player-wrap', '#bofqi', '#bilibili-player', '.bpx-player-container', '.bilibili-player'],
  subtitle: ['.bpx-player-subtitle-panel-text', '.bilibili-player-video-subtitle-panel-text', '.bpx-player-subtitle-panel .subtitle-item'],
  title: ['h1.video-title', '.video-title', '.media-title', 'h1']
};

function first(group) {
  return candidates[group].map(selector => document.querySelector(selector)).find(Boolean) || null;
}

export function getVideo() { return first('video'); }
export function getTitle() { return first('title')?.textContent?.trim() || document.title.replace(/_哔哩哔哩.*$/, ''); }
export function getPlayer(video = getVideo()) {
  return candidates.player.map(selector => video?.closest(selector)).find(Boolean) || video?.parentElement || null;
}
export function getNoticeAnchor(video = getVideo()) {
  return candidates.notice.map(selector => video?.closest(selector)).find(Boolean) || getPlayer(video);
}
export function getDOMSubtitle(video = getVideo()) {
  const player = getPlayer(video);
  if (!player) return '';
  for (const selector of candidates.subtitle) {
    const text = [...player.querySelectorAll(selector)].filter(node => {
      if (!node.getClientRects().length || node.closest('[hidden], [aria-hidden="true"]')) return false;
      for (let current = node; current; current = current.parentElement) {
        const style = getComputedStyle(current);
        if (style.visibility !== 'visible' || Number(style.opacity) === 0) return false;
        if (current === player) break;
      }
      return true;
    }).map(node => node.textContent.trim()).filter(Boolean).join('\n');
    if (text) return text;
  }
  return '';
}
export function getDOMIdentity(video = getVideo()) {
  const player = getPlayer(video);
  for (let element = video; element; element = element.parentElement) {
    const cid = element.getAttribute('data-cid') || element.getAttribute('cid');
    if (/^[1-9]\d*$/.test(cid || '')) return cid;
    if (element === player) break;
  }
  return '';
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
