/**
 * 任务终态的"为什么结束"（PRD §5 P1-3 / 文案表 §6.1）。
 *
 * 旧界面只渲染 `finish.conclusion`（一句人话），用户看不到 `reason`
 * ——于是 `gate:回合数达到上限 160`、`degradation_unresolved`、
 * `dry_run_preview` 这些**完全不同的结束原因**在 UI 上长得一样。
 *
 * 三条纪律：
 * 1. `reason` 只影响文案，**不改状态**（状态永远以后端 `status` 为准）；
 * 2. 不认识的 reason 原样显示并标注「待适配」，不冒充失败；
 * 3. 老任务没有 finish → 明说"没有保存收尾详情"，不空转。
 */

import { cn } from '@/lib/utils';
import { asText } from '@/lib/render';
import type { TaskFinish, TaskStatus } from '@/types/task';

import { finishReasonLabel } from './labels';

interface Props {
  status: TaskStatus;
  finish: TaskFinish | null;
  className?: string;
}

export function TaskFinishSummary({ status, finish, className }: Props) {
  const reason = finish?.reason || '';
  const completed = finish?.completed ?? [];
  const unfinished = finish?.unfinished ?? [];

  if (!finish) {
    const terminal = ['done', 'failed', 'cancelled', 'unknown_terminal'].includes(status);
    if (!terminal) return null;
    return (
      <div
        className={cn('border-b border-outline-variant/20 px-3 py-2', className)}
        data-testid="task-finish-summary"
      >
        <p className="text-caption text-on-surface-variant/70">
          任务已结束，但该任务没有保存收尾详情。
        </p>
      </div>
    );
  }

  const known = finishReasonLabel(reason);
  const bad = reason.startsWith('gate:') || reason === 'degradation_unresolved'
    || status === 'failed';

  return (
    <div
      className={cn('border-b border-outline-variant/20 px-3 py-2', className)}
      data-testid="task-finish-summary"
      data-reason={reason}
    >
      <p className="mb-1 flex flex-wrap items-baseline gap-2 text-label-sm">
        <span className={bad ? 'text-error' : 'text-on-surface'}>结束原因</span>
        <span
          className={cn('font-medium', bad ? 'text-error' : 'text-on-surface')}
          data-testid="finish-reason"
        >
          {known}
        </span>
        {!known && reason ? (
          <span className="text-caption text-on-surface-variant/60">
            新终态（待适配）：{reason}
          </span>
        ) : null}
      </p>

      {finish.conclusion && (
        <p className="mb-1 whitespace-pre-wrap break-words text-caption text-on-surface-variant"
          data-testid="finish-conclusion">
          {asText(finish.conclusion)}
        </p>
      )}

      {completed.length > 0 && (
        <div className="mt-1">
          <p className="text-caption text-on-surface-variant/70">已完成（{completed.length}）</p>
          <ul className="mt-0.5 space-y-0.5" data-testid="finish-completed">
            {completed.map((item, i) => (
              <li key={`${item}-${i}`} className="text-caption text-primary">· {item}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-1">
        <p className="text-caption text-on-surface-variant/70">
          未完成（{unfinished.length}）
        </p>
        {unfinished.length > 0 ? (
          <ul className="mt-0.5 space-y-0.5" data-testid="finish-unfinished">
            {unfinished.map((item, i) => (
              <li key={`${item}-${i}`} className="text-caption text-error/90">· {item}</li>
            ))}
          </ul>
        ) : (
          <p className="mt-0.5 text-caption text-on-surface-variant/60"
            data-testid="finish-unfinished-empty">
            没有记录未完成事项
          </p>
        )}
      </div>
    </div>
  );
}
