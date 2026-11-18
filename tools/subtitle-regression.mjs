import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SIDELYRIC_PLAYWRIGHT_PATH || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const extensionRoot = process.env.SIDELYRIC_EXTENSION_ROOT || root;
const profile = await mkdtemp(join(tmpdir(), 'sidelyric-subtitle-'));
const output = join(root, 'test-results');
await mkdir(output, { recursive: true });
const fixture = await readFile(join(root, 'tests/fixtures/player.html'), 'utf8');
const body = { body: [{ from: 0, to: 60, content: 'AI 字幕无后缀地址加载成功' }] };
const origin = 'https://www.bilibili.com';
const headers = { 'access-control-allow-origin': origin, 'access-control-allow-credentials': 'true' };
const signedURL = 'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1795000000abcdef?auth_key=1795000000-0-0-signature&sign=A%2FB%3D';
const context = await chromium.launchPersistentContext(profile, {
  channel: 'msedge', headless: true,
  args: [`--disable-extensions-except=${extensionRoot}`, `--load-extension=${extensionRoot}`, '--no-first-run']
});
const requests = [];
const results = [];
const errors = [];
let address = signedURL.replace('https:', '');
let blockPage = false;
await context.route(`${origin}/**`, route => route.fulfill({ contentType: 'text/html', body: fixture }));
await context.route('https://api.bilibili.com/**', route => route.fulfill({
  headers, json: route.request().url().includes('/nav') ? {
    code: 0, data: { wbi_img: {
      img_url: 'https://i0.hdslb.com/bfs/wbi/7cd084941338484aae1ad9425b84077c.png',
      sub_url: 'https://i0.hdslb.com/bfs/wbi/4932caff0ff746eab6f01bf08b70ac45.png'
    } }
  } : { code: 0, data: { subtitle: { subtitles: [{ id: 1, lan: 'ai-zh', lan_doc: 'AI 中文', subtitle_url: address }] } } }
}));
await context.route('https://*.hdslb.com/**', route => {
  const worker = !!route.request().serviceWorker();
  requests.push({ url: route.request().url(), worker });
  if (blockPage && !worker) return route.abort('failed');
  return route.fulfill({ headers, json: body });
});
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const current = page.locator('#sidelyric-root .is-current .sl-text');
  const status = () => worker.evaluate(async () => {
    for (const tab of await chrome.tabs.query({})) {
      try { const value = await chrome.tabs.sendMessage(tab.id, { type: 'SL_GET_STATUS' }); if (value) return value; } catch {}
    }
  });
  const check = async (name, callback) => { await callback(); results.push(name); console.info(`PASS ${name}`); };
  await check('无后缀、协议相对的 AI 字幕通过 MAIN world 获取，鉴权参数保持原样', async () => {
    await page.goto(`${origin}/video/BV17x411w7KC`);
    await current.waitFor({ state: 'visible' });
    assert.equal(await current.textContent(), body.body[0].content);
    assert.deepEqual(requests, [{ url: signedURL, worker: false }]);
    assert.equal((await status()).phase, 'ready');
  });
  await check('页面请求失败后，后台成功获取同一个无后缀字幕地址', async () => {
    requests.length = 0;
    blockPage = true;
    await page.reload();
    await current.waitFor({ state: 'visible' });
    assert.equal(await current.textContent(), body.body[0].content);
    assert.deepEqual(requests, [{ url: signedURL, worker: false }, { url: signedURL, worker: true }]);
  });
  await check('旧 HTTP 字幕地址自动升级为 HTTPS，不改变鉴权参数', async () => {
    requests.length = 0;
    blockPage = false;
    address = signedURL.replace('https:', 'http:');
    await page.reload();
    await current.waitFor({ state: 'visible' });
    assert.deepEqual(requests, [{ url: signedURL, worker: false }]);
  });
  await check('带 JSON 后缀的旧字幕地址继续兼容', async () => {
    requests.length = 0;
    address = signedURL.replace('/ai_subtitle/prod/1795000000abcdef', '/subtitle/old.json');
    await page.reload();
    await current.waitFor({ state: 'visible' });
    assert.deepEqual(requests, [{ url: address, worker: false }]);
  });
  await check('不支持的地址明确提示读取失败，停止无效自动重试', async () => {
    requests.length = 0;
    address = 'https://invalid.example/subtitle';
    await page.reload();
    await page.locator('#sidelyric-root .sl-hint strong').filter({ hasText: '已找到字幕，但读取失败' }).waitFor();
    const state = await status();
    assert.equal(state.phase, 'error');
    assert.ok(!state.detail.includes('自动重试'));
    assert.equal(requests.length, 0);
  });
  assert.deepEqual(errors, []);
  await writeFile(join(output, 'subtitle-regression.json'), JSON.stringify({
    version: await worker.evaluate(() => chrome.runtime.getManifest().version),
    browser: context.browser().version(), results, errors,
    note: '真实 Edge 扩展，字幕接口使用无后缀地址夹具；包含强制页面请求失败后的真实 service worker 网络请求。'
  }, null, 2));
} finally {
  await context.close();
  await rm(profile, { recursive: true, force: true, maxRetries: 3 });
}
