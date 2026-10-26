/**
 * 任务运行标签（PRD §19.3 / 需求 9）
 *
 * 主 agent 的一切都在编辑器里：日志、工具、Skill、阶段、汇报、思考，以及底部"正在运行的子 agent"。
 * 数据源只有两处：任务事件 SSE（`useTaskEvents`）+ 子 agent 快照（`supervisorApi.getSubagents`）。
 */
import React from 'react';
import { useTaskStore } from '@/stores/taskStore';
import { useTaskEvents } from '@/features/task/useTaskEvents';
import { EventFeed } from '@/features/task/EventFeed';
import { PlanPanel } from '@/features/task/PlanPanel';
import { TaskArtifacts } from '@/features/task/TaskArtifacts';
import { TaskToolbar } from '@/features/task/TaskToolbar';
import { ThinkingDisclosure } from './ThinkingDisclosure';
import { RunningSubagents } from './RunningSubagents';

function StageRows({ events }: { events: ReturnType<typeof useTaskStore.getState>['events'] }) {
  const stages = React.useMemo(() => {
    const map = new Map<string, { stage: string; status: string; summary?: string; cost?: number }>();
    for (const ev of events) {
      const detail = (ev.detail || {}) as Record<string, unknown>;
      const stage = String(detail.stage || '');
      if (!stage) continue;
      if (ev.type === 'step_start') map.set(stage, { stage, status: 'running' });
      if (ev.type === 'step_end') {
        map.set(stage, {
          stage,
          status: String(detail.status || ''),
          summary: detail.summary ? String(detail.summary) : undefined,
          cost: typeof detail.cost_usd === 'number' ? detail.cost_usd : undefined,
        });
      }
    }
    return Array.from(map.values());
  }, [events]);

  if (!stages.length) return null;
  return (
    <div className="border-b border-outline-variant/20 px-3 py-2" data-testid="stage-rows">
      <p className="mb-1 text-label-sm text-on-surface-variant">阶段</p>
      <ul className="space-y-1">
        {stages.map((s) => (
          <li key={s.stage} className="flex items-baseline gap-2 text-caption">
            <span className="w-20 shrink-0 text-on-surface-variant">{s.stage}</span>
            <span className="shrink-0 text-primary">{s.status}</span>
            <span className="truncate text-on-surface-variant/80">{s.summary || ''}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CopilotTaskRunTab({ taskId }: { taskId: string }) {
  useTaskEvents(taskId || null, Boolean(taskId));
  const task = useTaskStore((s) => s.task);
  const events = useTaskStore((s) => s.events);
  const busy = useTaskStore((s) => s.loading);
  const pause = useTaskStore((s) => s.pause);
  const resume = useTaskStore((s) => s.resume);
  const cancel = useTaskStore((s) => s.cancel);
  const inject = useTaskStore((s) => s.inject);

  if (!taskId) {
    return (
      <div className="p-3 text-caption text-on-surface-variant">
        还没有运行中的任务：从「需求对话」确认规划书后会自动打开这里。
      </div>
    );
  }

  const status = task?.status ?? 'running';
  const terminal = ['done', 'failed', 'cancelled'].includes(status);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="task-run-tab">
      <div className="border-b border-outline-variant/20 px-3 py-2">
        <TaskToolbar
          status={status}
          busy={busy}
          onPause={() => void pause(taskId)}
          onResume={() => void resume(taskId)}
          onCancel={() => void cancel(taskId)}
          onInject={(text) => void inject(taskId, text)}
        />
        {task?.finish?.conclusion && (
          <p className="mt-1 text-caption text-on-surface-variant" data-testid="task-conclusion">
            {task.finish.conclusion}
          </p>
        )}
      </div>

      <ThinkingDisclosure events={events} />
      {task && <PlanPanel task={task} busy={busy} />}
      <StageRows events={events} />

      <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
        <EventFeed events={events} />
      </div>

      <RunningSubagents taskId={taskId} active={!terminal} />
      <TaskArtifacts taskId={taskId} enabled={terminal} />
    </div>
  );
}
