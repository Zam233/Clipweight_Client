/**
 * 统一时间线开关（unified-stream PRD §7 迁移与回退）。
 *
 * 默认**开启**单流（用户明确要求的形态：像现代 agent 工具那样按顺序显示）。
 * 开关来自三处（优先级从高到低）：URL `?unifiedTimeline=1|0` → localStorage → 默认开。
 * 出问题时**不用发版**：加 `?unifiedTimeline=0` 或写 localStorage 就能回到旧分区视图。
 */

const STORAGE_KEY = 'cw.unifiedTimeline';

export function isUnifiedTimelineEnabled(): boolean {
  try {
    if (typeof window !== 'undefined') {
      const q = new URLSearchParams(window.location.search).get('unifiedTimeline');
      if (q === '1' || q === 'true') return true;
      if (q === '0' || q === 'false') return false;
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === '1' || saved === 'true') return true;
      if (saved === '0' || saved === 'false') return false;
    }
  } catch {
    /* 隐私模式/无 window：按默认（开）处理，不影响渲染 */
  }
  return true;
}

/** 测试与设置页用：写入开关（'1' 开 / '0' 关 / null 清空回到默认）。 */
export function setUnifiedTimelineEnabled(value: boolean | null): void {
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* 忽略：写不进去就用 URL 参数控制 */
  }
}
