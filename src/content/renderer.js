import { OverlayUI } from './overlay-ui.js';
import { computeLayout } from './layout.js';
import { cueState, cueProgress } from './timeline.js';
import { normalizeSettings } from '../shared/settings.js';
import { getMount, isFullscreen } from './selectors.js';

export class Renderer {
  constructor(settings, handlers, cssBase = new URL('../styles/', import.meta.url)) {
    this.settings = normalizeSettings(settings);
    this.cues = [];
    this.nodes = new Map();
    this.index = -1;
    this.context = 1;
    this.lastContextChange = -Infinity;
    this.host = document.createElement('div');
    this.host.id = 'sidelyric-root';
    this.shadow = this.host.attachShadow({ mode: 'open' });
    for (const file of ['overlay.css', 'settings.css']) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = new URL(file, cssBase).href;
      link.onload = () => this.layout();
      this.shadow.append(link);
    }
    this.ui = new OverlayUI(this.shadow, this.settings, handlers);
    this.resize = new ResizeObserver(() => this.layout());
    this.updateSettings(this.settings);
  }

  attach(video) {
    this.video = video;
    this.ui.mountNotice(video);
    const mount = getMount(video);
    if (this.host.parentElement !== mount.parent) mount.parent.append(this.host);
    this.mount = mount;
    this.host.style.cssText = `all:initial!important;position:${mount.fixed ? 'fixed' : 'absolute'}!important;inset:0!important;display:block!important;pointer-events:none!important;z-index:14!important;isolation:isolate!important;`;
    this.resize.disconnect();
    if (mount.area) this.resize.observe(mount.area);
    this.resize.observe(mount.parent);
    this.layout();
  }

  /** 一次计算布局与可见窗口，播放帧只更新当前句状态。 */
  layout() {
    if (!this.video || !this.mount?.area?.isConnected) return;
    const rect = this.mount.area.getBoundingClientRect();
    if (this.mount.fixed) {
      for (const [key, value] of Object.entries({ inset: 'auto', left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` })) this.host.style.setProperty(key, value, 'important');
    } else {
      const parentRect = this.mount.parent.getBoundingClientRect();
      this.host.style.setProperty('inset', 'auto', 'important');
      for (const [key, value] of Object.entries({ left: rect.left - parentRect.left, top: rect.top - parentRect.top, width: rect.width, height: rect.height })) this.host.style.setProperty(key, `${value}px`, 'important');
    }
    const layout = computeLayout(rect.width, rect.height, this.video.videoWidth, this.video.videoHeight, this.settings, this.context, this.lastContextChange);
    clearTimeout(this.layoutTimer);
    const settled = computeLayout(rect.width, rect.height, this.video.videoWidth, this.video.videoHeight, this.settings, this.context, -Infinity);
    if (settled.context !== layout.context) this.layoutTimer = setTimeout(() => this.layout(), 1550);
    if (layout.context !== this.context) { this.context = layout.context; this.lastContextChange = performance.now(); }
    this.rowHeight = layout.rowHeight;
    const style = this.ui.root.style;
    style.setProperty('--sl-left', `${layout.left}px`);
    style.setProperty('--sl-edge', `${layout.edgePadding}px`);
    style.setProperty('--sl-width', `${layout.maxWidth}px`);
    style.setProperty('--sl-row', `${layout.rowHeight}px`);
    this.ui.root.classList.toggle('sl-in-bars', layout.inBars);
    this.render(this.lastTime ?? 0, true);
  }

  updateSettings(settings) {
    this.settings = normalizeSettings(settings);
    this.ui.updateSettings(this.settings);
    const root = this.ui.root;
    root.style.setProperty('--sl-font-size', `${this.settings.fontSize}px`);
    root.style.setProperty('--sl-line-height', this.settings.lineHeight);
    root.style.setProperty('--sl-opacity', this.settings.opacity);
    root.style.setProperty('--sl-text-align', this.settings.textAlign);
    root.dataset.mode = this.settings.overflowMode;
    root.dataset.placement = this.settings.placement;
    root.classList.toggle('sl-enabled', this.settings.enabled);
    root.classList.toggle('sl-show-bg', this.settings.showBg);
    this.layout();
  }

  setTimeline(cues) {
    const changed = cues !== this.cues;
    this.cues = cues;
    if (changed) { this.nodes.clear(); this.ui.track.replaceChildren(); this.index = -1; }
    this.render(this.lastTime ?? 0, true);
  }

  render(time, force = false) {
    this.lastTime = time;
    this.ui.syncNotice();
    const state = cueState(this.cues, time + this.settings.offsetSec, this.index);
    const unavailable = !!document.pictureInPictureElement || (this.settings.hideInFullscreen && isFullscreen());
    this.ui.root.classList.toggle('sl-suppressed', unavailable);
    this.ui.root.classList.toggle('sl-has-lyrics', state.visible);
    this.ui.root.classList.toggle('sl-gap', state.gap);
    if (!force && state.index === this.index) { this.syncHorizontal(); return; }
    this.horizontal = null;
    const jump = Math.abs(state.index - this.index) > 3 || this.index < 0 || force;
    this.index = state.index;
    if (this.index < 0 || !this.rowHeight) return;
    const from = Math.max(0, this.index - this.context - 1);
    const to = Math.min(this.cues.length - 1, this.index + this.context + 1);
    for (const [index, node] of this.nodes) {
      if (index < from || index > to) { node.remove(); this.nodes.delete(index); }
    }
    for (let index = from; index <= to; index++) {
      let node = this.nodes.get(index);
      if (!node) {
        node = document.createElement('div');
        node.className = 'sl-line';
        const content = document.createElement('div');
        content.className = 'sl-line-content';
        const text = document.createElement('span');
        text.className = 'sl-text';
        text.textContent = this.cues[index].content;
        content.append(text); node.append(content);
        node.dataset.index = index;
        this.nodes.set(index, node);
        this.ui.track.append(node);
      }
      const distance = Math.abs(index - this.index);
      node.classList.toggle('is-current', index === this.index);
      node.setAttribute('aria-current', String(index === this.index));
      node.style.transform = `translateY(${index * this.rowHeight}px)`;
      node.style.opacity = distance > this.context ? '0' : distance === 0 ? '1' : String(Math.max(0.15, this.settings.opacity * (1 - 0.22 * distance)));
      node.style.setProperty('--sl-indent', `${Math.min(12, distance * 2)}px`);
      if (distance !== 0) {
        const text = node.querySelector('.sl-text');
        text.classList.remove('sl-timed-scroll');
        text.style.removeProperty('transform');
      }
    }
    this.ui.track.style.transition = jump ? 'none' : '';
    this.ui.track.style.transform = `translateY(${-this.index * this.rowHeight}px)`;
    cancelAnimationFrame(this.measureFrame);
    this.measureFrame = requestAnimationFrame(() => this.measureCurrent());
  }

  measureCurrent() {
    const node = this.nodes.get(this.index);
    if (!node) return;
    const content = node.querySelector('.sl-line-content');
    const text = node.querySelector('.sl-text');
    text.classList.remove('sl-timed-scroll');
    text.style.removeProperty('transform');
    this.horizontal = null;
    const shift = content.clientWidth - text.scrollWidth;
    if (this.settings.overflowMode === 'scroll' && shift < -2) {
      text.classList.add('sl-timed-scroll');
      this.horizontal = { text, shift };
      this.syncHorizontal();
    }
  }

  /** 每帧只写 transform，暂停不移动，快进和回退直接映射到字幕进度。 */
  syncHorizontal() {
    if (!this.horizontal) return;
    const progress = cueProgress(this.cues, this.index, this.lastTime + this.settings.offsetSec);
    const shift = this.horizontal.shift * progress;
    if (shift === this.horizontal.position) return;
    this.horizontal.text.style.transform = `translateX(${shift}px)`;
    this.horizontal.position = shift;
  }

  updateStatus(status) { this.ui.updateStatus(status); }
  poke() { this.ui.poke(); }
  destroy() { this.resize.disconnect(); clearTimeout(this.layoutTimer); cancelAnimationFrame(this.measureFrame); this.ui.destroy(); this.host.remove(); this.nodes.clear(); }
}
