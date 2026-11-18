/** 清洗接口或导入的时间轴，保证可以二分查找。 */
export function normalizeTimeline(body) {
  if (!Array.isArray(body)) return [];
  return body.slice(0, 20000).filter(cue => cue && Number.isFinite(Number(cue.from)) &&
    Number.isFinite(Number(cue.to)) && Number(cue.from) >= 0 && Number(cue.to) > Number(cue.from) &&
    typeof cue.content === 'string' && cue.content.trim()).map(cue => ({
    from: Number(cue.from), to: Number(cue.to), content: cue.content.trim().slice(0, 4000)
  })).sort((first, second) => first.from - second.from);
}

/** 顺播先查相邻三句；拖动进度后以二分查找定位。 */
export function findIndex(cues, time, lastIndex = -1) {
  if (!cues.length || time < cues[0].from) return -1;
  const start = Math.max(0, lastIndex - 3);
  const end = Math.min(cues.length - 1, lastIndex + 3);
  for (let index = start; index <= end; index++) {
    if (cues[index].from <= time && (index === cues.length - 1 || cues[index + 1].from > time)) return index;
  }
  let lower = 0;
  let upper = cues.length - 1;
  while (lower <= upper) {
    const middle = (lower + upper) >>> 1;
    if (cues[middle].from <= time) lower = middle + 1;
    else upper = middle - 1;
  }
  return upper;
}

export function cueState(cues, time, lastIndex) {
  const index = findIndex(cues, time, lastIndex);
  if (index < 0) return { index: -1, visible: false, gap: false };
  const gap = time > cues[index].to;
  return { index, visible: time <= cues[index].to + 2, gap };
}

/** 以本句到下一句的起点间隔计算阅读进度，末句使用自身结束时间。 */
export function cueProgress(cues, index, time) {
  const cue = cues[index];
  if (!cue || !Number.isFinite(time)) return 0;
  const next = cues[index + 1];
  const end = next?.from > cue.from ? next.from : cue.to;
  if (!Number.isFinite(end) || end <= cue.from) return 0;
  return Math.max(0, Math.min(1, (time - cue.from) / (end - cue.from)));
}

export function autoContext(height, rowHeight, previous = 1, lastChange = 0, now = performance.now()) {
  const count = Math.max(1, Math.floor((Math.max(3, Math.floor((height - 64) / rowHeight)) - 1) / 2));
  return Math.abs(count - previous) === 1 && now - lastChange < 1500 ? previous : count;
}
