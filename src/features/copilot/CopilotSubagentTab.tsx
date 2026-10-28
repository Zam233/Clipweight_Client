/**
 * 子 agent 详情标签（PRD §19.3；B11 / 缺口 N3 改造）。
 *
 * 数据源改为**任务事件** `agent_run_*`：新路线下子 agent 就是一次 AgentRun，
 * `agent_run_start/update/end` 随任务 SSE 到达，带 status/failure/needs/report_path。
 * 旧的 `GET /api/pipeline/{id}/subagents`（tracker 快照）对新路线永远是空的——
 * 拿它当唯一来源会让"子 agent 详情"长期显示"已结束或不存在"。
 *
 * 兼容策略：事件里找不到该 run 时，回落到 supervisor 快照，并**明说是快照**。
 */
import React from 'react';
import { supervisorApi } from '@/services/api';
import { useTaskStore } from '@/stores/taskStore';
import type { TaskEvent } from '@/types/task';

interface Node {
  id: string;
  role?: string;
  status?: string;
  cost_usd?: number;
  duration_ms?: number;
  last_output?: string;
}

export interface RunDetail {
  runId: string;
  label: string;
  status: string;
  summary: string;
  cost?: number;
  durationMs?: number;
  reportPath?: string;
  failure?: Record<string, unknown>;
  needs: Array<Record<string, unknown>>;
  replayed?: boolean;
}

/** 从任务事件里折叠出某个 run 的最终详情（同 run_id 后到的覆盖先到的）。 */
export function foldRunDetail(events: TaskEvent[], runId: string): RunDetail | null {
  // 用持有对象而不是裸 let：否则 TS 会把首轮收缩成 null，后续 prev 全变 never
  const acc: { detail: RunDetail | null } = { detail: null };
  for (const ev of events) {
    if (!['agent_run_start', 'agent_run_update', 'agent_run_end'].includes(ev.type)) continue;
    const d = (ev.detail || {}) as Record<string, unknown>;
    if (String(d.run_id || '') !== runId) continue;
    const prev = acc.detail;
    acc.detail = {
      runId,
      label: String(d.stage || d.role || d.kind || '') || prev?.label || '子 agent',
      status: ev.type === 'agent_run_start'
        ? 'running'
        : String(d.status || (ev.type === 'agent_run_end' ? 'done' : prev?.status || 'running')),
      summary: String(d.summary || prev?.summary || ''),
      cost: typeof d.cost_usd === 'number' ? d.cost_usd : prev?.cost,
      durationMs: typeof d.duration_ms === 'number' ? d.duration_ms : prev?.durationMs,
      reportPath: String(d.report_path || prev?.reportPath || '') || undefined,
      failure: (d.failure as Record<string, unknown> | undefined) ?? prev?.failure,
      needs: Array.isArray(d.needs)
        ? (d.needs as Array<Record<string, unknown>>)
        : (prev?.needs ?? []),
      replayed: Boolean(d.replayed) || Boolean(prev?.replayed),
    };
  }
  return acc.detail;
}

