import { createSettingsView } from '../shared/settings-view.js';
import { icon } from '../shared/icons.js';

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
      <div class="sl-hint" role="status"><span class="sl-hint-mark">${icon('mark')}</span><div><strong></strong><small></small><button type="button" data-action="retry">重新获取 ${icon('refresh')}</button><button type="button" data-action="import">导入字幕</button></div></div>
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

  updateSettings(settings) { this.settings = settings; this.view.updateSettings(settings); }
  updateStatus(status) {
    this.view.updateStatus(status);
    this.root.querySelector('.sl-panel-status').textContent = `${status.source || status.message}${status.count ? ` · ${status.count} 句` : ''}`;
    this.hint.querySelector('strong').textContent = status.message || '';
    this.hint.querySelector('small').textContent = status.detail || '';
    this.hint.hidden = status.phase === 'ready';
    this.hint.querySelector('[data-action="retry"]').hidden = status.phase === 'loading';
  }
  destroy() { clearTimeout(this.idleTimer); }
}
