/**
 * 统一时间线开关（unified-stream PRD §7 迁移与回退）。
 *
 * 迁移期两套 UI 并存：默认仍走旧的分区视图，打开开关才用一条流。
 * 开关来自三处（优先级从高到低）：URL `?unifiedTimeline=1|0` → localStorage → 默认关。
 * 这样出问题时**不用发版**就能切回去（回退只影响渲染，数据层不动）。
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
    /* 隐私模式/无 window：按默认（关）处理，不影响渲染 */
  }
  return false;
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
