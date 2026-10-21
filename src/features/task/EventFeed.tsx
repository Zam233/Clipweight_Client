/**
 * 调用流（路线 C / C4，替代 AgentPanel 的管线日志）。
 *
 * 与管线日志的差别：这里**没有"Agent 开始/结束"**，只有能力调用与结果。
 * 每行必须能回答"它在干什么、结果如何、花了多少"，而不是刷一屏英文事件名。
 */

import { cn } from '@/lib/utils';
import type { TaskEvent } from '@/types/task';

import { eventLabel } from './labels';

interface Props {
  events: TaskEvent[];
  className?: string;
}

const _NOISY = new Set(['checkpoint']);

export function EventFeed({ events, className }: Props) {
  const visible = events.filter((e) => !_NOISY.has(e.type));
  if (visible.length === 0) {
    return (
      <p className="text-caption text-on-surface-variant py-3">
        还没有执行记录。任务开跑后这里会逐条出现「调用了什么、结果如何」。
      </p>
    );
  }
  return (
    <ol className={cn('space-y-1', className)} aria-label="调用记录">
      {visible.slice(-120).map((event) => (
        <li
          key={event.seq}
          className={cn(
            'flex items-start gap-2 text-caption px-2 py-1 rounded-cw-sm',
            event.type === 'tool_result' || event.type === 'step_end'
              ? 'bg-surface-container'
              : '',
          )}
        >
          <span className="font-mono text-on-surface-variant shrink-0 w-8 text-right">
            {event.seq}
          </span>
          <span
            className={cn(
              'shrink-0 px-1.5 rounded-cw-xs',
              event.type === 'gate_hit'
                ? 'bg-warning/15 text-warning'
                : event.type === 'degradation' || event.type === 'task_end'
                  ? 'bg-error/15 text-error'
                  : 'bg-surface-container-high text-on-surface-variant',
            )}
          >
            {eventLabel(event.type)}
          </span>
          <span className="min-w-0 text-on-surface break-words">{event.message}</span>
        </li>
      ))}
    </ol>
  );
}
