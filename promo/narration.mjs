import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { synth, toWav } from './vendor/bibibobo/bibibobo.js';

const story = JSON.parse(await readFile(new URL('storyboard.json', import.meta.url), 'utf8'));
const output = new URL('output/voice/', import.meta.url);
await mkdir(output, { recursive: true });
assert(story.duration < 30, '宣传片应小于 30 秒');
for (const [index, scene] of story.scenes.entries()) {
  assert.equal(scene.start, index ? story.scenes[index - 1].end : 0, '分镜必须连续');
  const samples = synth(scene.narration, { voice: 'fish', gap: .12 });
  const duration = samples.length / 44100;
  assert(duration <= scene.end - scene.start - .6, `${scene.name}配音超出分镜，需精简文案`);
  assert(samples.every(Number.isFinite) && samples.some(value => Math.abs(value) > .01), '配音应包含有效声音');
  await writeFile(new URL(`scene-${String(index).padStart(2, '0')}.wav`, output), toWav(samples));
  console.info(`${scene.name}: 大肥鱼 fish / ${duration.toFixed(2)}s`);
}
assert.equal(story.scenes.at(-1).end, story.duration);
console.info('bibibobo 大肥鱼配音完成，保留原始声线和语速。');
