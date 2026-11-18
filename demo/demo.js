import { Renderer } from '../src/content/renderer.js';
import { DEFAULTS, normalizeSettings } from '../src/shared/settings.js';
import { createSettingsView } from '../src/shared/settings-view.js';
import { parseSubtitle } from '../src/content/importers.js';

const sample = [
  [0, 7, '我们总在追赶下一站'],
  [7, 14, '偶尔，也让时间慢一点'],
  [14, 22, '听风经过，听见此刻的自己'],
  [22, 29, '远山不语，日光落在水面'],
  [29, 43, '不必急着抵达远方，生活里那些缓慢而细小的美好，也值得我们停下来，认真地看一看'],
  [43, 51, '把忙碌，暂时放在身后'],
  [51, 59, '给心情，留一小片空白'],
  [59, 65, '每一次呼吸，都算数'],
  [65, 72, '这一刻，就很好']
].map(([from, to, content]) => ({ from, to, content }));
let settings;
try { settings = normalizeSettings(JSON.parse(localStorage.getItem('sidelyric-demo') || '{}')); }
catch { settings = { ...DEFAULTS }; }
let time = 18;
let playing = true;
let previous = performance.now();
let view;
const preview = patch => {
  settings = normalizeSettings({ ...settings, ...patch });
  renderer.updateSettings(settings);
  view?.updateSettings(settings);
};
const commit = () => localStorage.setItem('sidelyric-demo', JSON.stringify(settings));
const action = async (name, file) => {
  if (name === 'toggle') { preview({ enabled: !settings.enabled }); commit(); }
  if (name === 'import') document.querySelector('#import-file').click();
  if (name === 'retry' || name === 'restore') renderer.setTimeline(sample);
  if (name === 'import-file' && file) {
    try { renderer.setTimeline(parseSubtitle(await file.text(), file.name)); time = 0; }
    catch (error) { renderer.updateStatus({ phase: 'error', message: error.message, tracks: [] }); }
  }
};
const renderer = new Renderer(settings, { onPreview: preview, onCommit: commit, onAction: action });
renderer.attach(document.querySelector('video'));
renderer.setTimeline(sample);
renderer.updateStatus({ phase: 'ready', message: '演示字幕已就绪', source: '内置示例', count: sample.length, tracks: [] });
view = createSettingsView(document.querySelector('#settings'), { settings, onPreview: preview, onCommit: commit, onAction: action });
view.updateStatus({ tracks: [], selected: '' });
document.querySelector('#play').addEventListener('click', () => {
  playing = !playing;
  document.querySelector('#play').textContent = playing ? 'Ⅱ' : '▶';
  document.querySelector('#play').setAttribute('aria-label', playing ? '暂停演示' : '播放演示');
});
document.querySelector('#seek').addEventListener('input', event => { time = Number(event.target.value); renderer.render(time, true); });
document.querySelector('#long-demo').addEventListener('click', () => { time = 30; renderer.render(time, true); });
document.querySelector('#fullscreen').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.querySelector('#player').requestFullscreen();
});
document.querySelector('#player').addEventListener('pointermove', () => renderer.poke(), { passive: true });
document.querySelector('#import-file').addEventListener('change', event => action('import-file', event.target.files[0]));
document.addEventListener('fullscreenchange', () => renderer.attach(document.querySelector('video')));
function tick(now) {
  if (playing && !document.hidden) time = (time + Math.min((now - previous) / 1000, 0.1)) % 72;
  previous = now;
  renderer.render(time);
  document.querySelector('#seek').value = time;
  document.querySelector('#clock').textContent = `${Math.floor(time / 60).toString().padStart(2, '0')}:${Math.floor(time % 60).toString().padStart(2, '0')}`;
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
