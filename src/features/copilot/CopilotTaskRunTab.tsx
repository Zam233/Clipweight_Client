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

type Ev = ReturnType<typeof useTaskStore.getState>['events'];

/** 模型轮次：`thinking` + `intent` + `narration` 都算"它在想/在说"，按到达顺序合并。
 *
 * B2（2026-10-28 PRD）：工具调用**之前**的 narration（`detail.kind === "preamble"`）
 * 标成「动手前」，用户能看清"它先说要做这个，然后才调工具"。
 */
function ModelTurnRows({ events }: { events: Ev }) {
  const turns = React.useMemo(
    () => events.filter((e) => ['intent', 'narration', 'thinking'].includes(e.type)).slice(-6),
    [events],
  );
  if (!turns.length) return null;
  return (
    <div className="border-b border-outline-variant/20 px-3 py-2" data-testid="model-turn-rows">
      <p className="mb-1 text-label-sm text-on-surface-variant">模型轮次</p>
      <ul className="space-y-1">
        {turns.map((e) => {
          const detail = (e.detail || {}) as Record<string, unknown>;
          const isPreamble = e.type === 'narration' && detail.kind === 'preamble';
          return (
            <li
              key={e.seq}
              className="flex items-baseline gap-2 text-caption"
              data-event-type={e.type}
              data-preamble={isPreamble ? 'true' : undefined}
            >
              <span className="w-16 shrink-0 text-on-surface-variant/70">
                {isPreamble ? '动手前' : e.type}
              </span>
              <span className="truncate text-on-surface-variant/90">{e.message}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** 工具调用：把 tool_call 与紧随其后的 tool_result 配对，显示状态与耗时。 */
export function pairToolCalls(events: Ev) {
  const pending = new Map<string, { seq: number; tool: string; args?: unknown }>();
  const rows: { seq: number; tool: string; status: string; ms?: number; error?: string }[] = [];
  for (const e of events) {
    const detail = (e.detail || {}) as Record<string, unknown>;
    if (e.type === 'tool_call') {
      const tool = String(detail.tool || e.message || '');
      pending.set(tool, { seq: e.seq, tool, args: detail.args });
      continue;
    }
    if (e.type === 'tool_result') {
      const tool = String(detail.tool || '');
      const call = pending.get(tool);
      if (!call) continue;
      pending.delete(tool);
      rows.push({
        seq: call.seq,
        tool,
        status: String(detail.status || ''),
        ms: typeof detail.duration_ms === 'number' ? detail.duration_ms : undefined,
        error: detail.error ? String(detail.error) : undefined,
      });
    }
  }
  return rows;
}

function ToolCallRows({ events }: { events: Ev }) {
  const rows = React.useMemo(() => pairToolCalls(events).slice(-8), [events]);
  if (!rows.length) return null;
  return (
    <div className="border-b border-outline-variant/20 px-3 py-2" data-testid="tool-call-rows">
      <p className="mb-1 text-label-sm text-on-surface-variant">工具调用</p>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.seq} className="flex items-baseline gap-2 text-caption">
            <span className="w-36 shrink-0 truncate font-mono text-on-surface-variant">{r.tool}</span>
            <span
              className={r.status === 'ok' ? 'shrink-0 text-primary' : 'shrink-0 text-error'}
              data-tool-status={r.status}
            >
              {r.status}
            </span>
            {typeof r.ms === 'number' && (
              <span className="shrink-0 text-on-surface-variant/60">{r.ms}ms</span>
            )}
            {r.error && <span className="truncate text-error/80">{r.error}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** 授权请求：等授权**不是失败**，必须单独显示，否则用户以为任务挂了。 */
function ApprovalRows({ events }: { events: Ev }) {
  const rows = React.useMemo(
    () => events.filter((e) => e.type === 'approval_request' || e.type === 'approval_result'),
    [events],
  );
  if (!rows.length) return null;
  return (
    <div className="border-b border-outline-variant/20 px-3 py-2" data-testid="approval-rows">
      <p className="mb-1 text-label-sm text-on-surface-variant">授权</p>
      <ul className="space-y-1">
        {rows.map((e) => {
          const detail = (e.detail || {}) as Record<string, unknown>;
          return (
            <li key={e.seq} className="flex items-baseline gap-2 text-caption">
              <span className="w-16 shrink-0 text-on-surface-variant/70">
                {e.type === 'approval_request' ? '待授权' : '结果'}
              </span>
              <span className="truncate">{e.message}</span>
              {detail.risk ? (
                <span className="shrink-0 text-error/80">risk={String(detail.risk)}</span>
              ) : null}
            </li>
          );
        })}
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
      <ModelTurnRows events={events} />
      <ToolCallRows events={events} />
      <ApprovalRows events={events} />

      <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
        <EventFeed events={events} />
      </div>

      <RunningSubagents taskId={taskId} active={!terminal} />
      <TaskArtifacts taskId={taskId} enabled={terminal} />
    </div>
  );
}
