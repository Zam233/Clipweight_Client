// Per-clip history push coalescing.
// Rapid successive edits to the SAME clip (slider drag / typing) collapse into a
// single undo point, while switching clips always opens a fresh window so editing
// clip A then clip B produces two undo points instead of one.
// 按片段作用域的撤销快照合并：同一片段的连续快速编辑合并为一个撤销点，
// 切换片段时各自独立开窗，保证「编辑 A 再编辑 B」产生两个撤销点。

export const HISTORY_COALESCE_WINDOW_MS = 600;

const lastPushByClip = new Map<string, number>();

/**
 * Returns true when a history push for `clipId` should be recorded now.
 * A push within `windowMs` of the last accepted push for the same clip is
 * coalesced (skipped). Other clips are unaffected.
 */
// P2-15: 显式交互窗口——一次拖拽/滑杆操作内无论多久只产生一个撤销点；
// 窗口结束后的下一次编辑必新开撤销点（快速两次独立编辑不再被误合并）。
const openWindows = new Set<string>();

/** 打开显式合并窗口（拖拽/滑杆开始）：窗口内仅首次推送被接受。 */
export function beginCoalesceWindow(clipId: string): void {
  if (!clipId) return;
  openWindows.add(clipId);
  lastPushByClip.delete(clipId);
}

/** 关闭显式合并窗口（拖拽/滑杆结束）：清计时，下一次推送必接受。 */
export function endCoalesceWindow(clipId: string): void {
  if (!clipId) return;
  openWindows.delete(clipId);
  lastPushByClip.delete(clipId);
}

export function shouldPush(
  clipId: string,
  now: number = Date.now(),
  windowMs: number = HISTORY_COALESCE_WINDOW_MS,
): boolean {
  if (openWindows.has(clipId)) {
    if (lastPushByClip.has(clipId)) return false; // 窗口内：仅首次
    lastPushByClip.set(clipId, now);
    return true;
  }
  const last = lastPushByClip.get(clipId) ?? 0;
  if (now - last < windowMs) {
    // P2-15: 滑动窗口——连续输入期间每次推送刷新计时，长按/长滑
    // （任意时长）也只落一个撤销点（旧实现固定窗口：>600ms 的拖拽多点）
    lastPushByClip.set(clipId, now);
    return false;
  }
  lastPushByClip.set(clipId, now);
  return true;
}

/** Clear the internal per-clip timestamp map (tests / clip selection reset). */
export function clearHistoryCoalesce(): void {
  lastPushByClip.clear();
}
