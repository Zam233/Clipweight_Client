/**
 * 执行日志（F7）：每条命令一行，展开看完整输出与 cwd；被拒绝的用独立样式。
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { ExecRecord } from '@/types/supervisor';

import { ExecLevelBadge } from './ExecLevelBadge';

interface Props {
  records: ExecRecord[];
  className?: string;
}

export function ExecLogList({ records, className }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (id: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (records.length === 0) {
    return (
      <p className={cn('text-caption text-on-surface-variant py-4', className)}>
        本次运行没有执行过命令。
      </p>
    );
  }

  return (
    <ul className={cn('space-y-1.5', className)} aria-label="执行日志">
      {records.map((rec) => {
        const expanded = open.has(rec.id);
        const rejected = Boolean(rec.rejected);
        return (
          <li
            key={rec.id}
            className={cn(
              'rounded-cw-sm border px-2.5 py-1.5',
              rejected
                ? 'border-error/40 bg-error/5'
                : 'border-outline-variant/30 bg-surface-container/40',
            )}
          >
            <button
              type="button"
              onClick={() => toggle(rec.id)}
              aria-expanded={expanded}
              className="w-full flex items-center gap-2 text-left"
            >
              {expanded ? (
                <ChevronDown className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 shrink-0" />
              )}
              <ExecLevelBadge level={rec.riskLevel} />
              <code className="text-caption text-on-surface truncate max-w-[240px]">
                {rec.command}
              </code>
              {rejected ? (
                <Badge variant="error">已拒绝</Badge>
              ) : (
                <span className="text-caption text-on-surface-variant">
                  exit={rec.exitCode ?? '?'}
                </span>
              )}
              <span className="ml-auto text-caption text-on-surface-variant">
                {rec.durationMs}ms
              </span>
            </button>

            {expanded && (
              <div className="mt-1.5 space-y-1">
                <p className="text-caption text-on-surface-variant">cwd：{rec.cwd || '（默认）'}</p>
                {rec.riskReasons.length > 0 && (
                  <p className="text-caption text-on-surface-variant">
                    判定理由：{rec.riskReasons.join('；')}
                  </p>
                )}
                {rec.dangerExplanation && (
                  <p className="text-caption text-warning">危险说明：{rec.dangerExplanation}</p>
                )}
                {rec.rejected && (
                  <p className="text-caption text-error">拒绝原因：{rec.rejected.reason}</p>
                )}
                {rec.outputTail && (
                  <pre className="text-caption text-on-surface-variant whitespace-pre-wrap break-all bg-surface-container rounded-cw-sm p-2 max-h-48 overflow-auto">
                    {rec.outputTail}
                  </pre>
                )}
                {rec.autoMode && <Badge variant="info">当时为自动模式</Badge>}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
