import { Renderer } from '../src/content/renderer.js';
import { DEFAULTS, normalizeSettings } from '../src/shared/settings.js';
import { createSettingsView } from '../src/shared/settings-view.js';
import { cueProgress } from '../src/content/timeline.js';

const script = await (await fetch('storyboard.json')).json();
const stage = document.querySelector('.stage');
const product = document.querySelector('.product');
const slides = [...document.querySelectorAll('.slide')];
const timeline = document.querySelector('#timeline');
const exported = new URL(location.href).searchParams.has('export');
document.body.classList.toggle('export', exported);
const source = new DOMParser().parseFromString(await (await fetch('../demo/index.html')).text(), 'text/html');
document.querySelector('.landscape-mount').append(document.importNode(source.querySelector('.landscape'), true));
const cues = [
  [0, 3, '让画面继续，让思绪慢下来'], [3, 6, '偶尔，也让时间慢一点'],
  [6, 10, '听风经过，听见此刻的自己'], [10, 14, '远山不语，日光落在水面'],
  [14, 20, '每一句，都有自己的位置'],
  [20, 34, '不必急着抵达远方，生活里那些缓慢而细小的美好，也值得我们停下来，认真地看一看'],
  [34, 40, '把忙碌，暂时放在身后'], [40, 47, '给心情，留一小片空白'],
  [47, 54, '每一次呼吸，都算数'], [54, 60, '这一刻，就很好']
].map(([from, to, content]) => ({ from, to, content }));
let settings = normalizeSettings({ ...DEFAULTS, fontSize: 28, maxWidthPct: 39, contextLines: 4, leftPadding: 45 });
const renderer = new Renderer(settings, { onPreview: () => {}, onCommit: () => {}, onAction: () => {} });
renderer.attach(document.querySelector('video'));
renderer.setTimeline(cues);
renderer.updateStatus({ phase: 'ready', source: '内置示例', count: cues.length, tracks: [] });
const deterministic = document.createElement('style');
deterministic.textContent = '* { transition: none !important; } .sl-toolbar, .sl-hint { display: none !important; }';
renderer.shadow.append(deterministic);
const settingsView = createSettingsView(document.querySelector('#film-settings'), { settings });
const animations = slides.map(slide => [...slide.querySelectorAll('.anim')].map((element, index) => {
  const animation = element.animate([
    { opacity: 0, transform: 'translateY(46px)' }, { opacity: 1, transform: 'translateY(0)' }
  ], { duration: 720, delay: index * 120, fill: 'both', easing: 'cubic-bezier(.2,.7,.25,1)' });
  animation.pause();
  return animation;
}));
const productAnimation = product.animate([
  { opacity: 0, transform: 'translateY(35px) scale(.985)' },
  { opacity: 1, transform: 'translateY(0) scale(1)' }
], { duration: 700, fill: 'both', easing: 'cubic-bezier(.2,.7,.25,1)' });
productAnimation.pause();
let currentTime = 0;
let sceneIndex = -1;
let playing = !exported;
let previous = performance.now();
const clamp = value => Math.max(0, Math.min(1, value));
const clock = time => `${Math.floor(time / 60).toString().padStart(2, '0')}:${Math.floor(time % 60).toString().padStart(2, '0')}`;
timeline.max = script.duration - .01;
for (const [index, scene] of script.scenes.entries()) {
  const dot = document.createElement('button');
  dot.setAttribute('aria-label', `${index + 1}：${scene.name}`);
  dot.addEventListener('click', () => seek(scene.start));
  document.querySelector('.dots').append(dot);
}
function updateSettings(next) {
  if (JSON.stringify(next) === JSON.stringify(settings)) return;
  settings = next;
  renderer.updateSettings(settings);
  settingsView.updateSettings(settings);
}

