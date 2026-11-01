/**
 * 轨迹详情检查器（用户 2026-10-31 定稿布局）。
 *
 * 左侧是事件/工具行，右侧是**选中那一条**的结构化详情，五个页签：
 *
 * | 页签 | 看什么 |
 * |---|---|
 * | 概述 | 层级（run/stage/tool）、状态、助手消息（模型/内核这句话说了什么） |
 * | 参数 | 这次调用传了什么（`detail.args` / `detail.inputs`） |
 * | 结果 | 返回了什么（`detail.result` / `detail.output`，没有就退回 message） |
 * | Schema | 原始事件（type/seq/trace_id/run_id/span/causation_id + 完整 detail） |
 * | 计时 | 开始时间（ts）、耗时（duration_ms）、来源（trace/ span / 因果） |
 *
 * 纪律：**只显示事件里真有的东西**。缺失的字段显示「—」，不猜、不伪造 0 毫秒。
 */

import React from 'react';
import { Braces, Clock, FileJson, Info, ListTree } from 'lucide-react';

import { cn } from '@/lib/utils';
import type { TaskEvent } from '@/types/task';
import { eventLabel } from '@/features/task/labels';

type TabKey = 'overview' | 'params' | 'result' | 'schema' | 'timing';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'overview', label: '概述', icon: <Info className="h-3 w-3" /> },
  { key: 'params', label: '参数', icon: <ListTree className="h-3 w-3" /> },
  { key: 'result', label: '结果', icon: <Braces className="h-3 w-3" /> },
  { key: 'schema', label: 'Schema', icon: <FileJson className="h-3 w-3" /> },
  { key: 'timing', label: '计时', icon: <Clock className="h-3 w-3" /> },
];

const DASH = '—';

function detailOf(event: TaskEvent | null): Record<string, unknown> {
  const raw = (event?.detail || {}) as Record<string, unknown>;
  return raw && typeof raw === 'object' ? raw : {};
}

