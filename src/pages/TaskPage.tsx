/**
 * 任务工作台（路线 C / C4）—— 新的主界面。
 *
 * 它替代的不是"管线的某个面板"，而是**整条交互线**：
 * 一句话需求 → 计划（先看再花）→ 执行（每步可见）→ 收尾（结论/已完成/未完成）。
 *
 * 三个刻意的产品决定：
 * 1. 计划默认先给看（Q3），「按计划执行」是唯一花钱的按钮；
 * 2. 上限（回合/调用数/时长）常驻可见——用户有权知道什么时候会被停；
 * 3. 未配置模型单价时**明说只统计 token**，不显示一个骗人的 $0.0000。
 */

import { useEffect, useMemo, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { AlertTriangle, CheckCircle2, Clock, Coins } from 'lucide-react';

import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import { useTaskStore } from '@/stores/taskStore';

import { EventFeed } from '@/features/task/EventFeed';
import { PlanPanel } from '@/features/task/PlanPanel';
import { TaskArtifacts } from '@/features/task/TaskArtifacts';
import { TaskSubagents } from '@/features/task/TaskSubagents';
import { TaskToolbar } from '@/features/task/TaskToolbar';
import { durationText, moneyText, statusLabel } from '@/features/task/labels';
import { useTaskEvents } from '@/features/task/useTaskEvents';

export function TaskPage() {
  const params = useParams({ strict: false }) as { taskId?: string };
  const taskId = params.taskId ?? null;

  const task = useTaskStore((s) => s.task);
  const events = useTaskStore((s) => s.events);
  const error = useTaskStore((s) => s.error);
  const loading = useTaskStore((s) => s.loading);
  const load = useTaskStore((s) => s.load);
  const hydrateEvents = useTaskStore((s) => s.hydrateEvents);
  const rep = useTaskStore((s) => s.replan);
  const start = useTaskStore((s) => s.start);
  const pause = useTaskStore((s) => s.pause);
  const resume = useTaskStore((s) => s.resume);
  const cancel = useTaskStore((s) => s.cancel);
  const inject = useTaskStore((s) => s.inject);
  const [busy, setBusy] = useState(false);

  const terminal = task ? ['done', 'failed', 'cancelled'].includes(task.status) : false;

  useEffect(() => {
    if (!taskId) return;
    void load(taskId);
    void hydrateEvents(taskId);
  }, [taskId, load, hydrateEvents]);

  // 跑到终态就不必再挂着 SSE（省一条连接）
  useTaskEvents(taskId, Boolean(taskId) && !terminal);

  const usage = task?.usage;
  const limitText = useMemo(() => {
    if (!task) return '';
    const l = task.limits;
    const budget = l.budget_usd === null || l.budget_usd === undefined
      ? '预算不限'
      : `预算 ${moneyText(l.budget_usd)}`;
    return `上限：${l.max_turns} 回合 · ${l.max_tool_calls} 次调用 · ${durationText(l.max_wall_sec)} · ${budget}`;
  }, [task]);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  if (!taskId) {
    return (
      <div className="p-6 text-caption text-on-surface-variant">
        没有指定任务。请从首页输入一句话开始。
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-y-auto bg-surface text-on-surface">
      <div className="mx-auto max-w-4xl px-6 py-6 space-y-4">
        <header className="space-y-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-title text-on-surface">
              {task?.request.topic || '加载中…'}
            </h1>
            {task && (
              <Badge
                variant={
                  task.status === 'done'
                    ? 'success'
                    : task.status === 'failed'
                      ? 'error'
                      : 'info'
                }
              >
                {statusLabel(task.status)}
              </Badge>
            )}
            {task && <span className="text-caption font-mono text-on-surface-variant">{task.id}</span>}
          </div>
          <p className="text-caption text-on-surface-variant">{limitText}</p>
        </header>

        {error && (
          <p className="text-caption text-error flex items-center gap-1">
            <AlertTriangle className="w-3.5 h-3.5" /> {error}
          </p>
        )}
        {loading && <p className="text-caption text-on-surface-variant">加载中…</p>}

        {usage && (
          <div className="flex items-center gap-4 text-caption text-on-surface-variant">
            <span className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" /> {usage.turns} 回合 · {usage.tool_calls} 次调用 ·
              {' '}{durationText(usage.wall_sec)}
            </span>
            <span className="flex items-center gap-1">
              <Coins className="w-3.5 h-3.5" /> {usage.tokens} tokens ·{' '}
              {moneyText(usage.cost_usd)}
            </span>
          </div>
        )}

        {task && (
          <TaskToolbar
            status={task.status}
            busy={busy}
            onPause={() => void act(() => pause(task.id))}
            onResume={() =>
              void act(async () => {
                // pending（还没开跑）走 start，paused 走 resume
                if (task.status === 'pending') await start(task.id);
                else await resume(task.id);
              })
            }
            onCancel={() => void act(() => cancel(task.id))}
            onInject={(text) => void act(() => inject(task.id, text))}
          />
        )}

        {task && (
          <PlanPanel
            task={task}
            busy={busy}
            onStart={() => void act(() => start(task.id))}
            onReplan={() => void act(() => rep(task.id))}
          />
        )}

        {task?.finish && (
          <section
            className={cn(
              'rounded-cw-md border p-3 space-y-1.5',
              task.status === 'done'
                ? 'border-success/40 bg-success/5'
                : 'border-warning/40 bg-warning/5',
            )}
            aria-label="任务收尾"
          >
            <p className="flex items-center gap-1.5 text-body-sm text-on-surface">
              <CheckCircle2 className="w-4 h-4" /> {task.finish.conclusion}
            </p>
            {task.finish.completed.length > 0 && (
              <p className="text-caption text-on-surface-variant">
                已完成：{task.finish.completed.join('、')}
              </p>
            )}
            {task.finish.unfinished.length > 0 && (
              <p className="text-caption text-warning">
                未完成：{task.finish.unfinished.join('；')}
              </p>
            )}
            <p className="text-caption text-on-surface-variant">
              结束原因：{task.finish.reason}
            </p>
          </section>
        )}

        <section className="space-y-1.5">
          <h2 className="text-body-sm font-semibold text-on-surface">调用记录</h2>
          <EventFeed events={events} />
        </section>

        <TaskSubagents taskId={taskId} active={!terminal} />

        <TaskArtifacts taskId={taskId} enabled={terminal || Boolean(task?.plan)} />

        {terminal && (
          <p className="text-caption text-on-surface-variant">
            任务已结束。想再来一版？
            <Button
              size="sm"
              variant="ghost"
              className="ml-1"
              onClick={() => void act(() => rep(task!.id))}
              disabled={busy}
            >
              再规划一次
            </Button>
          </p>
        )}
      </div>
    </div>
  );
}
