import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.SIDELYRIC_PLAYWRIGHT_PATH || 'playwright');
const output = fileURLToPath(new URL('../test-results/', import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ channel: 'msedge', headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1040 }, deviceScaleFactor: 1 });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
try {
  await page.goto('http://127.0.0.1:4173');
  await page.locator('#sidelyric-root .sl-line.is-current').waitFor({ state: 'visible' });
  await page.locator('#play').click();
  await page.screenshot({ path: `${output}/preview-desktop.png`, fullPage: true });
  const settings = page.locator('#settings');
  const content = page.locator('#sidelyric-root .is-current .sl-line-content');
  const text = page.locator('#sidelyric-root .is-current .sl-text');
  const viewport = page.locator('#sidelyric-root .sl-viewport');
  const area = page.locator('.bpx-player-video-area');
  const edgeDistance = async side => {
    const outer = await area.boundingBox();
    const inner = await viewport.boundingBox();
    return side === 'right' ? outer.x + outer.width - inner.x - inner.width : inner.x - outer.x;
  };
  await settings.locator('[data-tab="more"]').click();
  await page.waitForTimeout(350);
  for (const placement of ['left', 'right']) for (const textAlign of ['left', 'center', 'right']) {
    await settings.locator('[data-key="placement"]').selectOption(placement);
    await settings.locator('[data-key="textAlign"]').selectOption(textAlign);
    await page.waitForTimeout(60);
    assert.ok(Math.abs(await edgeDistance(placement) - 24) < 1, placement);
    const bounds = await content.boundingBox();
    const words = await text.boundingBox();
    const error = textAlign === 'center' ? words.x + words.width / 2 - bounds.x - bounds.width / 2 :
      textAlign === 'right' ? words.x + words.width - bounds.x - bounds.width : words.x - bounds.x;
    assert.ok(Math.abs(error) < 1, `${placement}/${textAlign}: alignment error ${error}`);
  }
  await page.screenshot({ path: `${output}/preview-alignment.png`, fullPage: true });
  const grip = page.locator('#sidelyric-root .sl-drag');
  const gripBounds = await grip.boundingBox();
  await page.mouse.move(gripBounds.x + 12, gripBounds.y + 12);
  await page.mouse.down();
  await page.mouse.move(gripBounds.x - 28, gripBounds.y + 12, { steps: 5 });
  await page.mouse.up();
  assert.ok(Math.abs(await edgeDistance('right') - 64) < 1);
  await grip.dblclick();
  assert.ok(Math.abs(await edgeDistance('right') - 24) < 1);
  await page.locator('#long-demo').click();
  await page.locator('#sidelyric-root .is-current .sl-timed-scroll').waitFor();
  for (const alignment of ['left', 'center', 'right']) {
    await settings.locator('[data-key="textAlign"]').selectOption(alignment);
    await page.waitForTimeout(60);
    const position = await text.evaluate(node => {
      const shift = new DOMMatrixReadOnly(getComputedStyle(node).transform).m41;
      return -shift / (node.scrollWidth - node.parentElement.clientWidth);
    });
    assert.ok(Math.abs(position - 1 / 14) < 0.001, alignment);
    const bounds = await content.boundingBox();
    const words = await text.boundingBox();
    assert.ok(words.x > bounds.x - 150, 'long text starts at its timed reading position');
  }
  await page.locator('#fullscreen').click();
  await page.waitForFunction(() => !!document.fullscreenElement);
  await page.waitForTimeout(100);
  assert.ok(Math.abs(await edgeDistance('right') - 24) < 1);
  await page.evaluate(() => document.exitFullscreen());
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${output}/preview-long-line.png`, fullPage: true });
  await page.locator('#sidelyric-root .sl-brand-button').click();
  await page.locator('#sidelyric-root .sl-panel').waitFor({ state: 'visible' });
  await page.screenshot({ path: `${output}/preview-panel.png`, fullPage: true });
  await page.locator('#sidelyric-root [data-action="close"]').click();
  await page.setViewportSize({ width: 800, height: 1000 });
  await page.screenshot({ path: `${output}/preview-tablet.png`, fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  console.info('PASS six placement/alignment combinations, right-edge drag/reset, timed overflow, fullscreen, desktop/tablet, no page errors');
} catch (error) {
  console.error(errors);
  console.error(await page.locator('#sidelyric-root').evaluate(node => ({ host: node.getBoundingClientRect().toJSON(), html: node.shadowRoot.querySelector('.sl-root')?.outerHTML.slice(0, 1800) })).catch(() => 'No overlay'));
  await page.screenshot({ path: `${output}/preview-failure.png`, fullPage: true });
  throw error;
} finally { await browser.close(); }
