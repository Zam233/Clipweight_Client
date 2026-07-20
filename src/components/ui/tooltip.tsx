import * as React from 'react';
import { cn } from '@/lib/utils';

/** Tooltip — simple CSS-based tooltip */
interface TooltipProps {
  content: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: React.ReactNode;
}

function Tooltip({ content, side = 'top', children }: TooltipProps) {
  return (
    <div className="relative group inline-flex">
      {children}
      <div
        className={cn(
          'absolute z-50 hidden group-hover:block px-2 py-1 text-label-sm text-on-primary bg-inverse-surface rounded-cw-xs whitespace-nowrap pointer-events-none shadow-lg',
          side === 'top' && 'bottom-full left-1/2 -translate-x-1/2 mb-1',
          side === 'bottom' && 'top-full left-1/2 -translate-x-1/2 mt-1',
          side === 'left' && 'right-full top-1/2 -translate-y-1/2 mr-1',
          side === 'right' && 'left-full top-1/2 -translate-y-1/2 ml-1',
        )}
      >
        {content}
      </div>
    </div>
  );
}

export { Tooltip };
