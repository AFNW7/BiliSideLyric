import test from 'node:test';
import assert from 'node:assert/strict';
import { cueProgress } from '../src/content/timeline.js';

const cues = [
  { from: 8, to: 16, content: '当前长句' },
  { from: 18, to: 21, content: '下一句' },
  { from: 21, to: 25, content: '最后一句' }
];

test('长句以相邻字幕起点间隔计算位置，首尾钳制不循环', () => {
  assert.equal(cueProgress(cues, 0, 7), 0);
  assert.equal(cueProgress(cues, 0, 8), 0);
  assert.equal(cueProgress(cues, 0, 13), 0.5);
  assert.equal(cueProgress(cues, 0, 16), 0.8);
  assert.equal(cueProgress(cues, 0, 18), 1);
  assert.equal(cueProgress(cues, 0, 100), 1);
});

test('回退五秒精确恢复进度，暂停时不会随着墙钟时间移动', () => {
  assert.equal(cueProgress(cues, 0, 16), 0.8);
  assert.equal(cueProgress(cues, 0, 11), 0.3);
  assert.equal(cueProgress(cues, 0, 11), 0.3);
  assert.equal(cueProgress(cues, 0, 16), 0.8);
});

test('按实际视频时间计算，倍速和时间轴偏移无需额外计时器', () => {
  const normal = [8, 9, 10, 11].map(time => cueProgress(cues, 0, time));
  const double = [8, 10, 12, 14].map(time => cueProgress(cues, 0, time));
  assert.deepEqual(normal, [0, 0.1, 0.2, 0.3]);
  assert.deepEqual(double, [0, 0.2, 0.4, 0.6]);
  assert.equal(cueProgress(cues, 0, 12 + 1), 0.5);
});

test('最后一句用结束时间，无字幕、重叠起点和无效时间安全处理', () => {
  assert.equal(cueProgress(cues, 2, 23), 0.5);
  assert.equal(cueProgress(cues, 2, 25), 1);
  assert.equal(cueProgress([], -1, 10), 0);
  assert.equal(cueProgress(cues, 0, NaN), 0);
  assert.equal(cueProgress([{ from: 1, to: 3 }, { from: 1, to: 5 }], 0, 2), 0.5);
  assert.equal(cueProgress([{ from: 1, to: 1 }], 0, 2), 0);
});
