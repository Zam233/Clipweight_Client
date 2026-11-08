/**
 * 会话时间线开关（session-timeline PRD §6，2026-10-31）。
 *
 * 默认**开启**：会话只有一条服务端有序流，前端按 seq 渲染。
 * 关掉它回到旧的消息列表视图（客户端拼装、思考条单独一块），用于出问题时不发版回退。
 *
 * 开关来源优先级：URL `?unifiedTimeline=1|0` → localStorage `cw.unifiedTimeline` → 默认开。
 * **沿用旧键名**是故意的：这正是旧单流的回退开关，用户/脚本已经在用了；
 * 换新键会让"加 `?unifiedTimeline=0` 回退"这一条失效，回退手段必须和 upgrade 前一致。
 */

const STORAGE_KEY = 'cw.unifiedTimeline';

export function isSessionTimelineEnabled(): boolean {
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
export function setSessionTimelineEnabled(value: boolean | null): void {
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, value ? '1' : '0');
  } catch {
    /* 忽略：写不进去就用 URL 参数控制 */
  }
}

/** 兼容别名：旧调用点（与旧测试）继续可用。 */
export const isUnifiedTimelineEnabled = isSessionTimelineEnabled;
export const setUnifiedTimelineEnabled = setSessionTimelineEnabled;
