/**
 * 任务运行标签（PRD §19.3 / 需求 9）
 *
 * **轨迹面板（专业视图）**：日志、工具、Skill、阶段、汇报、思考、降级、原始事件与子 agent。
 * 需求对话侧的"一条流"在 AgentPanel；这里保留分区与原始事件，供排查与深挖。
 * 数据源只有两处：任务事件 SSE（`useTaskEvents`）+ 子 agent 快照（`supervisorApi.getSubagents`）。
 */
import React from 'react';
import { useTaskStore } from '@/stores/taskStore';
import { cn } from '@/lib/utils';
import { asText } from '@/lib/render';
import { LogPanel } from '@/features/agent/AgentPanel';
import { TraceInspector } from './TraceInspector';
import { useTaskEvents } from '@/features/task/useTaskEvents';
import { EventFeed } from '@/features/task/EventFeed';
import { TaskToolTrace } from '@/features/task/TaskToolTrace';
import { TaskRuns } from '@/features/task/TaskRuns';
import { TaskFinishSummary } from '@/features/task/TaskFinishSummary';
import { TaskQuestionCard } from '@/features/task/TaskQuestionCard';
import { PlanPanel } from '@/features/task/PlanPanel';
import { TaskArtifacts } from '@/features/task/TaskArtifacts';
import { TaskToolbar } from '@/features/task/TaskToolbar';
import { parseTaskEvent } from '@/features/task/eventSchema';
import type { TaskEvent } from '@/types/task';
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
/**
 * 预算四道闸的中文名（PRD §6.4）。只有 limits 里真的配了才展示剩余量。
 */
function _fmtSec(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
    : `${m}:${String(ss).padStart(2, '0')}`;
}

function _BudgetCell({ label, used, limit, fmt }: {
  label: string;
  used: number;
  limit?: number | null;
  fmt?: (v: number) => string;
}) {
  const show = typeof limit === 'number' && limit > 0;
  const remaining = show ? Math.max(0, (limit as number) - used) : 0;
  const ratio = show ? Math.min(1, used / (limit as number)) : 0;
  const f = fmt || ((v: number) => String(Math.round(v)));
  return (
    <span data-budget={label} data-ratio={ratio.toFixed(2)}>
      {label} <b className="font-mono text-on-surface">{f(used)}</b>
      {show ? (
        <>
          {' / '}
          <span className="font-mono">{f(limit as number)}</span>
          <span className={ratio >= 0.9 ? 'ml-1 text-error' : 'ml-1 text-on-surface-variant/60'}>
            剩余 {f(remaining)}
          </span>
        </>
      ) : (
        <span className="ml-1 text-on-surface-variant/50">（无上限）</span>
      )}
    </span>
  );
}

