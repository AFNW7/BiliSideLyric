import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { md5, signWbi } from '../src/background/wbi.js';
import { normalizeTimeline, findIndex, cueState, autoContext } from '../src/content/timeline.js';
import { parseSubtitle } from '../src/content/importers.js';
import { normalizeSettings, DEFAULTS } from '../src/shared/settings.js';
import { allowedURL } from '../src/shared/network.js';
import { computeLayout } from '../src/content/layout.js';
import { resolveVideo } from '../src/background/video-info.js';

test('MD5 与原生 crypto 一致，覆盖中文、多块与空输入', () => {
  for (const value of ['', 'a', 'abc', '旁白 SideLyric', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(65), '流动'.repeat(500)]) {
    assert.equal(md5(value), createHash('md5').update(value).digest('hex'));
  }
});

test('WBI 参数按字母排序，剔除特殊字符，签名可重复验证', () => {
  const img = '7cd084941338484aae1ad9425b84077c';
  const sub = '4932caff0ff746eab6f01bf08b70ac45';
  const signed = signWbi({ foo: "a!b'c(d)*", aid: 170001, cid: 279786 }, img, sub, 1702204169);
  assert.match(signed, /^aid=170001&cid=279786&foo=abcd&wts=1702204169&w_rid=[a-f0-9]{32}$/);
  assert.equal(signed, signWbi({ cid: 279786, aid: 170001, foo: 'abcd' }, img, sub, 1702204169));
  assert.throws(() => signWbi({}, '', ''), /密钥/);
});

const cues = normalizeTimeline([
  { from: 10, to: 16, content: '长句六秒' }, { from: 0, to: 4, content: ' 开场 ' },
  { from: 20, to: 24, content: '第三句' }, { from: -1, to: 2, content: '非法' },
  { from: 6, to: 2, content: '反向' }, { from: 2, to: 3, content: '' }, { from: Infinity, to: 100, content: '非法' }
]);
test('清洗时间轴、长句持续高亮，间隙两秒后隐藏', () => {
  assert.equal(cues.length, 3);
  assert.equal(cues[0].content, '开场');
  assert.deepEqual(cueState(cues, -1, -1), { index: -1, visible: false, gap: false });
  for (let time = 10; time <= 16; time += 0.05) assert.deepEqual(cueState(cues, time, 1), { index: 1, visible: true, gap: false });
  assert.deepEqual(cueState(cues, 17, 1), { index: 1, visible: true, gap: true });
  assert.equal(cueState(cues, 18.01, 1).visible, false);
});

test('连续播放、向前与向后拖动、重叠起点都能准确查找', () => {
  const large = Array.from({ length: 10000 }, (_, index) => ({ from: index * 2, to: index * 2 + 1.8, content: `${index}` }));
  for (const time of [0, 4, 19000, 8, 19998, -1, 8000.3, 20000]) {
    assert.equal(findIndex(large, time, 500), time < 0 ? -1 : Math.min(9999, Math.floor(time / 2)));
  }
  assert.equal(findIndex([{ from: 0 }, { from: 0 }, { from: 1 }], 0, -1), 1);
});

test('自动条数有迟滞，显著尺寸变化立即生效', () => {
  assert.equal(autoContext(520, 50, 3, 1000, 1100), 3);
  assert.equal(autoContext(520, 50, 3, 1000, 2600), 4);
  assert.equal(autoContext(1000, 50, 3, 1000, 1100), 8);
});

test('黑边优先放入左侧，横屏叠加且宽度上限生效', () => {
  const portrait = computeLayout(1280, 720, 1080, 1920, DEFAULTS, 1, -Infinity, 100);
  assert.equal(portrait.inBars, true);
  assert.ok(portrait.maxWidth <= (1280 - 720 * 1080 / 1920) / 2 - 24);
  assert.equal(computeLayout(1280, 720, 1920, 1080, DEFAULTS, 1, -Infinity, 100).inBars, false);
  assert.equal(computeLayout(2560, 1440, 1920, 1080, DEFAULTS, 1, -Infinity, 100).maxWidth, 520);
});

test('歌词左右定位保持相同宽度与边缘留白，并使用所选一侧的黑边', () => {
  for (const [width, height, videoWidth, videoHeight] of [[1280, 720, 1920, 1080], [1280, 720, 1080, 1920], [960, 500, 1920, 1080]]) {
    const left = computeLayout(width, height, videoWidth, videoHeight, DEFAULTS, 1, -Infinity, 100);
    const right = computeLayout(width, height, videoWidth, videoHeight, { ...DEFAULTS, placement: 'right' }, 1, -Infinity, 100);
    assert.equal(left.left, DEFAULTS.leftPadding);
    assert.equal(right.left + right.maxWidth + right.edgePadding, width);
    assert.equal(right.maxWidth, left.maxWidth);
    assert.equal(right.inBars, left.inBars);
    if (right.inBars) assert.ok(right.left >= (width + height * videoWidth / videoHeight) / 2);
  }
});

