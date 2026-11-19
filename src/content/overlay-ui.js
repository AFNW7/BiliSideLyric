import { createSettingsView } from '../shared/settings-view.js';
import { icon } from '../shared/icons.js';
import { getNoticeAnchor, isFullscreen, pageKey } from './selectors.js';

export class OverlayUI {
  constructor(shadow, settings, handlers) {
    this.handlers = handlers;
    this.settings = settings;
    const root = document.createElement('div');
    root.className = 'sl-root';
    root.innerHTML = `
      <div class="sl-backdrop"></div>
      <div class="sl-viewport" aria-label="旁白歌词字幕"><div class="sl-track"></div></div>
      <div class="sl-toolbar" role="toolbar" aria-label="旁白控制条">
        <button type="button" class="sl-brand-button" data-action="settings" aria-label="打开旁白设置" title="旁白设置">${icon('mark')}<span>旁白</span></button>
        <span class="sl-toolbar-divider"></span>
        <button type="button" data-action="toggle" aria-label="显示或隐藏歌词" title="显示 / 隐藏 · Alt+L">${icon('eye')}</button>
        <button type="button" class="sl-drag" aria-label="拖动调整边缘留白，双击复位" title="拖动调整边缘留白 · 双击复位">${icon('grip')}</button>
      </div>
      <div class="sl-hint" role="status"><span class="sl-hint-mark">${icon('mark')}</span><div class="sl-hint-copy"><strong></strong><small></small></div><div class="sl-hint-actions"><button type="button" data-action="retry">重新获取</button><button type="button" data-action="capture">采集已开启字幕</button><button type="button" data-action="import">导入字幕</button></div></div>
      <section class="sl-panel" aria-label="旁白设置" hidden>
        <header><span>${icon('mark')} 旁白 <small>SIDELYRIC</small></span><button type="button" data-action="close" aria-label="关闭设置">${icon('close')}</button></header>
        <div class="sl-panel-scroll"><div class="sl-panel-status" role="status"></div><div class="sl-settings-mount"></div></div>
        <footer>每一句，都有自己的位置。</footer>
      </section>
      <input class="sl-file" type="file" accept=".srt,.lrc" hidden>`;
    shadow.append(root);
    this.root = root;
    this.panel = root.querySelector('.sl-panel');
    this.viewport = root.querySelector('.sl-viewport');
    this.track = root.querySelector('.sl-track');
    this.hint = root.querySelector('.sl-hint');
    this.notice = document.createElement('div');
    this.notice.id = 'sidelyric-notice';
    this.notice.style.cssText = 'all:initial!important;display:block!important;visibility:hidden!important;position:fixed!important;bottom:12px!important;z-index:1000!important;box-sizing:border-box!important;';
    const noticeShadow = this.notice.attachShadow({ mode: 'open' });
    const noticeStyle = document.createElement('link');
    noticeStyle.rel = 'stylesheet';
    noticeStyle.href = new URL('../styles/notice.css', import.meta.url).href;
    const dismiss = document.createElement('button');
    dismiss.className = 'sl-notice-close';
    dismiss.type = 'button';
    dismiss.setAttribute('aria-label', '关闭提示');
    dismiss.textContent = '×';
    dismiss.addEventListener('click', () => { this.noticeDismissed = true; this.syncNotice(); });
    this.hint.append(dismiss);
    noticeShadow.append(noticeStyle, this.hint);
    this.hint.addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (button) this.action(button.dataset.action);
    });
    this.view = createSettingsView(root.querySelector('.sl-settings-mount'), {
      settings, onPreview: handlers.onPreview, onCommit: handlers.onCommit,
      onAction: (action, value) => this.action(action, value)
    });
    root.querySelector('.sl-file').addEventListener('change', async event => {
      const file = event.target.files[0];
      if (file) this.handlers.onAction('import-file', file);
      event.target.value = '';
    });
    root.addEventListener('click', event => {
      const button = event.target.closest('[data-action]');
      if (button && !button.closest('.sl-settings')) this.action(button.dataset.action);
      this.poke();
    });
    this.panel.addEventListener('keydown', event => { event.stopPropagation(); if (event.key === 'Escape') this.close(); });
    this.panel.addEventListener('pointerdown', event => event.stopPropagation());
    root.addEventListener('focusin', () => this.poke());
    const drag = root.querySelector('.sl-drag');
    drag.addEventListener('dblclick', () => { handlers.onPreview({ leftPadding: 24 }); handlers.onCommit({ leftPadding: 24 }); });
    drag.addEventListener('pointerdown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      drag.setPointerCapture(event.pointerId);
      const start = event.clientX;
      const padding = this.settings.leftPadding;
      const direction = this.settings.placement === 'right' ? -1 : 1;
      let value = padding;
      const move = pointer => { value = Math.round(Math.max(0, Math.min(240, padding + direction * (pointer.clientX - start)))); handlers.onPreview({ leftPadding: value }); this.poke(); };
      const finish = () => { drag.removeEventListener('pointermove', move); drag.removeEventListener('pointerup', finish); drag.removeEventListener('pointercancel', finish); handlers.onCommit({ leftPadding: value }); };
      drag.addEventListener('pointermove', move);
      drag.addEventListener('pointerup', finish);
      drag.addEventListener('pointercancel', finish);
    });
    this.poke();
  }

  action(action, value) {
    if (action === 'settings') {
      this.panel.hidden = !this.panel.hidden;
      this.root.classList.toggle('sl-panel-open', !this.panel.hidden);
      if (!this.panel.hidden) this.panel.querySelector('button').focus({ preventScroll: true });
    } else if (action === 'close') this.close();
    else if (action === 'import') this.root.querySelector('.sl-file').click();
    else this.handlers.onAction(action, value);
  }

  close() {
    this.panel.hidden = true;
    this.root.classList.remove('sl-panel-open');
    this.root.querySelector('[data-action="settings"]').focus({ preventScroll: true });
  }

  poke() {
    this.root.classList.add('sl-controls-visible');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => {
      if (!this.root.querySelector(':focus-visible')) this.root.classList.remove('sl-controls-visible');
    }, 3000);
  }

  mountNotice(video) {
    this.noticeAnchor = getNoticeAnchor(video);
    // 不插入站点的服务端渲染树，避免 Vue 水合时把提示误认为原有兄弟节点。
    if (this.notice.parentNode !== document.body) document.body.append(this.notice);
    this.positionNotice();
  }

  positionNotice() {
    const rect = this.noticeAnchor?.isConnected ? this.noticeAnchor.getBoundingClientRect() : null;
    const width = Math.max(0, Math.min(rect?.width || 0, innerWidth - 24));
    this.notice.style.setProperty('width', `${width}px`, 'important');
    this.notice.style.setProperty('left', `${Math.max(12, Math.min(rect?.left || 0, innerWidth - width - 12))}px`, 'important');
    this.noticeFits = !!rect && rect.bottom > 0 && width > 0 && rect.bottom + 10 <= innerHeight - this.hint.getBoundingClientRect().height - 12;
    this.syncNotice();
  }

  syncNotice() {
    const show = this.noticeFits && !this.noticeDismissed && !!this.settings.enabled && !!this.status && this.status.phase !== 'ready' && !isFullscreen() && !document.pictureInPictureElement;
    if (this.noticeShown === show) return;
    this.noticeShown = show;
    this.notice.style.setProperty('visibility', show ? 'visible' : 'hidden', 'important');
  }

  updateSettings(settings) { this.settings = settings; this.view.updateSettings(settings); this.syncNotice(); }
  updateStatus(status) {
    if (this.noticePage !== pageKey() || this.status?.video?.cid !== status.video?.cid) this.noticeDismissed = false;
    this.noticePage = pageKey();
    this.status = status;
    this.view.updateStatus(status);
    this.root.querySelector('.sl-panel-status').textContent = `${status.source || status.message}${status.count ? ` · ${status.count} 句` : ''}`;
    this.hint.querySelector('strong').textContent = status.message || '';
    this.hint.querySelector('small').textContent = status.detail || '';
    this.hint.hidden = status.phase === 'ready';
    this.hint.querySelector('[data-action="retry"]').hidden = status.phase === 'loading';
    this.hint.querySelector('[data-action="capture"]').hidden = !['empty', 'error'].includes(status.phase) || status.source === '实时采集';
    this.positionNotice();
  }
  destroy() { clearTimeout(this.idleTimer); this.notice.remove(); }
}
