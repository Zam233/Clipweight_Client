/**
 * 调用流（路线 C / C4，替代 AgentPanel 的管线日志）。
 *
 * 与管线日志的差别：这里**没有"Agent 开始/结束"**，只有能力调用与结果。
 * 每行必须能回答"它在干什么、结果如何、花了多少"，而不是刷一屏英文事件名。
 *
 * B12（2026-10-28 PRD）：
 * - N7：这里不再二次截断。store 已经按 `MAX_TASK_EVENTS` 有界（400），再切 120 会让
 *   用户以为"前面什么都没发生"；超出 store 上限时**明说**被丢弃了多少。
 * - N8：`doc_write` / `report` / `context_loaded` / `degradation` 有结构化 detail，
 *   行内可展开看详情；`doc_write` / `report` 直接给出产物路径（可复制）。
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { TaskEvent } from '@/types/task';
import { MAX_TASK_EVENTS } from '@/stores/taskStore';

import { eventLabel } from './labels';

interface Props {
  events: TaskEvent[];
  className?: string;
}

const _NOISY = new Set(['checkpoint']);
/** 这些事件的 detail 值得展开（结构化 info 而不是噪声） */
const _EXPANDABLE = new Set([
  'doc_write', 'report', 'context_loaded', 'degradation', 'inject', 'plan', 'replan',
]);
/** 这些事件带产物路径，要能直接看到/复制 */
const _PATH_KEYS = ['path', 'report_path', 'artifact_path', 'script_path'];

function _pathOf(detail: Record<string, unknown>): string {
  for (const key of _PATH_KEYS) {
    const value = detail[key];
    if (typeof value === 'string' && value) return value;
  }
  const files = detail.files;
  if (Array.isArray(files) && typeof files[0] === 'string') return files[0];
  return '';
}

function EventRow({ event }: { event: TaskEvent }) {
  const [open, setOpen] = useState(false);
  const detail = (event.detail || {}) as Record<string, unknown>;
  const expandable = _EXPANDABLE.has(event.type) && Object.keys(detail).length > 0;
  const path = _pathOf(detail);

  return (
    <li
      className={cn(
        'flex items-start gap-2 text-caption px-2 py-1 rounded-cw-sm',
        event.type === 'tool_result' || event.type === 'step_end' ? 'bg-surface-container' : '',
      )}
      data-event-type={event.type}
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
      <span className="min-w-0 flex-1 text-on-surface break-words">
        {event.message}
        {path && (
          <button
            type="button"
            title="复制路径"
            data-event-path={path}
            className="ml-1 font-mono text-caption text-on-surface-variant/70 underline decoration-dotted hover:text-on-surface"
            onClick={() => { void navigator.clipboard?.writeText(path); }}
          >
            {path.split(/[\\/]/).slice(-2).join('/')}
          </button>
        )}
        {expandable && (
          <>
            <button
              type="button"
              className="ml-1 inline-flex items-center gap-0.5 text-caption text-on-surface-variant/70 hover:text-on-surface"
              aria-expanded={open}
              data-event-detail-toggle={event.seq}
              onClick={() => setOpen((v) => !v)}
            >
              {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              详情
            </button>
            {open && (
              <pre
                data-event-detail={event.seq}
                className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-cw-sm bg-surface-container p-2 text-caption text-on-surface-variant"
              >
                {JSON.stringify(detail, null, 2)}
              </pre>
            )}
          </>
        )}
      </span>
    </li>
  );
}

export function EventFeed({ events, className }: Props) {
  const visible = events.filter((e) => !_NOISY.has(e.type));
  if (visible.length === 0) {
    return (
      <p className="text-caption text-on-surface-variant py-3">
        还没有执行记录。任务开跑后这里会逐条出现「调用了什么、结果如何」。
      </p>
    );
  }
  const capped = events.length >= MAX_TASK_EVENTS;
  return (
    <>
      {capped && (
        <p className="px-2 pb-1 text-caption text-on-surface-variant/60" data-testid="event-feed-cap">
          只保留最近 {MAX_TASK_EVENTS} 条事件（更早的已从内存丢弃，完整记录见任务事件接口）。
        </p>
      )}
      <ol className={cn('space-y-1', className)} aria-label="调用记录">
        {visible.map((event) => (
          <EventRow key={event.seq} event={event} />
        ))}
      </ol>
    </>
  );
}