test('歌词位置与字幕对齐独立配置，旧配置有默认值，非法值不能进入样式', () => {
  for (const placement of ['left', 'right']) for (const textAlign of ['left', 'center', 'right']) {
    const settings = normalizeSettings({ placement, textAlign });
    assert.equal(settings.placement, placement);
    assert.equal(settings.textAlign, textAlign);
  }
  assert.equal(normalizeSettings({ fontSize: 22 }).placement, 'left');
  assert.equal(normalizeSettings({ placement: 'top', textAlign: 'justify' }).textAlign, 'left');
  assert.equal(normalizeSettings({ placement: 'top' }).placement, 'left');
});

test('SRT 解析多行、BOM 与小数，文本不能变成 HTML', () => {
  const result = parseSubtitle('\uFEFF1\r\n00:00:01,500 --> 00:00:06,000\r\n<b>第一行</b>\r\n第二行\r\n\r\n2\r\n00:00:10.250 --> 00:00:12.000\r\n结束', 'test.srt');
  assert.deepEqual(result, [{ from: 1.5, to: 6, content: '第一行\n第二行' }, { from: 10.25, to: 12, content: '结束' }]);
});

test('LRC 多标签与 offset，最后一句默认五秒，拒绝空文件', () => {
  const result = parseSubtitle('[offset:-200]\n[00:01.20][00:05.50]重复\n[01:02:50]结尾', 'test.lrc');
  assert.equal(result[0].from, 1);
  assert.equal(result[0].to, 5.3);
  assert.equal(result[2].from, 62.3);
  assert.equal(result[2].to, 67.3);
  assert.throws(() => parseSubtitle('不是字幕', 'wrong.lrc'), /有效时间轴/);
  assert.throws(() => parseSubtitle('a'.repeat(2 * 1024 * 1024 + 1)), /2 MB/);
});

test('配置边界与协议字段校验', () => {
  const result = normalizeSettings({ fontSize: 100, opacity: NaN, offsetSec: -8, enabled: 'false', overflowMode: 'html', contextLines: '5', evil: true });
  assert.equal(result.fontSize, 40); assert.equal(result.opacity, 0.95);
  assert.equal(result.offsetSec, -3); assert.equal(result.enabled, true);
  assert.equal(result.contextLines, 5); assert.equal(result.overflowMode, 'scroll');
  assert.equal('evil' in result, false);
});

test('后台请求白名单拒绝其他域名、协议、端口和伪装地址', () => {
  for (const value of ['http://api.bilibili.com/x/player/v2', 'https://evil.test/a.json', 'https://api.bilibili.com.evil.test/x/player/v2', 'https://aisubtitle.hdslb.com.evil.test/a.json', 'https://api.bilibili.com/x/other', 'https://user:pass@api.bilibili.com/x/player/v2', 'https://api.bilibili.com:444/x/player/v2']) assert.equal(allowedURL(value), false, value);
  assert.equal(allowedURL('https://api.bilibili.com/x/player/wbi/v2?cid=1'), true);
  assert.equal(allowedURL('https://aisubtitle.hdslb.com/bfs/a.json?auth_key=1'), true);
});

test('分 P、番剧按 URL 解析，页面过期状态不能串台', async () => {
  const original = globalThis.fetch;
  globalThis.fetch = async url => new Response(JSON.stringify(String(url).includes('/pgc/') ? {
    code: 0, result: { title: '番剧', episodes: [{ id: 11, aid: 1, cid: 101, title: '1' }, { id: 12, aid: 2, cid: 102, title: '2' }] }
  } : { code: 0, data: { aid: 9, bvid: 'BVtest', title: '视频', pages: [{ page: 1, cid: 10, part: '一' }, { page: 2, cid: 20, part: '二' }] } }));
  try {
    assert.equal((await resolveVideo('https://www.bilibili.com/video/BVtest?p=2', { aid: 9, cid: 10, page: 1, bvid: 'BVtest' })).cid, 20);
    assert.equal((await resolveVideo('https://www.bilibili.com/bangumi/play/ep12', { aid: 1, cid: 101, episodeKey: '/bangumi/play/ep11' })).cid, 102);
    await assert.rejects(resolveVideo('https://evil.test/video/BVtest'), /B 站/);
  } finally { globalThis.fetch = original; }
});
