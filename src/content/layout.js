import { autoContext } from './timeline.js';

/** 检测左右黑边，在用户选择的一侧定位歌词区域。 */
export function computeLayout(width, height, videoWidth, videoHeight, settings, previous = 1, lastChange = 0, now) {
  const ratio = videoWidth > 0 && videoHeight > 0 ? videoWidth / videoHeight : width / Math.max(height, 1);
  const sideBar = Math.max(0, (width - height * ratio) / 2);
  const inBars = sideBar >= 120;
  const edgePadding = Math.min(settings.leftPadding, Math.max(0, width - 96));
  const maxWidth = Math.max(32, Math.min(520, width * settings.maxWidthPct / 100, width - edgePadding - 16, inBars ? sideBar - edgePadding - 12 : Infinity));
  const left = settings.placement === 'right' ? width - edgePadding - maxWidth : edgePadding;
  const rowHeight = settings.fontSize * settings.lineHeight * (settings.overflowMode === 'wrap' ? 3 : 1) + 14;
  const context = settings.contextLines === 'auto' ? autoContext(height, rowHeight, previous, lastChange, now) : Number(settings.contextLines);
  return { left, edgePadding, maxWidth, rowHeight, context, inBars };
}
