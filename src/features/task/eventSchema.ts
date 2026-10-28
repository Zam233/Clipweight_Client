/**
 * 任务事件契约（PRD B5 / 2026-10-29 / 缺口 G10）。
 *
 * 后端 `clipwright/schema/task.py::EVENT_TYPES` 是**唯一契约源**；这里逐类型声明
 * 「detail 里我们能读哪些键、缺失时给什么默认值」。过去前端在 8 个组件里各写一份
 * `detail as Record<string, unknown>` 再猜字段名，后端改名叫 `stage`→`phase` 时
 * 静默变成空白——所以这里做成**集中式 parser**，并用跨仓契约测试锁住键集合：
 * `tests/test_event_contract.py` 断言后端 `EVENT_TYPES` 与本文件的
 * `EVENT_TYPE_KEYS` 集合完全相等（数量 24）。
 *
 * 设计约束：
 * 1. **只补默认值、不丢字段**：未知键原样保留在 `raw` 里，方便排查；
 * 2. 未知事件类型不抛异常，返回 `kind: 'unknown'` + 原始 detail（前端仍可折叠展示）；
 * 3. 不解析自由文本（`degradation.detail` 是后端 `note_degradation(detail=...)` 的字符串）。
 */
import type { TaskEvent, TaskEventType } from '@/types/task';

/** 与后端 `EVENT_TYPES` 必须一一对应（顺序也保持一致，便于 diff）。 */
export const EVENT_TYPE_KEYS = [
  'task_start',
  'plan',
  'replan',
  'step_start',
  'tool_call',
  'tool_result',
  'approval_request',
  'approval_result',
  'degradation',
  'artifact',
  'step_end',
  'gate_hit',
  'checkpoint',
  'task_end',
  'inject',
  'narration',
  'intent',
  'thinking',
  'report',
  'doc_write',
  'context_loaded',
  'agent_run_start',
  'agent_run_update',
  'agent_run_end',
] as const satisfies readonly TaskEventType[];

export type KnownEventKind = (typeof EVENT_TYPE_KEYS)[number];

/** tool 调用/结果 */
export interface ToolDetail {
  tool: string;
  args?: unknown;
  status?: string;
  duration_ms?: number;
  error?: string;
  brief?: string;
}

/** 阶段（step_*） */
export interface StageDetail {
  stage: string;
  status?: string;
  summary?: string;
  cost_usd?: number;
}

/** 模型说话/思考 */
export interface ModelTurnDetail {
  /** narration 的 kind：preamble = 动手前那段话 */
  kind?: string;
  round?: number;
  before_tool?: string[];
  tool_count?: number;
  delta?: string;
  done?: boolean;
  text?: string;
}

/** 授权 */
export interface ApprovalDetail {
  approval_id?: string;
  risk?: string;
  tool?: string;
  status?: string;
}

/** AgentRun（子 agent） */
export interface AgentRunDetail {
  run_id?: string;
  kind?: string;
  stage?: string;
  role?: string;
  status?: string;
  summary?: string;
  cost_usd?: number;
  duration_ms?: number;
  report_path?: string;
  failure?: Record<string, unknown>;
  needs?: Array<Record<string, unknown>>;
  replayed?: boolean;
}

/** 上下文装载（B12 已把 trimmed 改成被裁段名 list） */
export interface ContextDetail {
  bytes?: number;
  budget?: number;
  phase?: string;
  sources?: Array<Record<string, unknown>>;
  trimmed?: string[];
  memory?: Record<string, unknown>;
  root?: string;
}

/** 文档写入 / 报告 */
export interface DocDetail {
  path?: string;
  chars?: number;
  files?: string[];
  stage?: string;
  status?: string;
  bullets?: string[];
  tool_calls?: number;
}

/** 终态 / 闸 / 注入 / 计划 */
export interface TaskEndDetail {
  reason?: string;
  completed?: string[];
  unfinished?: string[];
  tool_calls?: number;
  dry_run?: boolean;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}
function objArr(v: unknown): Array<Record<string, unknown>> | undefined {
  return Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>) : undefined;
}
function strArr(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map((x) => String(x)) : undefined;
}

export interface ParsedEventBase {
  kind: KnownEventKind | 'unknown';
  seq: number;
  type: TaskEventType;
  message: string;
  ts: string;
  /** 原始 detail（未知键不丢） */
  raw: Record<string, unknown>;
}

export type ParsedEvent =
  | (ParsedEventBase & { kind: 'tool_call' | 'tool_result'; tool: ToolDetail })
  | (ParsedEventBase & { kind: 'step_start' | 'step_end'; stage: StageDetail })
  | (ParsedEventBase & { kind: 'narration' | 'thinking' | 'intent'; turn: ModelTurnDetail })
  | (ParsedEventBase & { kind: 'approval_request' | 'approval_result'; approval: ApprovalDetail })
  | (ParsedEventBase & { kind: 'agent_run_start' | 'agent_run_update' | 'agent_run_end'; run: AgentRunDetail })
  | (ParsedEventBase & { kind: 'context_loaded'; context: ContextDetail })
  | (ParsedEventBase & { kind: 'doc_write' | 'report'; doc: DocDetail })
  | (ParsedEventBase & { kind: 'task_end' | 'gate_hit' | 'degradation' | 'artifact'
      | 'checkpoint' | 'inject' | 'plan' | 'replan' | 'task_start'; end: TaskEndDetail & Record<string, unknown> })
  | (ParsedEventBase & { kind: 'unknown' });

