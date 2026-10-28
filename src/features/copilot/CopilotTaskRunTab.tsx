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
import { parseTaskEvent } from '@/features/task/eventSchema';
import { supervisorApi } from '@/services/api';
import { ThinkingDisclosure } from './ThinkingDisclosure';
import { RunningSubagents } from './RunningSubagents';

function StageRows({ events }: { events: ReturnType<typeof useTaskStore.getState>['events'] }) {
  const stages = React.useMemo(() => {
    const map = new Map<string, { stage: string; status: string; summary?: string; cost?: number }>();
    // PRD B5：字段经 parser 读取（不再各处 `detail as Record` 猜键）
    for (const ev of events) {
      const parsed = parseTaskEvent(ev);
      if (parsed.kind !== 'step_start' && parsed.kind !== 'step_end') continue;
      const { stage, status, summary, cost_usd } = parsed.stage;
      if (!stage) continue;
      if (parsed.kind === 'step_start') map.set(stage, { stage, status: 'running' });
      else map.set(stage, { stage, status: status ?? '', summary, cost: cost_usd });
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

/**
 * 用量与成本（PRD B7 / G11）。
 *
 * 关键点：后端 `cost_usd` **不包含**"成本未知"的调用（`unknown_cost_calls`）。
 * 只显示金额会让用户把未知读成 0，所以未知次数必须显式写出来。
 */
function UsageRows({ usage, unknownCostCalls }: {
  usage: { turns: number; tool_calls: number; tokens: number; cost_usd: number; wall_sec: number };
  unknownCostCalls: number;
}) {
  const hasCost = usage.cost_usd > 0;
  return (
    <div
      className="border-b border-outline-variant/20 px-3 py-2 text-caption"
      data-testid="usage-rows"
    >
      <p className="mb-1 text-label-sm text-on-surface-variant">用量</p>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-on-surface-variant">
        <span>模型往返 <b className="font-mono text-on-surface">{usage.turns}</b></span>
        <span>工具调用 <b className="font-mono text-on-surface">{usage.tool_calls}</b></span>
        <span>tokens <b className="font-mono text-on-surface">{usage.tokens.toLocaleString()}</b></span>
        <span>
          成本 <b className="font-mono text-on-surface">{hasCost ? `$${usage.cost_usd.toFixed(4)}` : '—'}</b>
          {!hasCost && <span className="ml-1 text-on-surface-variant/60">（未配置单价或暂无计费）</span>}
        </span>
        {unknownCostCalls > 0 && (
          <span className="text-error" data-testid="unknown-cost">
            未知成本 {unknownCostCalls} 次（这些调用未计入金额，不能当 0）
          </span>
        )}
      </div>
    </div>
  );
}

/** 模型轮次：`thinking` + `intent` + `narration` 都算"它在想/在说"，按到达顺序合并。
 *
 * B2（2026-10-28 PRD）：工具调用**之前**的 narration（`detail.kind === "preamble"`）
 * 标成「动手前」，用户能看清"它先说要做这个，然后才调工具"。
 */
function ModelTurnRows({ events }: { events: Ev }) {
  const turns = React.useMemo(
    () => events
      .map((e) => ({ event: e, parsed: parseTaskEvent(e) }))
      .filter((x) => ['intent', 'narration', 'thinking'].includes(x.event.type))
      .slice(-6),
    [events],
  );
  if (!turns.length) return null;
  return (
    <div className="border-b border-outline-variant/20 px-3 py-2" data-testid="model-turn-rows">
      <p className="mb-1 text-label-sm text-on-surface-variant">模型轮次</p>
      <ul className="space-y-1">
        {turns.map(({ event: e, parsed }) => {
          const isPreamble = e.type === 'narration'
            && parsed.kind === 'narration' && parsed.turn.kind === 'preamble';
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
    const parsed = parseTaskEvent(e);
    if (parsed.kind === 'tool_call') {
      const tool = parsed.tool.tool || e.message || '';
      callsBySeq.set(e.seq, { tool, args: parsed.tool.args });
      const queue = pendingByName.get(tool) ?? [];
      queue.push(e.seq);
      pendingByName.set(tool, queue);
      continue;
    }
    if (parsed.kind !== 'tool_result') continue;
    const tool = parsed.tool.tool;
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
      status: parsed.tool.status ?? '',
      ms: parsed.tool.duration_ms,
      error: parsed.tool.error,
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
          const parsed = parseTaskEvent(e);
          if (parsed.kind !== 'approval_request' && parsed.kind !== 'approval_result') {
            return null;
          }
          const approvalId = parsed.approval.approval_id ?? '';
          const risk = parsed.approval.risk ?? '';
          const pending = parsed.kind === 'approval_request' && !parsed.approval.status;
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

/**
 * 降级与忽略（PRD B7 / G17）。
 *
 * 后端 `note_degradation(kind, detail, scope, impact)` 会把「不支持的参数被忽略」
 * 「模型降级」等如实记进 `degradation` 事件。Provider 页只展示**配置值**，真正
 * 是否生效要看这里——两处刻意分开，避免把"保存了"当成"生效了"。
 */
function DegradationRows({ events }: { events: Ev }) {
  const rows = React.useMemo(
    () => events
      .map((e) => parseTaskEvent(e))
      .filter((p) => p.kind === 'degradation')
      .slice(-6),
    [events],
  );
  if (!rows.length) return null;
  return (
    <div className="border-b border-outline-variant/20 px-3 py-2" data-testid="degradation-rows">
      <p className="mb-1 text-label-sm text-warning">
        降级与忽略（{rows.length}）
      </p>
      <ul className="space-y-0.5">
        {rows.map((p) => {
          const raw = p.raw as Record<string, unknown>;
          const detail = String(raw.detail ?? p.message ?? '');
          const scope = String(raw.scope ?? raw.kind ?? '');
          const impact = String(raw.impact ?? '');
          return (
            <li key={p.seq} className="text-caption text-on-surface-variant" data-degradation-seq={p.seq}>
              {scope && <span className="mr-1 font-mono text-warning/80">{scope}</span>}
              {detail}
              {impact && <span className="ml-1 text-on-surface-variant/60">（{impact}）</span>}
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
  const error = useTaskStore((s) => s.error);
  const pause = useTaskStore((s) => s.pause);
  const resume = useTaskStore((s) => s.resume);
  const cancel = useTaskStore((s) => s.cancel);
  const inject = useTaskStore((s) => s.inject);
  // PRD B11：「查看结果」滚到产物区（终态任务不重新跑，只让人看结论）
  const [showArtifacts, setShowArtifacts] = React.useState(false);
  const artifactsRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (showArtifacts) {
      setShowArtifacts(false);
      artifactsRef.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [showArtifacts]);

  if (!taskId) {
    return (
      <div className="p-3 text-caption text-on-surface-variant">
        还没有运行中的任务：从「需求对话」确认规划书后会自动打开这里。
      </div>
    );
  }

  const status = task?.status ?? 'running';
  const terminal = ['done', 'failed', 'cancelled', 'unknown_terminal'].includes(status);

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
          onViewResult={() => setShowArtifacts(true)}
        />
        {/* PRD B11：resume 被后端拒绝（终态）时，原因来自 store.error——显示在工具条下方 */}
        {error && (
          <p className="mt-1 text-caption text-error" data-testid="task-error">{error}</p>
        )}
        {task?.finish?.conclusion && (
          <p className="mt-1 text-caption text-on-surface-variant" data-testid="task-conclusion">
            {task.finish.conclusion}
          </p>
        )}
      </div>

      {task && (
        <UsageRows
          usage={task.usage}
          unknownCostCalls={task.usage.unknown_cost_calls ?? 0}
        />
      )}

      <ThinkingDisclosure events={events} />
      {/* PRD B6：Plan 是「初始假设」，真实进展只认事件——两块在视觉上分开 */}
      {task && <PlanPanel task={task} busy={busy} />}
      <p
        className="border-b border-outline-variant/20 bg-surface-container/40 px-3 py-1 text-label-sm text-on-surface"
        data-testid="real-progress-heading"
      >
        真实进展（来自事件）
        <span className="ml-2 text-caption text-on-surface-variant/70">
          上方 Plan 只是初始假设，不追踪进度
        </span>
      </p>
      <StageRows events={events} />
      <ModelTurnRows events={events} />
      <ToolCallRows events={events} />
      <ApprovalRows events={events} taskId={taskId} />
      <DegradationRows events={events} />

      <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
        <EventFeed events={events} />
      </div>

      <RunningSubagents taskId={taskId} active={!terminal} />
      <div ref={artifactsRef}>
        <TaskArtifacts taskId={taskId} enabled={terminal} />
      </div>
    </div>
  );
}
