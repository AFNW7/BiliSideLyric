import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const { chromium } = createRequire(import.meta.url)(process.env.SIDELYRIC_PLAYWRIGHT_PATH || 'playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const extension = process.env.SIDELYRIC_EXTENSION_ROOT || root;
const output = join(root, 'test-results');
const urls = process.argv.slice(2);
if (!urls.length) urls.push('https://www.bilibili.com/video/BV1qCs26dEdE/', 'https://www.bilibili.com/video/BV1GnVv6XEL4/', 'https://www.bilibili.com/video/BV1mh411Y75c/');
const reports = [];
await mkdir(output, { recursive: true });
try {
  for (const enabled of [false, true]) {
    const profile = await mkdtemp(join(tmpdir(), 'sidelyric-comments-'));
    const context = await chromium.launchPersistentContext(profile, {
      channel: 'msedge', headless: true, viewport: { width: 1440, height: 1000 },
      args: enabled ? [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`, '--no-first-run'] : ['--disable-extensions', '--no-first-run']
    });
    try {
      for (const url of urls) {
        const page = await context.newPage();
        const errors = [], replies = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('response', async response => {
          if (!response.url().includes('/reply/wbi/main')) return;
          try { const json = await response.json(); replies.push({ code: json.code, count: json.data?.replies?.length || 0 }); } catch {}
        });
        try {
          await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.locator('video').waitFor({ state: 'attached' });
          await page.locator('video').evaluate(video => video.pause());
          await page.locator('bili-comments').waitFor({ state: 'attached', timeout: 20000 });
          await page.locator('bili-comments').scrollIntoViewIfNeeded();
          await page.locator('bili-comment-thread-renderer').first().waitFor({ timeout: 20000 });
          const count = await page.locator('bili-comment-thread-renderer').count();
          assert.ok(count > 0, 'actual comment threads render');
          assert.ok(replies.some(reply => reply.code === 0 && reply.count > 0), 'reply API succeeds');
          await page.locator('.recommend-list-v1 .pic img, .recommend-list .pic img').first().scrollIntoViewIfNeeded();
          await page.waitForFunction(() => [...document.querySelectorAll('.recommend-list-v1 .pic img, .recommend-list .pic img')].some(img => img.complete && img.naturalWidth > 0), null, { timeout: 15000 });
          const recommendations = await page.locator('.recommend-list-v1 .pic img, .recommend-list .pic img').evaluateAll(imgs => imgs.filter(img => img.complete && img.naturalWidth > 0).length);
          await page.evaluate(() => scrollTo(0, 0));
          if (enabled) assert.equal(await page.locator('#sidelyric-notice').evaluate(node => node.parentNode === document.body), true);
          let series;
          if (await page.locator('.video-pod__list.section').count()) series = await checkSeries(page);
          const autoplay = url.includes('BV1mh411Y75c') ? await checkAutoplay(page) : undefined;
          assert.deepEqual(errors.filter(error => /HierarchyRequestError|appendChild|insertBefore|chrome-extension|sidelyric/i.test(error)), []);
          reports.push({ enabled, url, comments: count, loadedRecommendations: recommendations, series, autoplay, replies, errors });
          await page.locator('bili-comments').scrollIntoViewIfNeeded();
          await page.screenshot({ path: join(output, `comments-${enabled ? 'on' : 'off'}-${reports.length}.png`) });
          console.info(`PASS extension=${enabled}: ${count} comments, ${recommendations} recommendation covers${series ? ', collection + previous/next' : ''}${autoplay ? ', automatic p=1 → p=2' : ''}; ${url}`);
        } catch (error) {
          reports.push({ enabled, url, errors, replies, failure: error.message });
          await page.screenshot({ path: join(output, 'comments-failure.png') });
          throw error;
        } finally { await page.close(); }
      }
    } finally {
      await context.close();
      await rm(profile, { recursive: true, force: true, maxRetries: 3 });
    }
  }
} finally {
  await writeFile(join(output, 'comments-regression.json'), JSON.stringify({
    note: '真实 B 站页面与独立未登录 Edge，分别关闭及加载扩展；检查评论接口、评论 DOM、推荐封面及页面初始化异常。依赖网络与站点可用性。', reports
  }, null, 2));
}

async function checkSeries(page) {
  const target = 'BV1wDtT68EcS';
  const episodes = await page.evaluate(() => window.__INITIAL_STATE__.videoData.ugc_season.sections.flatMap(section => section.episodes).map(item => item.bvid));
  const next = episodes[episodes.indexOf(target) + 1];
  assert.ok(target && next, 'series contains selectable adjacent episodes');
  const waitPlayer = async bvid => {
    await page.waitForURL(url => url.pathname.includes(bvid), { timeout: 20000 });
    await page.waitForFunction(bvid => window.player?.getManifest?.()?.bvid === bvid, bvid, { timeout: 20000 });
    await page.waitForFunction(() => { const video = document.querySelector('video'); return video && Number.isFinite(video.duration) && video.duration > 1 && video.readyState >= 2; });
    await page.locator('video').evaluate(video => video.pause());
    await page.locator('#bilibili-player').hover();
  };
  await page.locator(`.pod-item[data-key="${target}"]`).click();
  await waitPlayer(target);
  await page.locator('.bpx-player-ctrl-next').click();
  await waitPlayer(next);
  await page.locator('.bpx-player-ctrl-prev').click();
  await waitPlayer(target);
  return { collectionClick: target, nextButton: next, previousButton: target };
}

async function checkAutoplay(page) {
  await page.waitForFunction(() => { const video = document.querySelector('video'); return video && Number.isFinite(video.duration) && video.duration > 1 && video.readyState >= 2; });
  const before = await page.evaluate(() => window.player.getManifest().p);
  assert.equal(before, 1);
  // 让真实媒体播放到结束，使用站点自身的 ended 链路自动切 P。
  await page.locator('video').evaluate(async video => { video.currentTime = video.duration - 0.5; video.muted = true; await video.play(); });
  await page.waitForFunction(() => window.player?.getManifest?.().p === 2, null, { timeout: 20000 });
  await page.waitForURL(url => url.searchParams.get('p') === '2', { timeout: 10000 });
  await page.locator('video').evaluate(video => video.pause());
  assert.equal(new URL(page.url()).searchParams.get('p'), '2');
  return { from: before, to: 2, trigger: '真实媒体播放结束' };
}
