import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SIDELYRIC_PLAYWRIGHT_PATH || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const profile = await mkdtemp(join(tmpdir(), 'sidelyric-live-'));
const context = await chromium.launchPersistentContext(profile, {
  channel: 'msedge', headless: true, viewport: { width: 1440, height: 1000 },
  args: [`--disable-extensions-except=${root}`, `--load-extension=${root}`, '--no-first-run']
});
const reports = [];
try {
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => { if (/sidelyric|chrome-extension/i.test(error.stack || '')) errors.push(error.message); });
  const videos = ['https://www.bilibili.com/video/BV1qCs26dEdE/', 'https://www.bilibili.com/video/BV1GJ411x7h7', 'https://www.bilibili.com/video/BV17x411w7KC'];
  for (const url of videos) {
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await page.waitForTimeout(10000);
      const status = await worker.evaluate(async () => {
        for (const tab of await chrome.tabs.query({})) {
          try { const response = await chrome.tabs.sendMessage(tab.id, { type: 'SL_GET_STATUS' }); if (response) return response; } catch {}
        }
        return null;
      });
      const notice = await page.evaluate(() => {
        const host = document.querySelector('#sidelyric-notice');
        const player = document.querySelector('#bilibili-player');
        const bounds = host?.getBoundingClientRect();
        return {
          visible: !!host?.checkVisibility(),
          insidePlayer: !!player?.contains(host),
          top: bounds?.top, playerBottom: player?.getBoundingClientRect().bottom,
          overlayHint: !!document.querySelector('#sidelyric-root')?.shadowRoot.querySelector('.sl-hint')
        };
      });
      reports.push({ url, title: await page.title(), status, notice, extensionErrors: [...errors] });
      await page.screenshot({ path: join(root, 'test-results', `live-${reports.length}.png`) });
    } catch (error) { reports.push({ url, error: error.message }); }
    console.info(JSON.stringify(reports.at(-1)));
  }
  await writeFile(join(root, 'test-results/live.json'), JSON.stringify({ note: '独立测试配置，不使用用户的 B 站账号或 Cookie', reports }, null, 2));
} finally { await context.close(); await rm(profile, { recursive: true, force: true, maxRetries: 3 }); }
