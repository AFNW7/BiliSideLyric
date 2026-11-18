import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SIDELYRIC_PLAYWRIGHT_PATH || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'test-results');
await mkdir(output, { recursive: true });
const profile = await mkdtemp(join(tmpdir(), 'sidelyric-edge-'));
const fixture = await readFile(join(root, 'tests/fixtures/player.html'), 'utf8');
const edgePath = process.env.SIDELYRIC_BROWSER_PATH || join(process.env['ProgramFiles(x86)'] || 'C:/Program Files (x86)', 'Microsoft/Edge/Application/msedge.exe');
const results = [];
const errors = [];
const context = await chromium.launchPersistentContext(profile, {
  executablePath: edgePath, headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-first-run', '--disable-features=msEdgeSidebarV2']
});
const check = async (name, callback) => { await callback(); results.push(name); console.info(`PASS ${name}`); };
const cues = [
  { from: 0, to: 8, content: '第一句保持高亮八秒' },
  { from: 8, to: 18, content: '这是一条很长很长的字幕，需要从左到右完整地滑动显示，这样每一个字都可以被看见，继续写长直到超过播放器宽度' },
  { from: 18, to: 20, content: '短句不滑动' },
  ...Array.from({ length: 900 }, (_, index) => ({ from: 20 + index * 2, to: 21.8 + index * 2, content: `持续播放测试第 ${index + 1} 句` }))
];
let noTracks = false;
await context.route('https://www.bilibili.com/**', route => route.fulfill({ contentType: 'text/html', body: fixture }));
await context.route('https://api.bilibili.com/**', route => {
  const url = new URL(route.request().url());
  const cid = Number(url.searchParams.get('cid')) || 279786;
  const body = url.pathname.endsWith('/nav') ? { code: 0, data: { wbi_img: { img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png', sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png' } } } :
    url.pathname.includes('/season') ? { code: 0, result: { title: '番剧', episodes: [{ id: 12, aid: 170002, cid: 279788, bvid: 'BVtest', title: '2' }] } } :
      { code: 0, data: { subtitle: { subtitles: noTracks ? [] : [{ id: 1, lan: 'ai-zh', lan_doc: `AI 中文 · ${cid}`, subtitle_url: `//aisubtitle.hdslb.com/bfs/ai_subtitle/prod/${cid}?auth_key=1795000000-0-0-signature` }] } } };
  return route.fulfill({ json: body, headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' } });
});
await context.route('https://*.hdslb.com/**', route => route.fulfill({ json: { body: cues }, headers: { 'access-control-allow-origin': 'https://www.bilibili.com', 'access-control-allow-credentials': 'true' } }));
let page;
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
  const extension = `chrome-extension://${new URL(worker.url()).hostname}`;
  page = await context.newPage();
  const clockCDP = await context.newCDPSession(page);
  let worlds = [];
  clockCDP.on('Runtime.executionContextCreated', event => worlds.push(event.context));
  clockCDP.on('Runtime.executionContextsCleared', () => { worlds = []; });
  await clockCDP.send('Runtime.enable');
  const installClock = async () => {
    await page.locator('#sidelyric-root').waitFor({ state: 'attached' });
    const world = worlds.find(item => item.origin === extension);
    assert.ok(world, `isolated extension world exists: ${JSON.stringify(worlds.map(item => ({ name: item.name, origin: item.origin })))}`);
    await clockCDP.send('Runtime.evaluate', { contextId: world.id, expression: `Object.defineProperties(document.querySelector('video'), {
      currentTime: { get() { return Number(this.dataset.time || 1); } },
      videoWidth: { get() { return this.dataset.portrait === 'true' ? 1080 : 1920; } },
      videoHeight: { get() { return this.dataset.portrait === 'true' ? 1920 : 1080; } }
    })` });
  };
  const navigate = async url => { await page.goto(url); await installClock(); };
  const reload = async () => { await page.reload(); await installClock(); };
  page.on('pageerror', error => errors.push(error.message));
  await navigate('https://www.bilibili.com/video/BV17x411w7KC');
  const current = page.locator('#sidelyric-root .sl-line.is-current .sl-text');
  const getStatus = () => worker.evaluate(async () => {
    for (const tab of await chrome.tabs.query({})) {
      try { const status = await chrome.tabs.sendMessage(tab.id, { type: 'SL_GET_STATUS' }); if (status) return status; } catch {}
    }
  });
  const settings = patch => worker.evaluate(patch => chrome.storage.sync.set(patch), patch);
  await check('MV3 扩展加载、MAIN bridge 与 WBI 字幕链路', async () => {
    await current.waitFor({ state: 'visible', timeout: 20000 });
    assert.equal(await current.textContent(), cues[0].content);
    assert.equal((await getStatus()).count, cues.length);
    assert.equal((await getStatus()).source, 'AI 中文 · 279786');
  });
  await check('长句按时间单向推进、暂停停住、回退五秒等比恢复，短句不滑动', async () => {
    await page.evaluate(() => { window.__time = 7.8; });
    await page.waitForTimeout(80);
    assert.equal(await current.textContent(), cues[0].content);
    const position = () => current.evaluate(node => {
      const transform = getComputedStyle(node).transform;
      const shift = transform === 'none' ? 0 : new DOMMatrixReadOnly(transform).m41;
      return -shift / (node.scrollWidth - node.parentElement.clientWidth);
    });
    const at = async time => { await page.evaluate(time => { window.__time = time; }, time); await page.waitForTimeout(80); };
    await at(8);
    await page.locator('#sidelyric-root .is-current .sl-timed-scroll').waitFor();
    assert.ok(Math.abs(await position()) < 0.001);
    await at(16);
    assert.ok(Math.abs(await position() - 0.8) < 0.001);
    await at(11);
    assert.ok(Math.abs(await position() - 0.3) < 0.001);
    await page.waitForTimeout(350);
    assert.ok(Math.abs(await position() - 0.3) < 0.001);
    await at(16);
    assert.ok(Math.abs(await position() - 0.8) < 0.001);
    await settings({ offsetSec: 1 });
    await page.waitForTimeout(80);
    assert.ok(Math.abs(await position() - 0.9) < 0.001);
    await settings({ offsetSec: 0 });
    await at(19);
    await page.waitForTimeout(100);
    assert.equal(await current.textContent(), '短句不滑动');
    assert.equal(await current.evaluate(node => node.classList.contains('sl-timed-scroll')), false);
    assert.equal(await current.evaluate(node => getComputedStyle(node).transform), 'none');
  });
  await check('设置实时更新并持久化、三种长句模式', async () => {
    await page.evaluate(() => {
      window.__settingsAt = 0;
      const element = document.querySelector('#sidelyric-root').shadowRoot.querySelector('.sl-root');
      const observer = new MutationObserver(() => {
        if (element.style.getPropertyValue('--sl-font-size') === '22px') { window.__settingsAt = Date.now(); observer.disconnect(); }
      });
      observer.observe(element, { attributes: true, attributeFilter: ['style'] });
    });
    const changedAt = await worker.evaluate(async () => { const started = Date.now(); await chrome.storage.sync.set({ fontSize: 22 }); return started; });
    await page.waitForFunction(() => window.__settingsAt > 0);
    const latency = await page.evaluate(() => window.__settingsAt) - changedAt;
    assert.ok(latency < 100, `settings latency ${latency} ms`);
    results.push(`storage.onChanged 生效 ${latency} ms`);
    const popup = await context.newPage();
    await popup.setViewportSize({ width: 380, height: 600 });
    await popup.goto(`${extension}/src/popup/popup.html`);
    await popup.locator('[data-key="fontSize"]').fill('26');
    await popup.locator('[data-key="fontSize"]').dispatchEvent('change');
    await page.waitForFunction(() => document.querySelector('#sidelyric-root').shadowRoot.querySelector('.sl-root').style.getPropertyValue('--sl-font-size') === '26px');
    assert.equal((await getStatus()).settings.fontSize, 26);
    await popup.locator('[data-mode="wrap"]').click();
    await page.waitForFunction(() => document.querySelector('#sidelyric-root').shadowRoot.querySelector('.sl-root').dataset.mode === 'wrap');
    await popup.locator('[data-mode="clip"]').click();
    await page.waitForFunction(() => document.querySelector('#sidelyric-root').shadowRoot.querySelector('.sl-root').dataset.mode === 'clip');
    await popup.locator('[data-tab="more"]').click();
    await popup.locator('[data-key="placement"]').selectOption('right');
    await popup.locator('[data-key="textAlign"]').selectOption('center');
    await page.waitForFunction(() => {
      const root = document.querySelector('#sidelyric-root').shadowRoot.querySelector('.sl-root');
      return root.dataset.placement === 'right' && root.style.getPropertyValue('--sl-text-align') === 'center';
    });
    await popup.screenshot({ path: join(output, 'popup.png') });
    await popup.close();
    await reload();
    await current.waitFor();
    assert.equal((await getStatus()).settings.fontSize, 26);
    assert.equal((await getStatus()).settings.placement, 'right');
    assert.equal((await getStatus()).settings.textAlign, 'center');
    await settings({ fontSize: 20, overflowMode: 'scroll', placement: 'left', textAlign: 'left' });
  });
  await check('窗口高度自动条数、竖屏黑边、宽屏和网页全屏', async () => {
    const count = () => page.locator('#sidelyric-root .sl-line').count();
    await page.evaluate(() => { window.__time = 100; });
    await page.waitForTimeout(100);
    const before = await count();
    await page.evaluate(() => { document.querySelector('#bilibili-player').style.height = '310px'; });
    await page.waitForTimeout(100);
    assert.ok(await count() < before);
    await page.evaluate(() => { window.__portrait = true; const area = document.querySelector('#bilibili-player'); area.style.height = '576px'; area.style.width = '1200px'; });
    await page.waitForFunction(() => document.querySelector('#sidelyric-root').shadowRoot.querySelector('.sl-root').classList.contains('sl-in-bars'));
    await page.evaluate(() => { const area = document.querySelector('#bilibili-player'); area.classList.add('bpx-state-web'); area.style.cssText = 'position:fixed;inset:0;width:100vw;height:100vh;z-index:100'; });
    await page.waitForTimeout(100);
    assert.ok((await page.locator('#sidelyric-root').boundingBox()).width > 1400);
    await page.evaluate(() => { window.__portrait = false; const area = document.querySelector('#bilibili-player'); area.classList.remove('bpx-state-web'); area.style.cssText = ''; });
  });
  await check('原生全屏跟随，开启全屏隐藏选项后隐藏', async () => {
    await page.locator('#full').click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    assert.equal(await page.evaluate(() => document.fullscreenElement.contains(document.querySelector('#sidelyric-root'))), true);
    await settings({ hideInFullscreen: true });
    await page.waitForFunction(() => document.querySelector('#sidelyric-root').shadowRoot.querySelector('.sl-root').classList.contains('sl-suppressed'));
    await page.evaluate(() => document.exitFullscreen());
    await settings({ hideInFullscreen: false });
  });
  await check('多 P 与番剧切换，旧字幕不会串台', async () => {
    await page.evaluate(() => history.pushState({}, '', '?p=2'));
    await page.waitForFunction(() => document.querySelector('#sidelyric-root').shadowRoot.querySelector('.sl-panel-status').textContent.includes('279787'));
    await navigate('https://www.bilibili.com/bangumi/play/ep12');
    await current.waitFor();
    assert.equal((await getStatus()).source, 'AI 中文 · 279788');
  });
  await check('无字幕提示、DOM 实时兜底与 SRT 导入', async () => {
    noTracks = true;
    await navigate('https://www.bilibili.com/video/BV17x411w7KC');
    await page.locator('#sidelyric-root .sl-hint strong').filter({ hasText: '开启 AI 字幕' }).waitFor();
    await page.evaluate(() => { document.querySelector('.bpx-player-subtitle-panel-text').textContent = '播放器实时字幕'; });
    await current.filter({ hasText: '播放器实时字幕' }).waitFor();
    await page.locator('#sidelyric-root .sl-brand-button').click();
    const file = page.locator('#sidelyric-root .sl-file');
    await file.setInputFiles({ name: 'local.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:00,000 --> 00:00:10,000\n本地字幕导入成功\n') });
    await current.filter({ hasText: '本地字幕导入成功' }).waitFor();
    await reload();
    await current.filter({ hasText: '本地字幕导入成功' }).waitFor();
    noTracks = false;
    await worker.evaluate(() => chrome.storage.local.clear());
    await reload(); await current.waitFor();
  });
  await check('减少动态效果设置关闭过渡与滑动', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => { window.__time = 9; });
    await page.waitForTimeout(100);
    assert.equal(await current.evaluate(node => getComputedStyle(node).animationName), 'none');
    assert.equal(await current.evaluate(node => getComputedStyle(node).transform), 'none');
    assert.equal(await page.locator('#sidelyric-root .sl-track').evaluate(node => getComputedStyle(node).transitionDuration), '0s');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });
  await check('模拟 30 分钟时间轴推进，DOM 数量与回收后堆内存有界', async () => {
    const cdp = await context.newCDPSession(page);
    await cdp.send('HeapProfiler.collectGarbage');
    const before = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    const maximum = await page.evaluate(async () => {
      let maximum = 0;
      for (let index = 0; index < 900; index++) {
        window.__time = 20 + index * 2;
        await new Promise(requestAnimationFrame);
        maximum = Math.max(maximum, document.querySelector('#sidelyric-root').shadowRoot.querySelectorAll('.sl-line').length);
      }
      return maximum;
    });
    await cdp.send('HeapProfiler.collectGarbage');
    const after = (await cdp.send('Runtime.getHeapUsage')).usedSize;
    assert.ok(maximum <= 30, `maximum DOM lines ${maximum}`);
    assert.ok(after - before < 3 * 1024 * 1024, `heap growth ${after - before}`);
    results.push(`模拟长播：最多 ${maximum} 个歌词节点，回收后堆变化 ${Math.round((after - before) / 1024)} KB`);
  });
  await page.screenshot({ path: join(output, 'extension.png') });
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'smoke.json'), JSON.stringify({ browser: await context.browser().version(), results, errors, note: '接口响应使用测试夹具；30 分钟为时间轴模拟，不等同真实长时间播放。' }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(output, 'failure.png') });
    console.error(await page.locator('#sidelyric-root').evaluate(node => ({ current: node.shadowRoot.querySelector('.is-current')?.textContent, hint: node.shadowRoot.querySelector('.sl-hint')?.textContent })).catch(() => 'overlay missing'));
  }
  throw error;
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
