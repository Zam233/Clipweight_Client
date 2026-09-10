import { describe, it, expect, beforeEach } from 'vitest';
import { beginCoalesceWindow, endCoalesceWindow, shouldPush, clearHistoryCoalesce, HISTORY_COALESCE_WINDOW_MS } from './historyCoalesce';

describe('shouldPush — per-clip history coalescing', () => {
  beforeEach(() => {
    clearHistoryCoalesce();
  });

  it('first push for a clip is allowed', () => {
    expect(shouldPush('A', 1000)).toBe(true);
  });

  it('immediate second push for the SAME clip within the window is coalesced', () => {
    expect(shouldPush('A', 1000)).toBe(true);
    expect(shouldPush('A', 1000 + HISTORY_COALESCE_WINDOW_MS - 1)).toBe(false);
  });

  it('switching to another clip immediately opens its own window (the bug being fixed)', () => {
    expect(shouldPush('A', 1000)).toBe(true);
    expect(shouldPush('B', 1001)).toBe(true);
  });

  it('P2-15: 滑动窗口——连续输入续期合并，空闲超过窗口后才新开撤销点', () => {
    expect(shouldPush('A', 1000)).toBe(true);
    // 连续推送（如长滑杆）不断续期：即使远超 600ms 也不产生新点
    expect(shouldPush('A', 1500)).toBe(false); // last=1500
    expect(shouldPush('A', 2000)).toBe(false); // last=2000
    expect(shouldPush('A', 2500)).toBe(false); // last=2500
    // 空闲 > 窗口（600ms）后的下一次编辑 → 新点
    expect(shouldPush('A', 3101)).toBe(true);
  });

  it('P2-15: 显式拖拽窗口——窗口内无论多久只落一个点，结束后立即新开', () => {
    clearHistoryCoalesce();
    beginCoalesceWindow('B');
    expect(shouldPush('B', 1000)).toBe(true);
    expect(shouldPush('B', 5000)).toBe(false); // 长拖拽：仍合并
    expect(shouldPush('B', 20000)).toBe(false);
    endCoalesceWindow('B');
    expect(shouldPush('B', 20001)).toBe(true); // 窗口结束 → 下一次必新开
  });
});
