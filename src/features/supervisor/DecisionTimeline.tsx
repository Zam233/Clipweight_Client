/**
 * 决策时间线（前端 F1）。
 *
 * 只展示**决策点**（失败/降级/重试），常规成功阶段折叠成一行汇总；
 * 每行可展开看降级明细与失败原因。术语一律走 labels.ts（不露内部阶段名）。
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { Badge } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { LedgerEntry } from '@/types/supervisor';

import { decisionLabel, stageLabel } from './labels';

interface Props {
  entries: LedgerEntry[];
  className?: string;
}

function _isNotable(entry: LedgerEntry): boolean {
  return Boolean(entry.failure) || (entry.degradations?.length ?? 0) > 0 || entry.decision !== 'pass';
}

export function DecisionTimeline({ entries, className }: Props) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (entries.length === 0) {
    return (
      <p className="text-caption text-on-surface-variant py-4">
        本次运行还没有记录到任何环节（可能仍在进行）。
      </p>
    );
  }

  const notable = entries.filter(_isNotable);
  const quiet = entries.filter((e) => !_isNotable(e));

  return (
    <div className={cn('space-y-2', className)}>
      {quiet.length > 0 && (
        <p className="text-caption text-on-surface-variant">
          {quiet.length} 个环节正常完成：{quiet.map((e) => stageLabel(e.stage)).join('、')}
        </p>
      )}

      <ol className="space-y-1.5">
        {notable.map((entry) => {
          const isOpen = expanded.has(entry.id);
          const hasDetail =
            Boolean(entry.failure) ||
            (entry.degradations?.length ?? 0) > 0 ||
            (entry.warnings?.length ?? 0) > 0;
          return (
            <li
              key={entry.id}
              className="border border-outline-variant/30 rounded-cw-sm bg-surface-container/40"
            >
              <button
                type="button"
                onClick={() => hasDetail && toggle(entry.id)}
                aria-expanded={isOpen}
                className="w-full flex items-center gap-2 px-3 py-2 text-left"
                disabled={!hasDetail}
              >
                {hasDetail ? (
                  isOpen ? (
                    <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                  ) : (
                    <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                  )
                ) : (
                  <span className="w-3.5 shrink-0" />
                )}
                <span className="text-body-sm text-on-surface">{stageLabel(entry.stage)}</span>
                <span className="text-caption text-on-surface-variant">第 {entry.attempt} 次</span>
                <Badge variant={entry.decision === 'pass' ? 'success' : 'error'}>
                  {decisionLabel(entry.decision)}
                </Badge>
                {(entry.degradations?.length ?? 0) > 0 && (
                  <Badge variant="warning">降级 {entry.degradations.length} 处</Badge>
                )}
                <span className="ml-auto text-caption text-on-surface-variant">
                  {entry.duration_ms ? `${(entry.duration_ms / 1000).toFixed(1)}s` : ''}
                </span>
              </button>

              {isOpen && hasDetail && (
                <div className="px-3 pb-2.5 space-y-1.5">
                  {entry.failure && (
                    <div className="text-caption text-error">
                      失败原因：{entry.failure.blocking_point || entry.failure.category}
                      {entry.failure.needs?.length
                        ? `（需要 ${entry.failure.needs
                            .map((n) => `${stageLabel(n.from_stage)}补齐 ${n.field}`)
                            .join('、')}）`
                        : ''}
                    </div>
                  )}
                  {entry.degradations?.map((d, i) => (
                    <div key={`${d.kind}-${i}`} className="text-caption text-on-surface-variant">
                      · {d.detail || d.kind}
                      {d.scope ? `（${d.scope}）` : ''}
                      {d.impact ? ` — 影响：${d.impact}` : ''}
                    </div>
                  ))}
                  {entry.warnings?.map((w, i) => (
                    <div key={`w-${i}`} className="text-caption text-on-surface-variant">
                      · 警告：{w}
                    </div>
                  ))}
                  {entry.model && (
                    <div className="text-caption text-on-surface-variant/70">
                      使用模型：{entry.model}
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
