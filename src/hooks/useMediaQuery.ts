import { useState, useEffect } from 'react';

/** 媒体查询 hook（批3 响应式布局用）。
 *
 * jsdom/SSR 无 matchMedia 时按「宽屏」处理——保持既有桌面布局语义，
 * 也让未显式 stub 的测试不受影响。
 */
export function useMediaQuery(query: string): boolean {
  const canMatch = typeof window !== 'undefined' && typeof window.matchMedia === 'function';
  const [matches, setMatches] = useState(() => (canMatch ? window.matchMedia(query).matches : true));

  useEffect(() => {
    if (!canMatch) return;
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mq.addEventListener('change', handler);
    setMatches(mq.matches);
    return () => mq.removeEventListener('change', handler);
  }, [query, canMatch]);

  return matches;
}