function UsageRows({ usage, limits, unknownCostCalls }: {
  usage: { turns: number; tool_calls: number; tokens: number; cost_usd: number; wall_sec: number };
  limits?: { max_turns?: number; max_tool_calls?: number; max_wall_sec?: number;
    budget_usd?: number | null } | null;
  unknownCostCalls: number;
}) {
  const hasCost = usage.cost_usd > 0;
  const hasBudget = typeof limits?.budget_usd === 'number' && (limits?.budget_usd ?? 0) > 0;
  return (
    <div
      className="border-b border-outline-variant/20 px-3 py-2 text-caption"
      data-testid="usage-rows"
    >
      <p className="mb-1 text-label-sm text-on-surface-variant">用量</p>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-on-surface-variant">
        <_BudgetCell label="模型往返" used={usage.turns} limit={limits?.max_turns} />
        <_BudgetCell label="工具调用" used={usage.tool_calls} limit={limits?.max_tool_calls} />
        <_BudgetCell label="运行时长" used={usage.wall_sec} limit={limits?.max_wall_sec}
          fmt={_fmtSec} />
        <span data-budget="budget_usd">
          成本 <b className="font-mono text-on-surface">{hasCost ? `$${usage.cost_usd.toFixed(4)}` : '—'}</b>
          {hasBudget ? (
            <span className="ml-1 font-mono text-on-surface-variant/60">
              / ${(limits?.budget_usd as number).toFixed(2)}
            </span>
          ) : (
            <span className="ml-1 text-on-surface-variant/60">（未设置金额上限）</span>
          )}
          {!hasCost && (
            <span className="ml-1 text-on-surface-variant/50">暂无计费</span>
          )}
        </span>
        <span>tokens <b className="font-mono text-on-surface">{usage.tokens.toLocaleString()}</b></span>
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
  // 旧实现 `slice(-6)`：只留最后 6 条——长任务里"它一开始是怎么想的"直接消失。
  // 现在全量保留，只做窗口化（默认最近 40 条，可逐段往回加载）。
  const [visible, setVisible] = React.useState(40);
  const turns = React.useMemo(
    () => events
      .map((e) => ({ event: e, parsed: parseTaskEvent(e) }))
      .filter((x) => ['intent', 'narration', 'thinking'].includes(x.event.type)),
    [events],
  );
  if (!turns.length) return null;
  const shown = turns.slice(Math.max(0, turns.length - visible)).reverse();
  const rest = turns.length - shown.length;
  return (
    <div className="border-b border-outline-variant/20 px-3 py-2" data-testid="model-turn-rows">
      <p className="mb-1 text-label-sm text-on-surface-variant">模型轮次（{turns.length} 条）</p>
      {rest > 0 && (
        <button
          type="button"
          data-testid="model-turns-load-more"
          className="mb-1 text-caption text-primary hover:underline"
          onClick={() => setVisible((v) => v * 2)}
        >
          加载更早的 {Math.min(rest, visible)} 条（还有 {rest} 条）
        </button>
      )}
      <ul className="space-y-1">
        {shown.map(({ event: e, parsed }) => {
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
              <span className="truncate text-on-surface-variant/90">{asText(e.message)}</span>
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

/** 一行"调用"：主 agent 工具、子 agent 工具、Skill 统一成这个形状。 */
export interface CallRow {
  key: string;
  seq: number;
  tool: string;
  status: string;
  ms?: number;
  error?: string;
  paired: 'causation' | 'name';
  /** `main` = 主 agent；`subagent` = 派出去的子 agent；`skill` = 走 SkillRegistry 的技能 */
  origin: 'main' | 'subagent' | 'skill';
  agent?: string;
  stage?: string;
  run_id?: string;
  seq_in_run?: number;
  source?: string;
  deduped?: boolean;
  remaining_turns?: number;
}

/**
 * 合并三路调用行（PRD §19.3「思考流与工具全部可见」）。
 *
 * 旧实现只渲染主 agent 的 `tool_call`/`tool_result` 配对，并 `slice(-8)` 砍到 8 行——
 * 子 agent 内部调用、Skill 调用、运行时补派（`source=kernel`）全都看不到，长任务还会
 * 把早期调用整段吞掉。现在三路合并 + 按 seq 排序，一行不丢；渲染侧用窗口化分页
 * （见 `ToolCallRows`）而不是截断，用户能一直往回翻。
 */
export function mergeCallRows(events: Ev): CallRow[] {
  const callDetail = new Map<number, Record<string, unknown>>();
  /** 结果侧标记（deduped / source）挂在 tool_result 上，配对后要合到调用行 */
  const resultDetail = new Map<number, Record<string, unknown>>();
  for (const e of events) {
    if (e.type !== 'tool_call' && e.type !== 'tool_result') continue;
    const p = parseTaskEvent(e);
    if (p.kind !== 'tool_call' && p.kind !== 'tool_result') continue;
    const bag = p.tool as unknown as Record<string, unknown>;
    if (e.type === 'tool_call') { callDetail.set(e.seq, bag); continue; }
    const causation = String(e.causation_id || '');
    if (causation.startsWith('seq:')) {
      const target = Number(causation.slice(4));
      if (Number.isFinite(target)) resultDetail.set(target, bag);
    }
  }
  const rows: CallRow[] = pairToolCalls(events).map((r) => {
    // 注意：parseTaskEvent 会把缺省字段填成 undefined，直接 spread 会把调用侧的
    // source/deduped 覆盖回 undefined——只合并真正有值的字段。
    const d: Record<string, unknown> = { ...(callDetail.get(r.seq) ?? {}) };
    for (const [k, v] of Object.entries(resultDetail.get(r.seq) ?? {})) {
      if (v !== undefined && v !== null && v !== '') d[k] = v;
    }
    return {
      ...r,
      key: `m${r.seq}`,
      origin: d.kind === 'skill' ? ('skill' as const) : ('main' as const),
      source: d.source as string | undefined,
      deduped: d.deduped as boolean | undefined,
      remaining_turns: d.remaining_turns as number | undefined,
    };
  });

  for (const e of events) {
    if (e.type !== 'subagent_tool') continue;
    const parsed = parseTaskEvent(e);
    if (parsed.kind !== 'subagent_tool') continue;
    const d = parsed.tool;
    rows.push({
      key: `s${e.seq}`,
      seq: e.seq,
      tool: d.tool || e.message || '',
      status: d.status ?? '',
      ms: d.duration_ms,
      error: d.error,
      paired: 'causation',
      origin: d.kind === 'skill' ? 'skill' : 'subagent',
      agent: d.agent,
      stage: d.stage,
      run_id: d.run_id,
      seq_in_run: d.seq_in_run,
      source: d.source,
      deduped: d.deduped,
      remaining_turns: d.remaining_turns,
    });
  }

  rows.sort((a, b) => a.seq - b.seq);
  return rows;
}

type OriginFilter = 'all' | 'main' | 'subagent' | 'skill';

/** 首屏行数；之后每次「加载更多」翻倍——不截断，但也不把上千行一次塞进 DOM。 */
const CALLS_PAGE = 60;

function ToolCallRows({ events }: { events: Ev }) {
  const all = React.useMemo(() => mergeCallRows(events), [events]);
  const [filter, setFilter] = React.useState<OriginFilter>('all');
  const [visible, setVisible] = React.useState(CALLS_PAGE);

  const counts = React.useMemo(() => ({
    main: all.filter((r) => r.origin === 'main').length,
    subagent: all.filter((r) => r.origin === 'subagent').length,
    skill: all.filter((r) => r.origin === 'skill').length,
    failed: all.filter((r) => r.status && r.status !== 'ok').length,
  }), [all]);

  const rows = React.useMemo(
    () => (filter === 'all' ? all : all.filter((r) => r.origin === filter)),
    [all, filter],
  );
  // 事件只增不减，过滤切换后窗口回到首屏，避免"切回来只剩几行"
  React.useEffect(() => { setVisible(CALLS_PAGE); }, [filter]);

  if (!all.length) return null;
  // 最新在前：日志型界面每秒都在追加，把最新一行放在顶部；「加载更早的」往后翻历史。
  const shown = rows.slice(Math.max(0, rows.length - visible)).reverse();
  const rest = rows.length - shown.length;

  return (
    <div className="border-b border-outline-variant/20 px-3 py-2" data-testid="tool-call-rows">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <p className="text-label-sm text-on-surface-variant">
          工具调用（{all.length} 次
          {counts.failed ? ` · 失败 ${counts.failed}` : ''}）
        </p>
        <div className="flex flex-wrap gap-1" data-testid="tool-call-filters">
          {([
            ['all', `全部 ${all.length}`],
            ['main', `主 agent ${counts.main}`],
            ['subagent', `子 agent ${counts.subagent}`],
            ['skill', `技能 ${counts.skill}`],
          ] as const).map(([k, label]) => (
            <button
              key={k}
              type="button"
              data-origin-filter={k}
              aria-pressed={filter === k}
              className={`rounded-cw-sm px-1.5 py-0.5 text-caption ${
                filter === k
                  ? 'bg-primary/15 text-primary'
                  : 'text-on-surface-variant/70 hover:text-on-surface'
              }`}
              onClick={() => setFilter(k)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <ul className="space-y-1">
        {shown.map((r) => (
          <li
            key={r.key}
            className="flex items-baseline gap-2 text-caption"
            data-paired={r.paired}
            data-origin={r.origin}
            data-source={r.source}
          >
            <span className="w-10 shrink-0 text-on-surface-variant/60" data-origin-tag={r.origin}>
              {r.origin === 'skill' ? '技能' : r.origin === 'subagent' ? '子' : '主'}
            </span>
            <span className="w-32 shrink-0 truncate font-mono text-on-surface-variant">{r.tool}</span>
            {r.agent && (
              <span className="shrink-0 truncate text-on-surface-variant/60">
                @{r.agent}
                {typeof r.seq_in_run === 'number' ? `#${r.seq_in_run}` : ''}
              </span>
            )}
            <span
              className={r.status === 'ok' ? 'shrink-0 text-primary' : 'shrink-0 text-error'}
              data-tool-status={r.status}
            >
              {r.status || '—'}
            </span>
            {typeof r.ms === 'number' && (
              <span className="shrink-0 text-on-surface-variant/60">{r.ms}ms</span>
            )}
            {r.source === 'kernel' && (
              // 运行时补派（用户没提、模型没调）：必须说明是谁加的
              <span className="shrink-0 text-tertiary/80">运行时补派</span>
            )}
            {r.deduped && (
              <span className="shrink-0 text-on-surface-variant/50">复用上次结果</span>
            )}
            {typeof r.remaining_turns === 'number' && (
              <span className="shrink-0 text-on-surface-variant/50">剩 {r.remaining_turns} 回合</span>
            )}
            {r.error && <span className="truncate text-error/80">{r.error}</span>}
            {r.paired === 'name' && (
              // 老事件没有 causation_id：按名字配的，可能是并发的同名调用
              <span className="shrink-0 text-on-surface-variant/40">按名配对</span>
            )}
          </li>
        ))}
      </ul>
      {rest > 0 && (
        <button
          type="button"
          data-testid="tool-calls-load-more"
          className="mt-1 text-caption text-primary hover:underline"
          onClick={() => setVisible((v) => v + CALLS_PAGE * 2)}
        >
          加载更早的 {Math.min(rest, CALLS_PAGE * 2)} 条（还有 {rest} 条）
        </button>
      )}
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
              <span className="truncate">{asText(e.message)}</span>
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
          // 收据（PRD modern-agent-review P0）：降级不能只"口头接受"，
          // better 是重派修好了（remediated），要么写明理由接受（accepted）。
          const receipt = String(raw.mode ?? '');
          const reason = String(raw.reason ?? '');
          const resolved = typeof raw.resolved === 'number' ? raw.resolved : null;
          return (
            <li key={p.seq} className="text-caption text-on-surface-variant" data-degradation-seq={p.seq}
              data-receipt={receipt || undefined}>
              {receipt === 'remediated' && (
                <span className="mr-1 rounded-cw-xs bg-primary/15 px-1 text-primary">
                  已修复{resolved ? ` ${resolved} 项` : ''}
                </span>
              )}
              {receipt === 'accepted' && (
                <span className="mr-1 rounded-cw-xs bg-warning/15 px-1 text-warning">
                  已接受{resolved ? ` ${resolved} 项` : ''}
                </span>
              )}
              {scope && <span className="mr-1 font-mono text-warning/80">{scope}</span>}
              {detail}
              {reason && <span className="ml-1 text-on-surface-variant/70">理由：{reason}</span>}
              {impact && <span className="ml-1 text-on-surface-variant/60">（{impact}）</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function CopilotTaskRunTab({ taskId }: { taskId: string }) {
  /**
   * 固定「轨迹」标签不绑定具体任务：优先用传入的 taskId（动态标签），
   * 没有就跟着 taskStore 的"当前任务"走（派发/开工时写入，刷新后由会话时间线的
   * `task_ids` 接回）。否则固定标签一刷新就是死空态。
   */
  const currentTaskId = useTaskStore((s) => s.task?.id ?? '');
  const effectiveTaskId = taskId || currentTaskId;
  useTaskEvents(effectiveTaskId || null, Boolean(effectiveTaskId));
  const task = useTaskStore((s) => s.task);
  const events = useTaskStore((s) => s.events);
  // M3：事件恢复元数据（缺口提示 + 往上翻历史）
  const hasEarlierEvents = useTaskStore((s) => s.hasEarlierEvents);
  const seqGap = useTaskStore((s) => s.seqGap);
  const loadEarlierEvents = useTaskStore((s) => s.loadEarlierEvents);
  const busy = useTaskStore((s) => s.loading);
  const error = useTaskStore((s) => s.error);
  const pause = useTaskStore((s) => s.pause);
  const resume = useTaskStore((s) => s.resume);
  const cancel = useTaskStore((s) => s.cancel);
  const inject = useTaskStore((s) => s.inject);
  // PRD B11：「查看结果」滚到产物区（终态任务不重新跑，只让人看结论）
  const [showArtifacts, setShowArtifacts] = React.useState(false);
  /**
   * 「轨迹」面板 = 专业视图（用户 2026-10-31 明确：保留但改名、要更详细）。
   * 单流在需求对话里；这里刻意**不**跟随 unified 开关，始终给分区 + 原始事件 + 用量，
   * 便于排查（事件 seq、工具配对、降级、run 明细、原始 JSON）。
   */
  const artifactsRef = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (showArtifacts) {
      setShowArtifacts(false);
      artifactsRef.current?.scrollIntoView?.({ block: 'start' });
    }
  }, [showArtifacts]);

  /**
   * 轨迹的两块内容（用户 2026-10-31 定稿）：
   * - 事件流：分区行 + 原始事件，点任一条 → 右侧详情（旧「执行日志」的能力并入这里）；
   * - 日志：Agent 结构化日志（LogPanel 原样搬进来，撤掉独立标签后功能不能丢）。
   */
  const [view, setView] = React.useState<'flow' | 'log'>('flow');
  const [selectedSeq, setSelectedSeq] = React.useState<number | null>(null);
  const selectedEvent = React.useMemo(
    () => events.find((e) => e.seq === selectedSeq) ?? null,
    [events, selectedSeq],
  );
  // 默认选中最后一条（跟"当前正在发生什么"对齐）；用户点了别的就不再抢焦点
  const touched = React.useRef(false);
  const onSelect = React.useCallback((e: TaskEvent) => {
    touched.current = true;
    setSelectedSeq(e.seq);
  }, []);
  React.useEffect(() => {
    if (touched.current || selectedSeq !== null) return;
    const last = events[events.length - 1];
    if (last) setSelectedSeq(last.seq);
  }, [events, selectedSeq]);

  /**
   * 两栏还是堆叠：面板默认只有 320px（拖宽上限 1100），窄屏两栏会把详情挤成一条缝。
   * 用容器宽度而不是 `window.innerWidth`——用户拖的是面板，不是窗口。
   */
  const flowRef = React.useRef<HTMLDivElement | null>(null);
  const [wide, setWide] = React.useState(false);
  React.useEffect(() => {
    const el = flowRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect?.width ?? el.clientWidth;
      setWide(w >= 720);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [view, effectiveTaskId]);

  if (!effectiveTaskId) {
    return (
      <div className="p-3 text-caption text-on-surface-variant">
        还没有运行中的任务：从「需求对话」确认简报后会派发规划书，这里显示它的轨迹。
      </div>
    );
  }

  const status = task?.status ?? 'running';
  const terminal = ['done', 'failed', 'cancelled', 'unknown_terminal'].includes(status);

  return (
    <div className="flex h-full min-h-0 flex-col" data-testid="task-run-tab">
      <div className="border-b border-outline-variant/20 px-3 py-2">
        <div className="mb-1 flex items-center justify-between text-caption text-on-surface-variant/70">
          <span data-testid="task-trace-heading">轨迹（专业视图）</span>
          <span data-testid="task-trace-stats">
            事件 {events.length} 条 · seq {events[0]?.seq ?? 0}–{events[events.length - 1]?.seq ?? 0}
          </span>
        </div>
        <TaskToolbar
          status={status}
          busy={busy}
          onPause={() => void pause(effectiveTaskId)}
          onResume={() => void resume(effectiveTaskId)}
          onCancel={() => void cancel(effectiveTaskId)}
          onInject={(text) => void inject(effectiveTaskId, text)}
          onViewResult={() => setShowArtifacts(true)}
        />
        {/* PRD B11：resume 被后端拒绝（终态）时，原因来自 store.error——显示在工具条下方 */}
        {error && (
          <p className="mt-1 text-caption text-error" data-testid="task-error">{error}</p>
        )}
      </div>

      {task && (
        <TaskFinishSummary status={status} finish={task.finish ?? null} />
      )}

      {/* 只有拿到**完整** task（含 usage/limits）才渲染用量；只有 id 的半成品对象
          会让这里读 undefined 崩掉——宁可少一块，也不要把面板打崩 */}
      {task?.usage && (
        <UsageRows
          usage={task.usage}
          limits={task.limits}
          unknownCostCalls={task.usage.unknown_cost_calls ?? 0}
        />
      )}

      <ThinkingDisclosure events={events} />
      {/* PRD B6：Plan 是「初始假设」，真实进展只认事件——两块在视觉上分开 */}
      {task && <PlanPanel task={task} busy={busy} />}

      {/* 视图切换：事件流（可点开详情）/ 日志（旧「执行日志」的内容） */}
      <div className="flex shrink-0 items-center gap-1 border-b border-outline-variant/20 px-3 py-1"
        data-testid="trace-view-switch">
        {([['flow', '事件流'], ['log', '日志']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            data-trace-view={key}
            aria-selected={view === key}
            className={cn(
              'rounded-cw-xs px-1.5 py-0.5 text-caption',
              view === key
                ? 'bg-surface-container-high text-on-surface'
                : 'text-on-surface-variant hover:bg-surface-container',
            )}
            onClick={() => setView(key)}
          >
            {label}
          </button>
        ))}
        <span className="ml-auto text-caption text-on-surface-variant/60">
          点左侧任一条，右侧看参数 / 结果 / Schema / 计时
        </span>
      </div>

      {view === 'log' ? (
        <div className="min-h-[420px] flex-1 overflow-auto" data-testid="trace-log-view">
          <LogPanel />
        </div>
      ) : (
        <div
          ref={flowRef}
          className={cn('flex min-h-[420px] flex-1', wide ? 'flex-row' : 'flex-col')}
          data-testid="trace-flow-view"
          data-layout={wide ? 'split' : 'stacked'}
        >
          {/* 列表：分区行 + 原始事件（可选中） */}
          <div className={cn(
            'flex min-h-0 min-w-0 flex-col overflow-auto',
            wide ? 'flex-[1.15]' : 'flex-1',
          )}>
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
            <ApprovalRows events={events} taskId={effectiveTaskId} />
            <DegradationRows events={events} />

            {/* PRD §15：主 agent 提问 → 用户回答（任务进入 waiting_user 时的唯一出路） */}
            <TaskQuestionCard taskId={effectiveTaskId} events={events} />

            {/* PRD modern-agent-review M2：子会话可寻址（追问 / 重放） */}
            <TaskRuns taskId={effectiveTaskId} active={!terminal} />

            {/* PRD modern-agent-review M3：事件流只有采样，全量轨迹单独读盘上的 transcript */}
            <TaskToolTrace taskId={effectiveTaskId} active={!terminal} />

            <div className="min-h-0 flex-1 overflow-auto px-1 py-1">
              <EventFeed
                events={events}
                hasEarlierEvents={hasEarlierEvents}
                seqGap={seqGap}
                onLoadEarlier={() => void loadEarlierEvents(effectiveTaskId)}
                onSelect={onSelect}
                selectedSeq={selectedSeq}
              />
            </div>
          </div>
          {/* 详情：选中条目的 概述 / 参数 / 结果 / Schema / 计时 */}
          <div className={cn(
            'min-h-0 border-outline-variant/20',
            wide ? 'w-[46%] shrink-0 border-l' : 'h-[42%] shrink-0 border-t',
          )}
          >
            <TraceInspector event={selectedEvent} taskId={effectiveTaskId} />
          </div>
        </div>
      )}

      <RunningSubagents taskId={effectiveTaskId} active={!terminal} />
      <div ref={artifactsRef}>
        <TaskArtifacts taskId={effectiveTaskId} enabled={terminal} />
      </div>
    </div>
  );
}
