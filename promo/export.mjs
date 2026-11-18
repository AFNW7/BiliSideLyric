import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SIDELYRIC_PLAYWRIGHT_PATH || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = fileURLToPath(new URL('.', import.meta.url));
const output = join(directory, 'output');
const story = JSON.parse(await readFile(join(directory, 'storyboard.json'), 'utf8'));
const previewOnly = process.argv.includes('--stills');
const base = process.env.SIDELYRIC_PREVIEW_URL || 'http://127.0.0.1:4173';
await mkdir(output, { recursive: true });
let server;
try { await fetch(`${base}/promo/index.html`); }
catch {
  server = spawn(process.execPath, ['tools/serve.mjs'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
  await once(server.stdout, 'data');
}
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: story.width, height: story.height }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
let encoder;
try {
  await page.goto(`${base}/promo/index.html?export`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.film?.ready);
  const render = time => page.evaluate(time => window.film.render(time), time);
  const pauseStart = await render(story.scenes[3].start + 1.5);
  const pauseEnd = await render(story.scenes[3].start + 2.1);
  assert.equal(pauseStart.videoTime, pauseEnd.videoTime, '暂停时长句位置应保持不变');
  assert((await render(story.scenes[3].start + 3)).videoTime > pauseEnd.videoTime, '继续播放应向前推进');
  const beforeRewind = await render(story.scenes[4].start + .999);
  const afterRewind = await render(story.scenes[4].start + 1);
  assert(Math.abs(beforeRewind.videoTime - afterRewind.videoTime - 5) < .01, '回退演示应准确后退五秒');
  const frames = [];
  for (const [index, scene] of story.scenes.entries()) {
    const time = scene.start + Math.min(3.3, (scene.end - scene.start) / 2);
    const state = await page.evaluate(time => window.film.render(time), time);
    assert.equal(await page.locator('.slide.active').count(), 1);
    assert.equal(await page.locator('#sidelyric-root').isVisible(), index >= 2 && index <= 6);
    const path = join(output, `scene-${String(index + 1).padStart(2, '0')}.jpg`);
    await page.screenshot({ path, type: 'jpeg', quality: 92 });
    frames.push({ name: scene.name, time, path, ...state });
  }
  await page.evaluate(time => window.film.render(time), story.scenes[2].start + 2);
  await page.screenshot({ path: join(directory, 'poster.jpg'), type: 'jpeg', quality: 94 });
  const stamp = value => {
    const seconds = Math.floor(value);
    return `00:${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')},${Math.round((value - seconds) * 1000).toString().padStart(3, '0')}`;
  };
  const subtitles = story.scenes.map((scene, index) => `${index + 1}\n${stamp(scene.start + .25)} --> ${stamp(scene.end - .2)}\n${scene.narration}\n`).join('\n');
  await writeFile(join(directory, 'captions.srt'), subtitles);
  if (errors.length) throw new Error(errors.join('\n'));
  if (previewOnly) {
    await writeFile(join(output, 'preview-check.json'), JSON.stringify({ frames, errors }, null, 2));
    console.info(`Eight scene previews and poster exported: ${output}`);
  } else {
    const ffmpeg = process.env.SIDELYRIC_FFMPEG_PATH || spawnSync('python', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())'], { encoding: 'utf8' }).stdout.trim();
    if (!ffmpeg) throw new Error('设置 SIDELYRIC_FFMPEG_PATH，或安装 Python imageio-ffmpeg');
    const video = join(output, 'SideLyric-promo-fish-28s-1080p.mp4');
    const diagnostics = [];
    encoder = spawn(ffmpeg, [
      '-hide_banner', '-loglevel', 'warning', '-y', '-f', 'image2pipe', '-vcodec', 'mjpeg',
      '-framerate', String(story.fps), '-i', 'pipe:0', '-i', join(output, 'soundtrack.wav'),
      '-map', '0:v:0', '-map', '1:a:0', '-c:v', 'libx264', '-preset', 'fast', '-crf', '20',
      '-vf', 'scale=in_range=full:out_range=tv:out_color_matrix=bt709', '-pix_fmt', 'yuv420p',
      '-color_range', 'tv', '-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709',
      '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-t', String(story.duration), '-movflags', '+faststart', video
    ], { windowsHide: true, stdio: ['pipe', 'ignore', 'pipe'] });
    encoder.stderr.on('data', chunk => diagnostics.push(chunk.toString()));
    const completion = once(encoder, 'close');
    const count = story.duration * story.fps;
    for (let index = 0; index < count; index++) {
      await page.evaluate(time => window.film.render(time), index / story.fps);
      const frame = await page.screenshot({ type: 'jpeg', quality: 90 });
      if (!encoder.stdin.write(frame)) await once(encoder.stdin, 'drain');
      if (index % (story.fps * 2) === 0) console.info(`Rendered ${(index / story.fps).toFixed(0)} / ${story.duration}s`);
    }
    encoder.stdin.end();
    const [code] = await completion;
    if (code !== 0) throw new Error(diagnostics.join(''));
    if (errors.length) throw new Error(errors.join('\n'));
    await writeFile(join(output, 'render-report.json'), JSON.stringify({
      title: story.title, duration: story.duration, resolution: `${story.width}x${story.height}`, fps: story.fps,
      frames: count, video, errors, note: '产品演示使用真实 Renderer 和内置示例字幕；原创合成配乐，bibibobo 大肥鱼 fish 声线，28 秒精简版。'
    }, null, 2));
    console.info(`Exported ${video}`);
  }
} finally {
  if (encoder && encoder.exitCode === null) encoder.kill();
  await browser.close();
  if (server) server.kill();
}