/** 解析单个事件：永不抛异常，未知类型走 `unknown` 分支。 */
export function parseTaskEvent(event: TaskEvent): ParsedEvent {
  const raw = (event.detail || {}) as Record<string, unknown>;
  const base: ParsedEventBase = {
    kind: 'unknown',
    seq: event.seq,
    type: event.type,
    message: event.message || '',
    ts: event.ts || '',
    raw,
  };
  const kind = event.type as KnownEventKind;
  if (!EVENT_TYPE_KEYS.includes(kind)) return { ...base, kind: 'unknown' };

  switch (kind) {
    case 'tool_call':
    case 'tool_result':
      return {
        ...base,
        kind,
        tool: {
          tool: String(raw.tool ?? event.message ?? ''),
          args: raw.args,
          status: str(raw.status),
          duration_ms: num(raw.duration_ms),
          error: str(raw.error),
          brief: str(raw.brief),
        },
      };
    case 'step_start':
    case 'step_end':
      return {
        ...base,
        kind,
        stage: {
          stage: String(raw.stage ?? raw.phase ?? ''),
          status: str(raw.status),
          summary: str(raw.summary),
          cost_usd: num(raw.cost_usd),
        },
      };
    case 'narration':
    case 'thinking':
    case 'intent':
      return {
        ...base,
        kind,
        turn: {
          kind: str(raw.kind),
          round: num(raw.round),
          before_tool: strArr(raw.before_tool),
          tool_count: num(raw.tool_count),
          delta: str(raw.delta),
          done: typeof raw.done === 'boolean' ? raw.done : undefined,
          text: str(raw.text),
        },
      };
    case 'approval_request':
    case 'approval_result':
      return {
        ...base,
        kind,
        approval: {
          approval_id: str(raw.approval_id),
          risk: str(raw.risk),
          tool: str(raw.tool),
          status: str(raw.status),
        },
      };
    case 'agent_run_start':
    case 'agent_run_update':
    case 'agent_run_end':
      return {
        ...base,
        kind,
        run: {
          run_id: str(raw.run_id),
          kind: str(raw.kind),
          stage: str(raw.stage),
          role: str(raw.role),
          status: str(raw.status),
          summary: str(raw.summary),
          cost_usd: num(raw.cost_usd),
          duration_ms: num(raw.duration_ms),
          report_path: str(raw.report_path),
          failure: raw.failure && typeof raw.failure === 'object'
            ? (raw.failure as Record<string, unknown>) : undefined,
          needs: objArr(raw.needs),
          replayed: Boolean(raw.replayed),
        },
      };
    case 'context_loaded':
      return {
        ...base,
        kind,
        context: {
          bytes: num(raw.bytes),
          budget: num(raw.budget),
          phase: str(raw.phase),
          sources: objArr(raw.sources),
          trimmed: strArr(raw.trimmed),
          memory: raw.memory && typeof raw.memory === 'object'
            ? (raw.memory as Record<string, unknown>) : undefined,
          root: str(raw.root),
        },
      };
    case 'doc_write':
    case 'report':
      return {
        ...base,
        kind,
        doc: {
          path: str(raw.path) ?? str(raw.report_path),
          chars: num(raw.chars),
          files: strArr(raw.files),
          stage: str(raw.stage),
          status: str(raw.status),
          bullets: strArr(raw.bullets),
          tool_calls: num(raw.tool_calls),
        },
      };
    default:
      return {
        ...base,
        kind,
        end: {
          reason: str(raw.reason),
          completed: strArr(raw.completed),
          unfinished: strArr(raw.unfinished),
          tool_calls: num(raw.tool_calls),
          dry_run: typeof raw.dry_run === 'boolean' ? raw.dry_run : undefined,
          ...raw,
        },
      };
  }
}

/** 便捷选择器：只取某类事件（类型安全的一层壳）。 */
export type EventOfKind<K extends KnownEventKind> = ParsedEvent extends infer P
  ? (P extends { kind: infer KK } ? (K extends KK ? P : never) : never)
  : never;

export function selectEvents<K extends KnownEventKind>(
  events: TaskEvent[],
  kind: K,
): Array<EventOfKind<K>> {
  const out: Array<EventOfKind<K>> = [];
  for (const ev of events) {
    const parsed = parseTaskEvent(ev);
    if (parsed.kind === kind) out.push(parsed as EventOfKind<K>);
  }
  return out;
}
