/**
 * 底部"正在运行的子 agent"（PRD §19.3 / 需求 9；closeout B9 改造）。
 *
 * **数据源改为任务事件**：`agent_run_start` / `agent_run_update` / `agent_run_end`
 * 都随任务 SSE 到达，不再轮询 `GET /api/pipeline/{id}/subagents`。
 *
 * 为什么必须换：老管线已删除，那张 subagents 表对新产品线永远是空的；轮询一个
 * 永远为空的接口既费流量又会让用户以为"没有子 agent 在跑"。
 *
 * 交互不变：**只在点击时**打开标签（绝不自动开，防标签爆炸）。
 */
import React from 'react';
import { Bot } from 'lucide-react';
import { useCopilotStore } from '@/stores/copilotStore';
import { useTaskStore } from '@/stores/taskStore';

interface RunChip {
  runId: string;
  label: string;
  status: string;
  cost?: number;
  /** 回放标记（B11/N9）：`replayed` 是**来源**标记，不是状态 */
  replayed?: boolean;
  /** 失败/缺输入要能在筹码上直接看出来（旧实现只认 replayed，把真状态吞了） */
  failure?: string;
  needs?: string[];
}

const RUN_EVENTS = new Set(['agent_run_start', 'agent_run_update', 'agent_run_end']);

function _statusOf(type: string, detail: Record<string, unknown>): string {
  if (type === 'agent_run_start') return 'running';
  if (type === 'agent_run_update') {
    return String(detail.status || 'running');
  }
  return String(detail.status || 'done');
}

function _needsOf(detail: Record<string, unknown>): string[] | undefined {
  if (!Array.isArray(detail.needs)) return undefined;
  const names = (detail.needs as Array<Record<string, unknown>>)
    .map((n) => String(n?.field || n?.name || ''))
    .filter(Boolean);
  return names.length ? names : undefined;
}

/** 从事件流折叠出"最近一次 run 的最终状态"（同 run_id 后到的覆盖先到的）。 */
export function foldRunChips(
  events: { type: string; detail?: Record<string, unknown> }[],
): RunChip[] {
  const map = new Map<string, RunChip>();
  for (const ev of events) {
    if (!RUN_EVENTS.has(ev.type)) continue;
    const detail = (ev.detail || {}) as Record<string, unknown>;
    const runId = String(detail.run_id || '');
    if (!runId) continue;
    const stage = String(detail.stage || '');
    const role = String(detail.role || '');
    const prev = map.get(runId);
    const failure = (detail.failure as Record<string, unknown> | undefined)
      ?? (prev?.failure ? { blocking_point: prev.failure } : undefined);
    map.set(runId, {
      runId,
      // update/end 事件通常不带 stage/role —— 保留 start 时的标签，别退化成"子 agent"
      label: stage || role || String(detail.kind || '') || prev?.label || '子 agent',
      status: _statusOf(ev.type, detail),
      cost: typeof detail.cost_usd === 'number' ? detail.cost_usd : prev?.cost,
      replayed: Boolean(detail.replayed) || Boolean(prev?.replayed),
      failure: failure
        ? String(failure.blocking_point || failure.category || '') || prev?.failure
        : prev?.failure,
      needs: _needsOf(detail) ?? prev?.needs,
    });
  }
  return Array.from(map.values());
}

/** 状态 → 展示文案：`replayed` 不再是状态，`needs` 要说得像"缺输入"而不是"缺状态"。 */
export function chipStatusText(chip: RunChip): string {
  const base = chip.status === 'needs' ? 'needs（缺输入）' : chip.status;
  return chip.replayed ? `${base}·回放` : base;
}

export function RunningSubagents({ taskId, active }: { taskId: string; active?: boolean }) {
  const events = useTaskStore((s) => s.events);
  const openTab = useCopilotStore((s) => s.openTab);

  const chips = React.useMemo(() => foldRunChips(events), [events]);
  // `active` 只用于决定"是否只显示在跑的那些"；事件本身由 SSE 推送，不再轮询。
  const shown = active
    ? chips.filter((c) => ['running', 'needs', 'needs_review'].includes(c.status))
    : chips;

  if (!shown.length) return null;

  return (
    <div
      className="flex flex-wrap items-center gap-1 border-t border-outline-variant/20 px-3 py-1.5"
      data-testid="running-subagents"
    >
      <span className="text-caption text-on-surface-variant/70">子 agent</span>
      {shown.map((c) => (
        <button
          key={c.runId}
          type="button"
          data-subagent-chip={c.runId}
          data-run-status={c.status}
          data-run-replayed={c.replayed ? 'true' : undefined}
          title={c.failure ? `失败：${c.failure}` : (c.needs?.length ? `缺输入：${c.needs.join('、')}` : undefined)}
          className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-caption hover:border-outline hover:text-on-surface ${
            c.failure
              ? 'border-error/50 text-error'
              : c.status === 'needs' || c.status === 'needs_review'
                ? 'border-warning/50 text-warning'
                : 'border-outline-variant/40 text-on-surface-variant'
          }`}
          onClick={() => openTab({
            id: `subagent:${c.runId}`,
            kind: 'subagent',
            title: `${c.label}`,
            closable: true,
            payload: { taskId, subagentId: c.runId },
          })}
        >
          <Bot className="h-3 w-3" />
          <span className="max-w-[96px] truncate">{c.label}</span>
          <span className="text-on-surface-variant/60">{chipStatusText(c)}</span>
          {typeof c.cost === 'number' && (
            <span className="text-on-surface-variant/50">${c.cost.toFixed(3)}</span>
          )}
        </button>
      ))}
    </div>
  );
}