/** 分镜完全由秒数驱动，浏览器预览与逐帧导出使用同一个时间轴。 */
function seek(time) {
  currentTime = Math.max(0, Math.min(script.duration - 0.001, time));
  const index = script.scenes.findIndex(scene => currentTime >= scene.start && currentTime < scene.end);
  const scene = script.scenes[index];
  const local = currentTime - scene.start;
  if (index !== sceneIndex) {
    slides.forEach((slide, position) => slide.classList.toggle('active', position === index));
    document.querySelectorAll('.dots button').forEach((dot, position) => dot.classList.toggle('active', position === index));
    stage.classList.toggle('settings-scene', index === 6);
    product.classList.toggle('visible', index >= 2 && index <= 6);
    renderer.layout();
    sceneIndex = index;
  }
  animations[index].forEach(animation => { animation.currentTime = local * 1000; });
  productAnimation.currentTime = local * 1000;
  const placement = index === 5 && local >= .9 ? 'right' : 'left';
  const textAlign = index === 5 ? local >= 2.8 ? 'right' : local >= 1.8 ? 'center' : 'left' : 'left';
  const fontSize = index === 6 ? 28 + Math.min(8, Math.floor(local * 4)) : 28;
  updateSettings(normalizeSettings({ ...settings, placement, textAlign, fontSize, opacity: index === 6 && local >= 1.7 ? 0.7 : 0.95 }));
  let videoTime = 1 + local * 3.2;
  if (index === 3) videoTime = 20 + (Math.min(local, 1.4) + Math.max(0, local - 2.2)) * 3.4;
  if (index === 4) videoTime = local < 1 ? 30 + local : local < 1.6 ? 26 : 26 + (local - 1.6) * 1.8;
  if (index === 5 || index === 6) videoTime = 8;
  renderer.render(videoTime);
  const cue = cues[renderer.index];
  if (index === 2 && cue && renderer.index > 0 && videoTime < cue.from + 0.32) {
    const phase = clamp((videoTime - cue.from) / 0.32);
    const smooth = 1 - (1 - phase) ** 3;
    renderer.ui.track.style.transform = `translateY(${-(renderer.index - 1 + smooth) * renderer.rowHeight}px)`;
  }
  stage.style.setProperty('--play-progress', `${videoTime / 60 * 100}%`);
  stage.style.setProperty('--progress', `${currentTime / script.duration * 100}%`);
  document.querySelector('#film-clock').textContent = clock(videoTime);
  document.querySelector('.time-label').textContent = `${clock(currentTime)} / ${clock(script.duration)}`;
  document.querySelector('.narration-caption').textContent = local >= .25 && local < scene.end - scene.start - .2 ? scene.narration : '';
  document.querySelector('.rewind-tag').style.opacity = index === 4 && local >= 1 && local < 2.1 ? '1' : '0';
  const paused = index === 3 && local >= 1.4 && local < 2.2 || index === 4 && local >= 1 && local < 1.6;
  document.querySelector('.film-controls > span:first-child').textContent = paused ? '▶' : 'Ⅱ';
  document.querySelector('.alignment-pill').textContent = `${placement === 'right' ? '靠右' : '靠左'} · ${{ left: '左对齐', center: '居中对齐', right: '右对齐' }[textAlign]}`;
  document.querySelector('.cover-icon').style.transform = `translateY(${Math.sin(local * 0.7) * 12}px) rotate(${-10 + local * 1.2}deg)`;
  timeline.value = currentTime;
  document.querySelector('#counter').textContent = `${index + 1} / ${script.scenes.length}`;
  return { scene: index, time: currentTime, videoTime, progress: cueProgress(cues, renderer.index, videoTime) };
}
function resize() {
  document.documentElement.style.setProperty('--film-scale', Math.min(innerWidth / 1920, innerHeight / 1080));
  renderer.layout();
}
window.addEventListener('resize', resize);
document.querySelector('#play').addEventListener('click', () => {
  playing = !playing;
  document.querySelector('#play').textContent = playing ? '暂停' : '播放';
});
document.querySelector('#restart').addEventListener('click', () => { seek(0); playing = true; document.querySelector('#play').textContent = '暂停'; });
timeline.addEventListener('input', event => { playing = false; seek(Number(event.target.value)); document.querySelector('#play').textContent = '播放'; });
document.addEventListener('keydown', event => {
  if (event.target.matches('input')) return;
  if (event.key === 'ArrowRight') seek(script.scenes[sceneIndex + 1]?.start ?? script.duration - .01);
  if (event.key === 'ArrowLeft') seek(script.scenes[Math.max(0, sceneIndex - 1)].start);
  if (event.code === 'Space') { event.preventDefault(); document.querySelector('#play').click(); }
});
window.film = { duration: script.duration, seek, render: async time => {
  const state = seek(time);
  await new Promise(requestAnimationFrame);
  await new Promise(requestAnimationFrame);
  return state;
} };
resize();
seek(0);
await document.fonts.ready;
await new Promise(resolve => setTimeout(resolve, 100));
renderer.layout();
window.film.ready = true;
function tick(now) {
  if (playing) { seek(Math.min(currentTime + (now - previous) / 1000, script.duration - 0.001)); if (currentTime >= script.duration - 0.001) playing = false; }
  previous = now;
  requestAnimationFrame(tick);
}
if (!exported) requestAnimationFrame(tick);
