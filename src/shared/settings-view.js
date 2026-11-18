import { DEFAULTS, normalizeSettings } from './settings.js';
import { icon } from './icons.js';

const ranges = [
  ['fontSize', '字号', 12, 40, 1, 'px'],
  ['opacity', '文字透明度', 0.2, 1, 0.05, '%'],
  ['maxWidthPct', '歌词宽度', 20, 60, 1, '%'],
  ['lineHeight', '行间距', 1.1, 2, 0.1, '倍'],
  ['leftPadding', '边缘留白', 0, 240, 2, 'px']
];
const rangeHTML = key => {
  const [, label, minimum, maximum, step] = ranges.find(item => item[0] === key);
  return `<label class="sl-field"><span>${label}<output data-output="${key}"></output></span><input aria-label="${label}" type="range" data-key="${key}" min="${minimum}" max="${maximum}" step="${step}"></label>`;
};
const toggleHTML = (key, label, description = '') => `<label class="sl-toggle-row"><span>${label}${description ? `<small>${description}</small>` : ''}</span><input type="checkbox" class="sl-switch" data-key="${key}" aria-label="${label}"></label>`;

/** Popup 和页内面板共用设置，拖动先预览，松开后同步保存。 */
export function createSettingsView(root, { settings = DEFAULTS, onPreview, onCommit, onAction } = {}) {
  let current = normalizeSettings(settings);
  root.classList.add('sl-settings');
  root.innerHTML = `
    ${toggleHTML('enabled', '显示歌词', '为当前播放打开另一种视角')}
    <div class="sl-tabs" role="tablist" aria-label="设置分类">
      <button type="button" role="tab" aria-selected="true" data-tab="look">外观</button>
      <button type="button" role="tab" aria-selected="false" data-tab="sync">同步</button>
      <button type="button" role="tab" aria-selected="false" data-tab="more">更多</button>
    </div>
    <section data-section="look" role="tabpanel" aria-label="外观设置">
      ${rangeHTML('fontSize')}${rangeHTML('opacity')}${rangeHTML('maxWidthPct')}
      <div class="sl-field"><span>长句如何显示</span><div class="sl-segments" role="group" aria-label="长句如何显示">
        <button type="button" data-mode="scroll">随播放滑动</button><button type="button" data-mode="wrap">自动换行</button><button type="button" data-mode="clip">省略截断</button>
      </div><small class="sl-help">按本句到下一句的时间推进，暂停停住，回退同步恢复。</small></div>
      ${toggleHTML('showBg', '柔和底衬', '在明亮画面上也清晰可读')}
    </section>
    <section data-section="sync" role="tabpanel" aria-label="同步设置" hidden>
      <div class="sl-field"><span>时间轴微调<output data-output="offsetSec"></output></span>
        <div class="sl-offset"><button type="button" data-offset="-0.2" aria-label="时间偏移减少 0.2 秒">−</button>
        <input type="range" data-key="offsetSec" aria-label="时间轴偏移" min="-3" max="3" step="0.1">
        <button type="button" data-offset="0.2" aria-label="时间偏移增加 0.2 秒">+</button></div>
        <small class="sl-help">正值让歌词提前，负值让歌词延后</small>
      </div>
      <label class="sl-field"><span>字幕语言</span><select data-track aria-label="字幕语言"><option value="">自动选择 AI 中文</option></select></label>
      <label class="sl-field"><span>上下文条数</span><select data-key="contextLines" aria-label="上下文条数">
        <option value="auto">自动 · 随播放器高度调整</option>${Array.from({ length: 8 }, (_, index) => `<option value="${index + 1}">前后各 ${index + 1} 句</option>`).join('')}
      </select></label>
      <div class="sl-actions"><button type="button" data-action="retry">${icon('refresh')}重新获取</button><button type="button" data-action="import">${icon('upload')}导入字幕</button></div>
      <button type="button" class="sl-text-button" data-action="restore" hidden>移除本地字幕，恢复在线获取</button>
    </section>
    <section data-section="more" role="tabpanel" aria-label="更多设置" hidden>
      <label class="sl-field"><span>歌词位置</span><select data-key="placement" aria-label="歌词位置">
        <option value="left">靠左</option><option value="right">靠右</option>
      </select></label>
      <label class="sl-field"><span>字幕对齐</span><select data-key="textAlign" aria-label="字幕对齐">
        <option value="left">左对齐</option><option value="center">居中对齐</option><option value="right">右对齐</option>
      </select></label>
      ${rangeHTML('lineHeight')}${rangeHTML('leftPadding')}
      ${toggleHTML('hideInFullscreen', '全屏时隐藏')}
      <div class="sl-shortcuts"><span>显示 / 隐藏 <kbd>Alt L</kbd></span><span>偏移 ±0.2 秒 <kbd>Alt [ / ]</kbd></span></div>
      <button type="button" class="sl-text-button" data-action="reset">恢复默认设置</button>
    </section>`;

  function updateSettings(next) {
    current = normalizeSettings(next);
    for (const input of root.querySelectorAll('[data-key]')) {
      const value = current[input.dataset.key];
      if (input.type === 'checkbox') input.checked = value;
      else input.value = value;
      if (input.type === 'range') input.style.setProperty('--sl-fill', `${(value - Number(input.min)) / (Number(input.max) - Number(input.min)) * 100}%`);
    }
    for (const output of root.querySelectorAll('[data-output]')) {
      const key = output.dataset.output;
      const value = current[key];
      const unit = ranges.find(item => item[0] === key)?.[5] || 's';
      output.value = key === 'opacity' ? `${Math.round(value * 100)}%` : key === 'offsetSec' ? `${value > 0 ? '+' : ''}${value.toFixed(1)}s` : `${Number(value.toFixed(1))} ${unit}`;
    }
    for (const button of root.querySelectorAll('[data-mode]')) {
      button.setAttribute('aria-pressed', String(button.dataset.mode === current.overflowMode));
    }
  }

  function patch(value, commit = false) {
    updateSettings({ ...current, ...value });
    onPreview?.(value);
    if (commit) onCommit?.(value);
  }
  const readInput = input => input.type === 'checkbox' ? input.checked : input.tagName === 'SELECT' ? input.value : Number(input.value);
  root.addEventListener('input', event => {
    if (event.target.dataset.key) patch({ [event.target.dataset.key]: readInput(event.target) });
  });
  root.addEventListener('change', event => {
    if (event.target.dataset.key) patch({ [event.target.dataset.key]: readInput(event.target) }, true);
    if (event.target.matches('[data-track]')) onAction?.('track', event.target.value);
  });
  root.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.tab) {
      for (const tab of root.querySelectorAll('[data-tab]')) tab.setAttribute('aria-selected', String(tab === button));
      for (const panel of root.querySelectorAll('[data-section]')) panel.hidden = panel.dataset.section !== button.dataset.tab;
    }
    if (button.dataset.mode) patch({ overflowMode: button.dataset.mode }, true);
    if (button.dataset.offset) patch({ offsetSec: Math.max(-3, Math.min(3, Math.round((current.offsetSec + Number(button.dataset.offset)) * 10) / 10)) }, true);
    if (button.dataset.action === 'reset') patch({ ...DEFAULTS }, true);
    else if (button.dataset.action) onAction?.(button.dataset.action);
  });
  function updateStatus(status) {
    const select = root.querySelector('[data-track]');
    const tracks = status.tracks || [];
    const signature = JSON.stringify(tracks);
    if (select.dataset.signature !== signature) {
      select.replaceChildren(...(tracks.length ? tracks.map(track => new Option(track.name, track.id)) : [new Option(status.imported ? '使用本地字幕' : '自动选择 AI 中文', '')]));
      select.dataset.signature = signature;
    }
    select.value = status.selected || '';
    select.disabled = !tracks.length || status.imported;
    root.querySelector('[data-action="restore"]').hidden = !status.imported;
  }
  updateSettings(current);
  return { updateSettings, updateStatus };
}
