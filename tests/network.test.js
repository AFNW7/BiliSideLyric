import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { allowedURL, fetchJSON, normalizeSubtitleURL } from '../src/shared/network.js';

const addresses = [
  'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1234567890abcdef?auth_key=1795000000-0-0-signature',
  'https://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/1234567890abcdef?auth_key=a%2Fb%2Bc&sign=A%3DB',
  'https://aisubtitle.hdslb.com/bfs/subtitle/1234567890abcdef.json?auth_key=signature'
];
const body = { body: [{ from: 0, to: 5, content: '无后缀 AI 字幕已加载' }] };

test('字幕地址：协议相对与旧 HTTP 地址升级为 HTTPS，非法地址不自动重试', () => {
  const address = addresses[1];
  assert.equal(normalizeSubtitleURL(address.replace('https:', '')), address);
  assert.equal(normalizeSubtitleURL(address.replace('https:', 'http:')), address);
  for (const value of ['not a URL', 'https://evil.test/subtitle', 'https://user:pass@aisubtitle.hdslb.com/key']) {
    assert.throws(() => normalizeSubtitleURL(value), error => error.retryable === false);
  }
});

test('字幕地址：后台接受无 JSON 后缀的 AI 字幕及完整鉴权参数', async () => {
  const original = globalThis.fetch;
  const requested = [];
  globalThis.fetch = async url => { requested.push(url); return new Response(JSON.stringify(body)); };
  try {
    for (const url of addresses) {
      assert.equal(allowedURL(url), true, url);
      assert.deepEqual(await fetchJSON(url), body);
    }
    assert.deepEqual(requested, addresses);
  } finally { globalThis.fetch = original; }
});

test('字幕地址：MAIN world 与后台都接受无后缀地址并保留签名', async () => {
  let listener;
  let response;
  const requested = [];
  const window = {
    addEventListener: (name, callback) => { if (name === 'message') listener = callback; },
    postMessage: message => { response = message; }
  };
  runInNewContext(readFileSync(new URL('../src/content/inject-main.js', import.meta.url), 'utf8'), {
    window, location: { origin: 'https://www.bilibili.com' }, URL, AbortSignal,
    fetch: async url => { requested.push(url); return new Response(JSON.stringify(body)); }
  });
  for (const [index, url] of addresses.entries()) {
    await listener({ source: window, origin: 'https://www.bilibili.com', data: {
      channel: 'sidelyric:bridge:v1', direction: 'request', id: String(index), kind: 'fetch', url
    } });
    assert.equal(response.error, undefined, url);
    assert.equal(response.data.body[0].content, body.body[0].content);
  }
  assert.deepEqual(requested, addresses);
});

test('字幕地址：拒绝其他域名、伪装域名、凭据与非 HTTPS', () => {
  for (const url of [
    'https://aisubtitle.hdslb.com.evil.test/bfs/ai_subtitle/prod/key',
    'https://evil.test/bfs/ai_subtitle/prod/key',
    'https://hdslb.com@evil.test/bfs/subtitle/key',
    'https://user:password@aisubtitle.hdslb.com/bfs/subtitle/key',
    'http://aisubtitle.hdslb.com/bfs/ai_subtitle/prod/key',
    'https://aisubtitle.hdslb.com:444/bfs/ai_subtitle/prod/key'
  ]) assert.equal(allowedURL(url), false, url);
});
