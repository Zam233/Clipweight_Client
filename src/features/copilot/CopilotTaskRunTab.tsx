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
import { supervisorApi } from '@/services/api';
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

/**
 * 工具调用：把 tool_call 与**它自己**的 tool_result 配对。
 *
 * B12/N6：旧实现按工具名配对，同名工具并发时（例如两个 `local_probe` 同时跑）
 * 会把 A 的结果挂到 B 上、把 B 的耗时算给 A。现在优先用 `causation_id`
 * （后端对 tool_result 写的是 `seq:<调用事件序号>`），没有该字段的老数据才回落到
 * 按名字 FIFO 配对，并在行上标 `paired=causation|name`，让"猜的"看得出来。
 */
export function pairToolCalls(events: Ev) {
  const callsBySeq = new Map<number, { tool: string; args?: unknown }>();
  const pendingByName = new Map<string, number[]>();
  const rows: {
    seq: number;
    tool: string;
    status: string;
    ms?: number;
    error?: string;
    paired: 'causation' | 'name';
  }[] = [];

  for (const e of events) {
    const detail = (e.detail || {}) as Record<string, unknown>;
    if (e.type === 'tool_call') {
      const tool = String(detail.tool || e.message || '');
      callsBySeq.set(e.seq, { tool, args: detail.args });
      const queue = pendingByName.get(tool) ?? [];
      queue.push(e.seq);
      pendingByName.set(tool, queue);
      continue;
    }
    if (e.type !== 'tool_result') continue;
    const tool = String(detail.tool || '');
    const causation = String(e.causation_id || '');
    let callSeq: number | undefined;
    let paired: 'causation' | 'name' = 'causation';
    if (causation.startsWith('seq:')) {
      const target = Number(causation.slice(4));
      if (Number.isFinite(target) && callsBySeq.has(target)) callSeq = target;
    }
    if (callSeq === undefined) {
      const queue = pendingByName.get(tool) ?? [];
      callSeq = queue.shift();
      paired = 'name';
    } else {
      const queue = pendingByName.get(tool) ?? [];
      const idx = queue.indexOf(callSeq);
      if (idx >= 0) queue.splice(idx, 1);
    }
    if (callSeq === undefined) continue;
    rows.push({
      seq: callSeq,
      tool: (callsBySeq.get(callSeq)?.tool || tool),
      status: String(detail.status || ''),
      ms: typeof detail.duration_ms === 'number' ? detail.duration_ms : undefined,
      error: detail.error ? String(detail.error) : undefined,
      paired,
    });
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
          <li key={r.seq} className="flex items-baseline gap-2 text-caption" data-paired={r.paired}>
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
            {r.paired === 'name' && (
              // 老事件没有 causation_id：按名字配的，可能是并发的同名调用
              <span className="shrink-0 text-on-surface-variant/40">按名配对</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * 授权请求：等授权**不是失败**，必须单独显示，否则用户以为任务挂了。
 *
 * B11（2026-10-28 PRD / 缺口 N4）：旧实现只有一行日志——用户看得到"待授权"却
 * **没有提交入口**，任务就永久停在 paused。现在每条 `approval_request` 直接给出
 * 「授权 / 拒绝」，命中高风险时要求二次确认（与后端两级确认一致）；提交结果以
 * 可读文案回显，失败如实说明（不假装已授权）。
 */
function ApprovalRows({ events, taskId }: { events: Ev; taskId: string }) {
  const [busyId, setBusyId] = React.useState('');
  const [note, setNote] = React.useState<Record<string, string>>({});

  const rows = React.useMemo(
    () => events.filter((e) => e.type === 'approval_request' || e.type === 'approval_result'),
    [events],
  );
  if (!rows.length) return null;

  const submit = async (approvalId: string, risk: string, approve: boolean) => {
    if (!approvalId || !taskId) return;
    const highRisk = risk === 'high' || risk === 'critical';
    if (approve && highRisk && !window.confirm(
      `这条操作被判定为 ${risk} 风险，确认授权？`,
    )) return;
    setBusyId(approvalId);
    try {
      if (approve) {
        await supervisorApi.approveExec(
          taskId, approvalId, highRisk, risk === 'critical',
        );
        setNote((n) => ({ ...n, [approvalId]: '已授权' }));
      } else {
        await supervisorApi.rejectExec(taskId, approvalId);
        setNote((n) => ({ ...n, [approvalId]: '已拒绝' }));
      }
    } catch (e) {
      setNote((n) => ({
        ...n,
        [approvalId]: `提交失败：${(e as Error)?.message || '未知错误'}`,
      }));
    } finally {
      setBusyId('');
    }
  };

  return (
    <div className="border-b border-outline-variant/20 px-3 py-2" data-testid="approval-rows">
      <p className="mb-1 text-label-sm text-on-surface-variant">授权</p>
      <ul className="space-y-1">
        {rows.map((e) => {
          const detail = (e.detail || {}) as Record<string, unknown>;
          const approvalId = String(detail.approval_id || '');
          const risk = String(detail.risk || '');
          const pending = e.type === 'approval_request' && !detail.status;
          return (
            <li key={e.seq} className="flex flex-wrap items-baseline gap-2 text-caption">
              <span className="w-16 shrink-0 text-on-surface-variant/70">
                {e.type === 'approval_request' ? '待授权' : '结果'}
              </span>
              <span className="truncate">{e.message}</span>
              {risk ? (
                <span className="shrink-0 text-error/80">risk={risk}</span>
              ) : null}
              {pending && approvalId && (
                <span className="ml-auto flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    data-approval-approve={approvalId}
                    disabled={busyId === approvalId}
                    className="rounded-cw-xs border border-outline-variant/50 px-2 py-0.5 text-primary hover:border-primary disabled:opacity-50"
                    onClick={() => void submit(approvalId, risk, true)}
                  >
                    授权
                  </button>
                  <button
                    type="button"
                    data-approval-reject={approvalId}
                    disabled={busyId === approvalId}
                    className="rounded-cw-xs border border-outline-variant/50 px-2 py-0.5 text-on-surface-variant hover:border-error hover:text-error disabled:opacity-50"
                    onClick={() => void submit(approvalId, risk, false)}
                  >
                    拒绝
                  </button>
                </span>
              )}
              {note[approvalId] && (
                <span
                  className="shrink-0 text-on-surface-variant/70"
                  data-approval-note={approvalId}
                >
                  {note[approvalId]}
                </span>
              )}
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
      <ApprovalRows events={events} taskId={taskId} />

      <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
        <EventFeed events={events} />
      </div>

      <RunningSubagents taskId={taskId} active={!terminal} />
      <TaskArtifacts taskId={taskId} enabled={terminal} />
    </div>
  );
}
