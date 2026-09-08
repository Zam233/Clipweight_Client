import { cn } from '@/lib/utils';

/**
 * Skeleton — 骨架屏占位（轮 89：批次 10）。
 *
 * 内容加载时以脉冲灰块预占版位，替代单一 spinner——
 * 布局在加载前后保持稳定，减少跳动。
 */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-cw-xs bg-outline-variant/30', className)} />;
}

/** 卡片网格骨架（项目列表/素材网格等加载态）。 */
export function SkeletonCardGrid({ count = 6, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 md:grid-cols-3 gap-4', className)} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-cw-md border border-outline-variant/30 p-4 space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}