function pick(obj: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    const v = obj[key];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

function asText(value: unknown): string {
  if (value === undefined || value === null || value === '') return DASH;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function Pre({ children, testId }: { children: React.ReactNode; testId?: string }) {
  return (
    <pre
      data-testid={testId}
      className="mt-1 max-h-[420px] overflow-auto whitespace-pre-wrap break-words rounded-cw-sm bg-surface-container p-2 font-mono text-caption text-on-surface-variant"
    >
      {children}
    </pre>
  );
}

function KV({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  // 运行时收口：`value` 常直接来自事件字段（声明 string，实际可能是 `{name: …}` 这种
  // 结构化产物）。原样塞进 JSX 会抛 "Objects are not valid as a React child" 并炸掉整页。
  const node = (typeof value === 'object' && value !== null
    && !Array.isArray(value) && !(value as { $$typeof?: unknown }).$$typeof)
    ? asText(value)
    : value;
  return (
    <div className="flex items-baseline gap-2 border-b border-outline-variant/10 py-1 last:border-0">
      <span className="w-20 shrink-0 text-caption text-on-surface-variant/70">{label}</span>
      <span className={cn('min-w-0 flex-1 break-words text-caption text-on-surface',
        mono ? 'font-mono' : '')}
      >
        {node}
      </span>
    </div>
  );
}

/** 这一步发生在哪一层（层级）：阶段 > 子 agent/工具 > 内核。 */
function levelOf(event: TaskEvent): string {
  const d = detailOf(event);
  const stage = String(d.stage ?? '');
  const kind = String(d.kind ?? '');
  if (stage) return `阶段 ${stage}`;
  if (event.span === 'stage' || kind === 'stage') return '阶段';
  if (event.span === 'tool' || event.type === 'tool_call' || event.type === 'tool_result') {
    return d.tool ? `工具 ${String(d.tool)}` : '工具';
  }
  if (event.type.startsWith('agent_run') || event.type === 'subagent_tool') return '子 agent';
  if (event.span === 'kernel') return '主 agent';
  return '主 agent';
}

function statusOf(event: TaskEvent): string {
  const d = detailOf(event);
  const status = String(pick(d, ['status', 'result', 'error']) ?? '');
  if (status) return status;
  if (event.type.endsWith('_end') || event.type === 'tool_result') return '已完成';
  return DASH;
}

export function TraceInspector({
  event, taskId, className,
}: {
  event: TaskEvent | null;
  taskId?: string;
  className?: string;
}) {
  const [tab, setTab] = React.useState<TabKey>('overview');
  const d = detailOf(event);

  if (!event) {
    return (
      <div className={cn('flex h-full items-center justify-center px-3 text-caption text-on-surface-variant/60', className)}
        data-testid="trace-inspector-empty">
        左侧点一条事件，这里显示它的参数、结果与计时。
      </div>
    );
  }

  const args = pick(d, ['args', 'inputs', 'arguments']);
  const result = pick(d, ['result', 'output', 'response', 'data']);
  const round = pick(d, ['round']);
  const step = pick(d, ['step_id', 'step', 'index']);
  const durationMs = pick(d, ['duration_ms']);
  const source = [event.trace_id, event.span, event.causation_id].filter(Boolean).join(' · ');

  return (
    <div className={cn('flex h-full min-h-0 flex-col', className)} data-testid="trace-inspector">
      <div className="shrink-0 border-b border-outline-variant/20 px-3 py-2"
        data-testid="trace-inspector-heading">
        <div className="flex items-center gap-2 text-label-sm text-on-surface">
          <span className="rounded-cw-xs bg-surface-container-high px-1.5 py-0.5 text-caption">
            {eventLabel(event.type)}
          </span>
          <span className="text-caption text-on-surface-variant">
            {[
              round !== undefined ? `第 ${String(round)} 轮` : '',
              step !== undefined ? `步骤 ${String(step)}` : '',
              `seq ${event.seq}`,
            ].filter(Boolean).join(' · ')}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.key}
              type="button"
              data-inspector-tab={t.key}
              aria-selected={tab === t.key}
              onClick={() => setTab(t.key)}
              className={cn(
                'flex shrink-0 items-center gap-1 rounded-cw-xs px-1.5 py-0.5 text-caption',
                tab === t.key
                  ? 'bg-surface-container-high text-on-surface'
                  : 'text-on-surface-variant hover:bg-surface-container',
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {tab === 'overview' && (
          <div data-testid="inspector-overview">
            <KV label="层级" value={levelOf(event)} />
            <KV label="状态" value={statusOf(event)} />
            <KV label="助手消息" value={event.message || DASH} />
            {taskId && <KV label="任务" value={taskId} mono />}
          </div>
        )}

        {tab === 'params' && (
          <div data-testid="inspector-params">
            {args === undefined
              ? <p className="text-caption text-on-surface-variant/70">这条事件没有参数。</p>
              : <Pre testId="inspector-params-json">{asText(args)}</Pre>}
          </div>
        )}

        {tab === 'result' && (
          <div data-testid="inspector-result">
            {result !== undefined
              ? <Pre testId="inspector-result-json">{asText(result)}</Pre>
              : (
                <>
                  <KV label="结论" value={event.message || DASH} />
                  {Object.keys(d).length > 0 && (
                    <Pre testId="inspector-result-detail">{asText(d)}</Pre>
                  )}
                </>
              )}
          </div>
        )}

        {tab === 'schema' && (
          <div data-testid="inspector-schema">
            <Pre testId="inspector-schema-json">
              {JSON.stringify({
                type: event.type,
                seq: event.seq,
                ts: event.ts,
                message: event.message,
                run_id: event.run_id,
                trace_id: event.trace_id,
                span: event.span,
                causation_id: event.causation_id,
                detail: d,
              }, null, 2)}
            </Pre>
          </div>
        )}

        {tab === 'timing' && (
          <div data-testid="inspector-timing">
            <KV label="开始时间" value={event.ts || DASH} mono />
            <KV label="时长" value={durationMs !== undefined ? `${String(durationMs)} ms` : DASH} />
            <KV label="来源" value={source || DASH} mono />
          </div>
        )}
      </div>
    </div>
  );
}
