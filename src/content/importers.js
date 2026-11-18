import { normalizeTimeline } from './timeline.js';

function timestamp(value) {
  const parts = value.replace(',', '.').split(':').map(Number);
  return parts.reduce((total, part) => total * 60 + part, 0);
}

/** 解析 SRT / LRC，支持多时间标签与 LRC 的毫秒偏移元信息。 */
export function parseSubtitle(text, filename = '') {
  if (text.length > 2 * 1024 * 1024) throw new Error('字幕文件不能超过 2 MB');
  const source = text.replace(/^\uFEFF/, '').replace(/\r/g, '');
  const cues = [];
  if (/\.srt$/i.test(filename) || source.includes('-->')) {
    for (const block of source.split(/\n\s*\n/)) {
      const lines = block.split('\n');
      const position = lines.findIndex(line => line.includes('-->'));
      if (position < 0) continue;
      const match = lines[position].match(/(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*(\d{1,3}:\d{2}:\d{2}[,.]\d{1,3})/);
      if (match) cues.push({ from: timestamp(match[1]), to: timestamp(match[2]), content: lines.slice(position + 1).join('\n').replace(/<[^>]*>/g, '') });
    }
  } else {
    const offset = Number(source.match(/\[offset:([+-]?\d+)\]/i)?.[1] || 0) / 1000;
    for (const line of source.split('\n')) {
      const labels = [...line.matchAll(/\[(\d{1,3}:\d{2}(?:[.:]\d{1,3})?)\]/g)];
      const content = line.replace(/\[[^\]]*\]/g, '').trim();
      if (!content) continue;
      for (const match of labels) {
        const value = match[1].replace(/:(\d{1,3})$/, (suffix, fraction) => match[1].split(':').length > 2 ? `.${fraction}` : suffix);
        cues.push({ from: Math.max(0, timestamp(value) + offset), content });
      }
    }
    cues.sort((first, second) => first.from - second.from);
    let nextTime;
    for (let index = cues.length - 1; index >= 0; index--) {
      if (cues[index + 1]?.from > cues[index].from) nextTime = cues[index + 1].from;
      cues[index].to = nextTime ?? cues[index].from + 5;
    }
  }
  const timeline = normalizeTimeline(cues);
  if (!timeline.length) throw new Error('没有找到有效时间轴，请选择 SRT 或 LRC 字幕');
  return timeline;
}