export function CopilotSubagentTab({ taskId, subagentId }: { taskId?: string; subagentId?: string }) {
  const events = useTaskStore((s) => s.events);
  const [snapshot, setSnapshot] = React.useState<Node | null>(null);
  const [error, setError] = React.useState('');
  const run = React.useMemo(
    () => (taskId && subagentId ? foldRunDetail(events, subagentId) : null),
    [events, subagentId, taskId],
  );

  React.useEffect(() => {
    let alive = true;
    // 事件已能回答就不打 tracker（它对新路线为空，还会把"没有"说成"已结束"）
    if (!taskId || !subagentId || run) return undefined;
    const load = async () => {
      try {
        const res = await supervisorApi.getSubagents(taskId);
        if (!alive) return;
        const list = ((res as { tree?: Node[]; nodes?: Node[] }).tree
          ?? (res as { nodes?: Node[] }).nodes ?? []) as Node[];
        setSnapshot(list.find((n) => n.id === subagentId) ?? null);
      } catch (e) {
        if (alive) setError(String((e as Error)?.message || e));
      }
    };
    void load();
    return () => { alive = false; };
  }, [taskId, subagentId, run]);

  if (!taskId || !subagentId) {
    return <div className="p-3 text-caption text-on-surface-variant">缺少子 agent 标识。</div>;
  }
  if (run) {
    return (
      <div className="space-y-2 p-3 text-caption" data-testid="subagent-tab" data-source="events">
        <p className="text-label-sm text-on-surface">{run.label}</p>
        <dl className="grid grid-cols-[80px_1fr] gap-1 text-on-surface-variant">
          <dt>状态</dt>
          <dd className="text-on-surface" data-run-status={run.status}>
            {run.status}
            {run.replayed && <span className="ml-1 text-on-surface-variant/60">（回放）</span>}
          </dd>
          <dt>成本</dt>
          <dd className="text-on-surface">
            {run.cost == null ? '未知' : `$${run.cost.toFixed(4)}`}
          </dd>
          <dt>耗时</dt>
          <dd className="text-on-surface">{run.durationMs ? `${run.durationMs}ms` : '—'}</dd>
          {run.reportPath && (
            <>
              <dt>报告</dt>
              <dd className="break-all text-on-surface">{run.reportPath}</dd>
            </>
          )}
        </dl>
        {run.failure && (
          <div data-testid="subagent-failure">
            <p className="text-error">失败原因</p>
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-cw-sm bg-surface-container p-2 text-error/90">
              {String(run.failure.blocking_point || run.failure.category || '')}
              {run.failure.retryable ? `（retryable=${String(run.failure.retryable)}）` : ''}
            </pre>
          </div>
        )}
        {run.needs.length > 0 && (
          <div data-testid="subagent-needs">
            <p className="text-on-surface-variant/70">还缺什么</p>
            <ul className="mt-1 space-y-0.5">
              {run.needs.slice(0, 5).map((need, i) => (
                <li key={i} className="text-on-surface-variant">
                  · {String(need.field || need.name || '输入')}
                  {need.from_stage || need.from
                    ? `（来自 ${String(need.from_stage || need.from)}）`
                    : ''}
                </li>
              ))}
            </ul>
          </div>
        )}
        {run.summary && (
          <>
            <p className="text-on-surface-variant/70">结论</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-cw-sm bg-surface-container p-2">
              {run.summary}
            </pre>
          </>
        )}
        {!run.summary && run.status === 'running' && (
          <p className="text-on-surface-variant/70">还在跑，暂无结论。</p>
        )}
      </div>
    );
  }
  if (error) return <div className="p-3 text-caption text-error">加载失败：{error}</div>;
  if (!snapshot) {
    return (
      <div className="p-3 text-caption text-on-surface-variant">
        这个子 agent 没有事件记录（可能还没开始，或来自旧任务）。
      </div>
    );
  }

  return (
    <div className="space-y-2 p-3 text-caption" data-testid="subagent-tab" data-source="snapshot">
      <p className="text-label-sm text-on-surface">{snapshot.role || snapshot.id}</p>
      <p className="text-caption text-on-surface-variant/60">
        数据来自 supervisor 快照（该 run 没有 agent_run_* 事件）
      </p>
      <dl className="grid grid-cols-[80px_1fr] gap-1 text-on-surface-variant">
        <dt>状态</dt><dd className="text-on-surface">{snapshot.status || '—'}</dd>
        <dt>成本</dt>
        <dd className="text-on-surface">
          {snapshot.cost_usd == null ? '未知' : `$${snapshot.cost_usd}`}
        </dd>
        <dt>耗时</dt>
        <dd className="text-on-surface">
          {snapshot.duration_ms ? `${snapshot.duration_ms}ms` : '—'}
        </dd>
      </dl>
      {snapshot.last_output && (
        <>
          <p className="text-on-surface-variant/70">输出结论</p>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-cw-sm bg-surface-container p-2">
            {snapshot.last_output}
          </pre>
        </>
      )}
    </div>
  );
}
