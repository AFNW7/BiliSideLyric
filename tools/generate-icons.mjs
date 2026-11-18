import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(name, bytes) {
  const body = Buffer.concat([Buffer.from(name), bytes]);
  const head = Buffer.alloc(4);
  head.writeUInt32BE(bytes.length);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
}
function inside(px, py) {
  const cornerX = Math.max(36 - px, 0, px - 92);
  const cornerY = Math.max(36 - py, 0, py - 92);
  return cornerX * cornerX + cornerY * cornerY <= 32 * 32 && px >= 4 && px <= 124 && py >= 4 && py <= 124;
}
function bar(px, py, centerX, top, bottom) {
  const nearestY = Math.max(top, Math.min(bottom, py));
  return (px - centerX) ** 2 + (py - nearestY) ** 2 <= 25;
}
for (const size of [16, 32, 48, 128]) {
  const pixels = Buffer.alloc((size * 4 + 1) * size);
  for (let row = 0; row < size; row++) for (let column = 0; column < size; column++) {
    const sum = [0, 0, 0, 0];
    for (let sampleY = 0; sampleY < 4; sampleY++) for (let sampleX = 0; sampleX < 4; sampleX++) {
      const px = (column + (sampleX + 0.5) / 4) * 128 / size;
      const py = (row + (sampleY + 0.5) / 4) * 128 / size;
      if (!inside(px, py)) continue;
      const dark = bar(px, py, 38, 48, 80) || bar(px, py, 64, 30, 98) || bar(px, py, 90, 48, 80);
      const mix = (px + py) / 256;
      const color = dark ? [21, 58, 54] : [178 - 65 * mix, 241 - 44 * mix, 219 - 33 * mix];
      color.forEach((value, index) => { sum[index] += value; });
      sum[3] += 255;
    }
    const position = row * (size * 4 + 1) + 1 + column * 4;
    for (let channel = 0; channel < 4; channel++) pixels[position + channel] = Math.round(sum[channel] / (channel < 3 && sum[3] ? sum[3] / 255 : 16));
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  writeFileSync(new URL(`../assets/icon-${size}.png`, import.meta.url), Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))
  ]));
}
