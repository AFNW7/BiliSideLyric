import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const { chromium } = createRequire(import.meta.url)(process.env.SIDELYRIC_PLAYWRIGHT_PATH || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const extension = process.env.SIDELYRIC_EXTENSION_ROOT || root;
const profile = await mkdtemp(join(tmpdir(), 'sidelyric-provenance-'));
const output = join(root, 'test-results');
await mkdir(output, { recursive: true });
const fixture = await readFile(join(root, 'tests/fixtures/player.html'), 'utf8');
const origin = 'https://www.bilibili.com';
const headers = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' };
let mode = 'none';
const downloads = [];
const results = [];
const errors = [];
const context = await chromium.launchPersistentContext(profile, {
  channel: 'msedge', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run']
});
await context.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: fixture }));
await context.route('https://api.bilibili.com/**', route => {
  const url = new URL(route.request().url());
  if (url.pathname.endsWith('/nav')) return route.fulfill({ headers, json: { code: 0, data: { wbi_img: {
    img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
    sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'
  } } } });
  const cid = Number(url.searchParams.get('cid')) || 279786;
  const wrong = mode === 'wrong' || mode === 'fallback' && url.pathname.includes('/wbi/');
  const data = { aid: 170001, cid: wrong ? 999999 : cid, bvid: 'BV17x411w7KC', subtitle: { subtitles: mode === 'none' ? [] : [
    { id: 1, lan: 'ai-zh', lan_doc: 'AI 中文', subtitle_url: `https://aisubtitle.hdslb.com/${wrong ? 'wrong' : cid}` }
  ] } };
  if (mode === 'missing') delete data.cid;
  return route.fulfill({ headers, json: { code: 0, data } });
});
await context.route('https://*.hdslb.com/**', route => {
  downloads.push(route.request().url());
  return route.fulfill({ headers, json: { body: [{ from: 0, to: 60, content: '当前视频的真实字幕' }] } });
});
let page;
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const current = page.locator('#sidelyric-root .is-current .sl-text');
  const notice = page.locator('#sidelyric-notice');
  const hint = notice.locator('.sl-hint strong');
  const status = () => worker.evaluate(async () => {
    for (const tab of await chrome.tabs.query({})) {
      try { const response = await chrome.tabs.sendMessage(tab.id, { type: 'SL_GET_STATUS' }); if (response) return response; } catch {}
    }
  });
  const check = async (name, action) => { await action(); results.push(name); console.info(`PASS ${name}`); };
  await page.goto(`${origin}/video/BV17x411w7KC`);
  await hint.filter({ hasText: '开启 AI 字幕' }).waitFor();

  await check('无字幕提示及操作位于播放器下方，画面内没有提示节点', async () => {
    const playerBox = await page.locator('#bilibili-player').boundingBox();
    const noticeBox = await notice.boundingBox();
    assert.ok(noticeBox.y >= playerBox.y + playerBox.height);
    assert.equal(await page.locator('#sidelyric-root .sl-hint').count(), 0);
    assert.equal(await page.evaluate(() => document.querySelector('#bilibili-player').contains(document.querySelector('#sidelyric-notice'))), false);
    await page.screenshot({ path: join(output, 'outside-player-notice.png') });
  });
  await check('无字幕持续重试期间，不自动套用预览文字、其他播放器文字', async () => {
    await page.evaluate(() => {
      document.querySelector('.bpx-player-subtitle-panel-text').textContent = '未开启字幕时的残留示例';
      const other = document.createElement('div');
      other.innerHTML = '<div class="bpx-player-subtitle-panel-text">页面其他播放器的文字</div>';
      document.body.prepend(other);
    });
    await page.waitForTimeout(6200);
    assert.equal((await status()).count, 0);
    assert.equal(await current.count(), 0);
    assert.equal(downloads.length, 0);
  });
  await check('原生和网页全屏均隐藏外部提示，退出后恢复', async () => {
    await page.locator('#full').click();
    await page.waitForFunction(() => !!document.fullscreenElement);
    await notice.waitFor({ state: 'hidden' });
    await page.evaluate(() => document.exitFullscreen());
    await notice.waitFor({ state: 'visible' });
    await page.evaluate(() => document.querySelector('#bilibili-player').classList.add('bpx-state-web'));
    await notice.waitFor({ state: 'hidden' });
    await page.evaluate(() => document.querySelector('#bilibili-player').classList.remove('bpx-state-web'));
    await notice.waitFor({ state: 'visible' });
  });
  await check('明确开启采集后，忽略透明字幕，仅采集当前播放器的可见字幕', async () => {
    await page.evaluate(() => { document.querySelector('#bilibili-player .bpx-player-subtitle-panel-text').style.opacity = '0'; });
    await notice.locator('[data-action="capture"]').click();
    await page.waitForTimeout(1200);
    assert.equal((await status()).count, 0);
    await page.evaluate(() => {
      const native = document.querySelector('#bilibili-player .bpx-player-subtitle-panel-text');
      native.style.opacity = '1'; native.textContent = '当前播放器已开启的字幕';
    });
    await current.filter({ hasText: '当前播放器已开启的字幕' }).waitFor();
    assert.equal((await status()).source, '实时采集');
    await notice.waitFor({ state: 'hidden' });
  });
  await check('切换分 P 后取消采集授权，不继承上一视频的 DOM 字幕', async () => {
    await page.evaluate(() => history.pushState({}, '', '?p=2'));
    await notice.waitFor({ state: 'visible' });
    await hint.filter({ hasText: '开启 AI 字幕' }).waitFor();
    assert.equal((await status()).count, 0);
    assert.equal(await current.count(), 0);
  });
  await check('拒绝其他 cid 和缺失 cid 的字幕列表，不请求其字幕正文', async () => {
    for (const value of ['wrong', 'missing']) {
      mode = value;
      await page.reload();
      await hint.filter({ hasText: '开启 AI 字幕' }).waitFor();
      assert.equal((await status()).count, 0);
      assert.equal(downloads.length, 0);
    }
  });
  await check('主接口错片时只接受经验证的备用接口，外部重试按钮正常工作', async () => {
    mode = 'fallback';
    await notice.locator('[data-action="retry"]').click();
    await current.filter({ hasText: '当前视频的真实字幕' }).waitFor();
    assert.equal((await status()).phase, 'ready');
    assert.ok(downloads.every(url => !url.endsWith('/wrong')));
    await notice.waitFor({ state: 'hidden' });
  });
  await check('推荐卡片的 cid 不影响当前视频绑定', async () => {
    await page.evaluate(() => {
      const recommendation = document.createElement('div');
      recommendation.id = 'recommendation'; recommendation.setAttribute('data-cid', '111');
      document.body.prepend(recommendation);
    });
    const count = downloads.length;
    await page.waitForTimeout(1300);
    await page.evaluate(() => document.querySelector('#recommendation').setAttribute('data-cid', '222'));
    await page.waitForTimeout(1300);
    assert.equal(downloads.length, count);
    assert.equal((await status()).phase, 'ready');
  });
  await check('外部导入按钮工作，手动字幕仍可按当前视频恢复', async () => {
    mode = 'none';
    await page.reload();
    await hint.filter({ hasText: '开启 AI 字幕' }).waitFor();
    const chooser = page.waitForEvent('filechooser');
    await notice.locator('[data-action="import"]').click();
    await (await chooser).setFiles({ name: 'local.srt', mimeType: 'text/plain', buffer: Buffer.from('1\n00:00:00,000 --> 00:01:00,000\n用户主动导入的字幕\n') });
    await current.filter({ hasText: '用户主动导入的字幕' }).waitFor();
    await page.reload();
    await current.filter({ hasText: '用户主动导入的字幕' }).waitFor();
  });
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'provenance-regression.json'), JSON.stringify({
    version: await worker.evaluate(() => chrome.runtime.getManifest().version),
    browser: context.browser().version(), results, errors,
    note: '真实 Edge MV3 扩展；可控接口和页面夹具验证来源隔离、外部提示、全屏及导入操作。'
  }, null, 2));
} catch (error) {
  if (page && !page.isClosed()) await page.screenshot({ path: join(output, 'provenance-failure.png') });
  throw error;
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
