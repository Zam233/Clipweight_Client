/**
 * P3-07: 移除 @tanstack/react-query 的 Provider 包装——全站取数手写
 * （axios 封装 + zustand），QueryClient 从未被任何 useQuery/useMutation
 * 消费，属死依赖（已从 package.json 一并移除）。
 */
import type { ReactNode } from 'react';

export function Providers({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
