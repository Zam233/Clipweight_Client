/**
 * 任务事件契约（PRD B5 / 2026-10-29 / 缺口 G10）。
 *
 * 后端 `clipwright/schema/task.py::EVENT_TYPES` 是**唯一契约源**；这里逐类型声明
 * 「detail 里我们能读哪些键、缺失时给什么默认值」。过去前端在 8 个组件里各写一份
 * `detail as Record<string, unknown>` 再猜字段名，后端改名叫 `stage`→`phase` 时
 * 静默变成空白——所以这里做成**集中式 parser**，并用跨仓契约测试锁住键集合：
 * `tests/test_event_contract.py` 断言后端 `EVENT_TYPES` 与本文件的
 * `EVENT_TYPE_KEYS` 集合完全相等（数量 31）。
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
  // 子 agent 透明化（后端 2026-10-29）：子 agent 的工具调用与长阶段分段进度
  'subagent_tool',
  'subagent_progress',
  // 反思流 / 主动询问 / 进度播报（后端 2026-10-30，PRD §13/§14/§15）
  'question',
  'answer',
  'progress',
  // 目标语义与软着陆（后端 2026-11-02，终止机制 devplan §6 / PRD §15）
  // - goal_update：Goal 的轮次/完成标准/blocker 指纹更新（同一 blocker 连续 3 轮才允许 blocked）
  // - soft_landing：撞上限进入收口模式（工具面收成只读 + 换提示词），是状态广播不是终态
  'goal_update',
  'soft_landing',
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
  /** 后端能力名（agent 按语义能力名解析出的实现） */
  capability?: string;
  /** `kernel` = 运行时补派（不是模型发起）；`internal` = 后端内部动作 */
  source?: string;
  /** 同参数查询被拦下、直接复用上次结果（PRD §13） */
  deduped?: boolean;
  /** 见底护栏回给模型的剩余回合数 */
  remaining_turns?: number;
  /** `tool` / `skill`：Skill 必须与普通工具分开显示 */
  kind?: string;
  /** 干净技能名（后端 kind=skill 时给出，不含 `skill:` 前缀） */
  skill?: string;
  /** 子 agent 名（subagent_tool 才有） */
  agent?: string;
  stage?: string;
  run_id?: string;
  /** 该子 agent 本次运行内的第几次调用（1 起；主 agent 为 undefined） */
  seq_in_run?: number;
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

/** ask_user 的提问（PRD §15） */
export interface QuestionDetail {
  question_id?: string;
  question?: string;
  options?: Array<{ id: string; label: string; detail?: string }>;
  allow_free_text?: boolean;
  default_option_id?: string | null;
  timeout_sec?: number;
  deadline_at?: number;
  context_refs?: string[];
  status?: string;
}

/** 用户/超时默认项的回答 */
export interface AnswerDetail {
  question_id?: string;
  option_id?: string | null;
  text?: string | null;
  source?: string;
  answered_at?: string;
}

