export const DEFAULTS = Object.freeze({
  enabled: true, fontSize: 20, lineHeight: 1.4, opacity: 0.95,
  maxWidthPct: 42, overflowMode: 'scroll', scrollSpeed: 60,
  contextLines: 'auto', offsetSec: 0, leftPadding: 24,
  showBg: false, hideInFullscreen: false, placement: 'left', textAlign: 'left'
});

const ranges = {
  fontSize: [12, 40], lineHeight: [1.1, 2], opacity: [0.2, 1],
  maxWidthPct: [20, 60], scrollSpeed: [20, 200], offsetSec: [-3, 3], leftPadding: [0, 240]
};

/** 校验跨上下文配置，忽略未知字段与非法数值。 */
export function normalizeSettings(input = {}) {
  const settings = { ...DEFAULTS };
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const value = input[key];
    if (typeof fallback === 'boolean' && typeof value === 'boolean') settings[key] = value;
    if (ranges[key] && typeof value === 'number' && Number.isFinite(value)) {
      settings[key] = Math.min(ranges[key][1], Math.max(ranges[key][0], value));
    }
  }
  if (['scroll', 'wrap', 'clip'].includes(input.overflowMode)) settings.overflowMode = input.overflowMode;
  if (['left', 'right'].includes(input.placement)) settings.placement = input.placement;
  if (['left', 'center', 'right'].includes(input.textAlign)) settings.textAlign = input.textAlign;
  if (input.contextLines === 'auto') settings.contextLines = 'auto';
  else if (Number.isInteger(Number(input.contextLines)) && Number(input.contextLines) >= 1 && Number(input.contextLines) <= 8) {
    settings.contextLines = Number(input.contextLines);
  }
  return settings;
}
