import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { normalizeTimeline } from '../src/content/timeline.js';
import { normalizeSubtitleURL } from '../src/shared/network.js';

function fixture({ playerCID = 10, delayTrack = false } = {}) {
  const location = { href: 'https://www.bilibili.com/video/BVcurrent' };
  let release;
  const timelines = [];
  const sourceText = readFileSync(new URL('../src/content/subtitle-source.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?$/gm, '').replace('export class SubtitleSource', 'class SubtitleSource');
  const sandbox = {
    location, normalizeTimeline, normalizeSubtitleURL, setTimeout: () => 0, clearTimeout: () => {},
    pageKey: () => new URL(location.href).pathname, getTitle: () => '当前视频', getDOMIdentity: () => '',
    parseSubtitle: () => [{ from: 0, to: 10, content: '手动字幕' }],
    chrome: { storage: { local: { get: async () => ({ imports: {} }), set: async () => {} } } },
    askPage: async () => ({ player: { aid: 1, bvid: 'BVcurrent', cid: 10 } }),
    askWorker: async message => message.type === 'SL_RESOLVE'
      ? { aid: 1, bvid: 'BVcurrent', cid: 10, title: '当前视频' } : ['https://api.bilibili.com/x/player/v2'],
    readJSON: async url => {
      if (url.includes('api.bilibili.com')) return { code: 0, data: { aid: 1, cid: playerCID, bvid: 'BVcurrent', subtitle: { subtitles: [
        { id: 1, lan: 'ai-zh', subtitle_url: 'https://aisubtitle.hdslb.com/caption' }
      ] } } };
      if (delayTrack) await new Promise(resolve => { release = resolve; });
      return { body: [{ from: 0, to: 10, content: '接口字幕' }] };
    }
  };
  runInNewContext(`${sourceText}\nglobalThis.Source = SubtitleSource;`, sandbox);
  const source = new sandbox.Source(cues => timelines.push(cues), () => {});
  return { source, location, timelines, sandbox, release: () => release?.() };
}

test('无字幕时不自动把页面文字采集为字幕', () => {
  const { source } = fixture();
  source.capture('某个播放器里残留的文字', 1);
  assert.equal(source.cues.length, 0);
  assert.notEqual(source.status.phase, 'ready');
  source.destroy();
});

test('字幕列表必须属于当前 cid，拒绝错片和缺失标识的响应', async () => {
  for (const playerCID of [999, undefined]) {
    const { source, sandbox } = fixture({ playerCID });
    if (playerCID === undefined) {
      const read = sandbox.readJSON;
      sandbox.readJSON = async url => { const response = await read(url); if (response.data) delete response.data.cid; return response; };
    }
    await source.start();
    assert.equal(source.cues.length, 0);
    assert.notEqual(source.status.phase, 'ready');
    source.destroy();
  }
});

test('可信的当前视频字幕正常加载', async () => {
  const { source } = fixture();
  await source.start();
  assert.equal(source.cues[0].content, '接口字幕');
  assert.equal(source.status.phase, 'ready');
  source.destroy();
});

test('视频 URL 已变化时，旧字幕异步响应不能落到新视频', async () => {
  const state = fixture({ delayTrack: true });
  const loading = state.source.start();
  await new Promise(resolve => setImmediate(resolve));
  state.location.href = 'https://www.bilibili.com/video/BVnext';
  state.release();
  await loading;
  assert.equal(state.source.cues.length, 0);
  state.source.destroy();
});

test('用户明确开启实时采集后才采集，切换视频后重新关闭', async () => {
  const { source, sandbox } = fixture();
  sandbox.readJSON = async () => ({ code: 0, data: { aid: 1, cid: 10, subtitle: { subtitles: [] } } });
  await source.start();
  source.enableDOM();
  source.capture('当前播放器字幕', 1);
  assert.equal(source.cues[0].content, '当前播放器字幕');
  await source.start();
  source.capture('下一视频未确认的文字', 1);
  assert.equal(source.cues.length, 0);
  source.destroy();
});

test('本地缓存必须确认 aid/cid，旧缓存和其他分集不会自动套用', async () => {
  for (const cid of [undefined, 999, 10]) {
    const { source, sandbox } = fixture();
    sandbox.chrome.storage.local.get = async () => ({ imports: { '/video/BVcurrent': {
      aid: 1, cid, name: 'local.srt', cues: [{ from: 0, to: 10, content: '缓存字幕' }]
    } } });
    await source.start();
    assert.equal(source.cues[0].content, cid === 10 ? '缓存字幕' : '接口字幕');
    source.destroy();
  }
});

test('主接口明确无字幕时停止，不从备用接口拼出字幕', async () => {
  const { source, sandbox } = fixture();
  const requested = [];
  const read = sandbox.readJSON;
  sandbox.askWorker = async message => message.type === 'SL_RESOLVE'
    ? { aid: 1, bvid: 'BVcurrent', cid: 10, title: '当前视频' }
    : ['https://api.bilibili.com/x/player/wbi/v2', 'https://api.bilibili.com/x/player/v2'];
  sandbox.readJSON = async url => {
    requested.push(url);
    return url.includes('/wbi/') ? { code: 0, data: { cid: 10, subtitle: { subtitles: [] } } } : read(url);
  };
  await source.start();
  assert.equal(source.cues.length, 0);
  assert.deepEqual(requested, ['https://api.bilibili.com/x/player/wbi/v2']);
  assert.doesNotMatch(source.status.detail, /自动重试/);
  source.destroy();
});

test('同一 URL 的播放器已换片时，旧接口回显原 cid 也不能加载', async () => {
  const state = fixture({ delayTrack: true });
  const loading = state.source.start();
  await new Promise(resolve => setImmediate(resolve));
  state.sandbox.askPage = async () => ({ player: { aid: 2, bvid: 'BVnext', cid: 20 } });
  state.release();
  await loading;
  assert.equal(state.source.cues.length, 0);
  state.source.destroy();
});

test('无法读取实际播放器身份时，不套用页面状态和字幕响应', async () => {
  const { source, sandbox } = fixture();
  sandbox.askPage = async () => ({ aid: 1, cid: 10, bvid: 'BVcurrent' });
  await source.start();
  assert.equal(source.cues.length, 0);
  assert.notEqual(source.status.phase, 'ready');
  source.destroy();
});

test('B 站明确标记无语音内容时，不自动使用 AI 识别字幕', async () => {
  const { source, sandbox } = fixture();
  sandbox.askWorker = async message => message.type === 'SL_RESOLVE'
    ? { aid: 1, bvid: 'BVcurrent', cid: 10, asrLanguage: 'zxx' } : ['https://api.bilibili.com/x/player/wbi/v2'];
  await source.start();
  assert.equal(source.cues.length, 0);
  source.destroy();
});

test('主接口网络失败仍可使用当前视频的备用接口字幕', async () => {
  const { source, sandbox } = fixture();
  const read = sandbox.readJSON;
  sandbox.askWorker = async message => message.type === 'SL_RESOLVE'
    ? { aid: 1, bvid: 'BVcurrent', cid: 10 } : ['https://api.bilibili.com/x/player/wbi/v2', 'https://api.bilibili.com/x/player/v2'];
  sandbox.readJSON = async url => { if (url.includes('/wbi/')) throw new Error('网络失败'); return read(url); };
  await source.start();
  assert.equal(source.cues[0].content, '接口字幕');
  source.destroy();
});