/** Kernel 进度播报（PRD §14） */
export interface StageProgressDetail {
  trigger?: string;
  stage?: string;
  completed?: number;
  total?: number;
  percent?: number;
  action?: string;
  conclusion?: string;
  next_action?: string;
  decision_required?: boolean;
  decision_options?: Array<{ id: string; label: string }>;
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

/** 子 agent 分段进度（后端 subagent_progress） */
export interface SubagentProgressDetail {
  stage?: string;
  done?: number;
  total?: number;
  anim_id?: string;
  clip_id?: string;
  error?: string;
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
  | (ParsedEventBase & { kind: 'tool_call' | 'tool_result' | 'subagent_tool'; tool: ToolDetail })
  | (ParsedEventBase & { kind: 'step_start' | 'step_end'; stage: StageDetail })
  | (ParsedEventBase & { kind: 'narration' | 'thinking' | 'intent'; turn: ModelTurnDetail })
  | (ParsedEventBase & { kind: 'approval_request' | 'approval_result'; approval: ApprovalDetail })
  | (ParsedEventBase & { kind: 'agent_run_start' | 'agent_run_update' | 'agent_run_end'; run: AgentRunDetail })
  | (ParsedEventBase & { kind: 'context_loaded'; context: ContextDetail })
  | (ParsedEventBase & { kind: 'doc_write' | 'report'; doc: DocDetail })
  | (ParsedEventBase & { kind: 'subagent_progress'; progress: SubagentProgressDetail })
  | (ParsedEventBase & { kind: 'question'; question: QuestionDetail })
  | (ParsedEventBase & { kind: 'answer'; answer: AnswerDetail })
  | (ParsedEventBase & { kind: 'progress'; stageProgress: StageProgressDetail })
  // 目标语义 / 软着陆（后端 2026-11-02）：状态广播，不是终态；字段见 `control`
  | (ParsedEventBase & { kind: 'goal_update' | 'soft_landing'; control: Record<string, unknown> })
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
    case 'subagent_tool':
      return {
        ...base,
        kind,
        tool: {
          tool: String(raw.tool ?? event.message ?? ''),
          args: raw.args,
          status: str(raw.status),
          duration_ms: num(raw.duration_ms),
          error: str(raw.error),
          brief: str(raw.brief) ?? str(raw.args_brief),
          capability: str(raw.capability),
          source: str(raw.source),
          deduped: typeof raw.deduped === 'boolean' ? raw.deduped : undefined,
          remaining_turns: num(raw.remaining_turns),
          kind: str(raw.kind),
          agent: str(raw.agent),
          stage: str(raw.stage),
          run_id: str(raw.run_id),
          seq_in_run: num(raw.seq_in_run),
        },
      };
    case 'subagent_progress':
      return {
        ...base,
        kind,
        progress: {
          stage: str(raw.stage),
          done: num(raw.done),
          total: num(raw.total),
          anim_id: str(raw.anim_id),
          clip_id: str(raw.clip_id),
          error: str(raw.error),
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
    case 'question':
      return {
        ...base,
        kind,
        question: {
          question_id: str(raw.question_id),
          question: str(raw.question),
          options: Array.isArray(raw.options)
            ? (raw.options as Array<Record<string, unknown>>)
                .filter((o) => o && typeof o === 'object')
                .map((o) => ({
                  id: String(o.id ?? ''),
                  label: String(o.label ?? ''),
                  detail: str(o.detail),
                }))
                .filter((o) => o.id && o.label)
            : undefined,
          allow_free_text: typeof raw.allow_free_text === 'boolean'
            ? raw.allow_free_text : undefined,
          default_option_id: str(raw.default_option_id) ?? null,
          timeout_sec: num(raw.timeout_sec),
          deadline_at: num(raw.deadline_at),
          context_refs: strArr(raw.context_refs),
          status: str(raw.status),
        },
      };
    case 'answer':
      return {
        ...base,
        kind,
        answer: {
          question_id: str(raw.question_id),
          option_id: str(raw.option_id) ?? null,
          text: str(raw.text) ?? null,
          source: str(raw.source),
          answered_at: str(raw.answered_at),
        },
      };
    case 'progress':
      return {
        ...base,
        kind,
        stageProgress: {
          trigger: str(raw.trigger),
          stage: str(raw.stage),
          completed: num(raw.completed),
          total: num(raw.total),
          percent: num(raw.percent),
          action: str(raw.action),
          conclusion: str(raw.conclusion),
          next_action: str(raw.next_action),
          decision_required: typeof raw.decision_required === 'boolean'
            ? raw.decision_required : undefined,
          decision_options: Array.isArray(raw.decision_options)
            ? (raw.decision_options as Array<Record<string, unknown>>)
                .map((o) => ({ id: String(o.id ?? ''), label: String(o.label ?? '') }))
                .filter((o) => o.id && o.label)
            : undefined,
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
    case 'goal_update':
    case 'soft_landing':
      // 两者都是"运行中状态广播"：goal_update 说目标轮次/blocker 变到哪一步，
      // soft_landing 说已经进入收口模式（工具面收成只读）。未知键仍由 `...raw` 保留。
      return {
        ...base,
        kind,
        control: {
          rounds: num(raw.rounds),
          max_rounds: num(raw.max_rounds),
          blocker_code: str(raw.blocker_code),
          completion_criteria: str(raw.completion_criteria),
          mode: str(raw.mode),
          reason: str(raw.reason),
          ...raw,
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
