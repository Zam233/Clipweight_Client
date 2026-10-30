/**
 * 任务类型（路线 C / C4）—— 对齐后端 `clipwright/schema/task.py`。
 *
 * 与管线类型的根本区别：**没有"阶段"**。用户看到的最小单位是 Step（一步能力调用），
 * 而 `phase` 这种"当前在哪个 Agent"的概念在这里不存在——它是管线时代的产物。
 */

export type TaskStatus =
  | 'pending'
  | 'planning'
  | 'running'
  | 'paused'
  /** PRD §15：主 agent 提了问题、正在等回答 */
  | 'waiting_user'
  | 'done'
  | 'failed'
  | 'cancelled'
  /**
   * PRD B5（2026-10-29 / G10）：后端 `task_end.reason` 出现前端不认识的值时用这个状态，
   * 而不是一律塞进 `failed`。UI 显示「后端终态：<reason>」，用户能区分"真的失败"
   * 与"前端还没适配的新终态"。
   */
  | 'unknown_terminal';

export type StepStatus = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export type CapabilityKind = 'tool' | 'skill' | 'pipeline' | 'subagent' | 'meta';

export type TaskEventType =
  | 'task_start'
  | 'plan'
  | 'replan'
  | 'step_start'
  | 'tool_call'
  | 'tool_result'
  | 'approval_request'
  | 'approval_result'
  | 'degradation'
  | 'artifact'
  | 'step_end'
  | 'gate_hit'
  | 'checkpoint'
  | 'task_end'
  | 'inject'
  // PRD §19.4/§19.9：叙述 / 意图 / 思考 / 汇报 / 文档写入 / 上下文装载
  | 'narration'
  | 'intent'
  | 'thinking'
  | 'report'
  | 'doc_write'
  | 'context_loaded'
  // M3：统一 AgentRun 事件（阶段与调研同一组）
  | 'agent_run_start'
  | 'agent_run_update'
  | 'agent_run_end'
  // 子 agent 透明化（后端 2026-10-29）
  | 'subagent_tool'
  | 'subagent_progress'
  // 反思流 / 主动询问 / 进度播报（后端 2026-10-30，PRD §13/§14/§15）
  | 'question'
  | 'answer'
  | 'progress';

export interface PlanStep {
  id: string;
  title: string;
  capability: string;
  kind: CapabilityKind;
  args: Record<string, unknown>;
  why: string;
  est_cost_usd: number | null;
  status: StepStatus;
  attempt: number;
  result_brief: string;
  error: string | null;
  duration_ms: number;
}

export interface Plan {
  steps: PlanStep[];
  version: number;
  rationale: string;
  est_total_cost_usd: number | null;
  created_at: string;
  /**
   * 主 agent 化之后 Plan 只是「初始假设」：真实执行由 tool_loop 按现场决定，
   * 步骤状态可能永远停在 pending。UI 必须按假设展示，不能当成执行进度条
   * （2026-10-28 PRD B10 / 缺口 N2）。后端默认 true。
   */
  hypothesis_only?: boolean;
}

export interface TaskLimits {
  max_turns: number;
  max_tool_calls: number;
  max_wall_sec: number;
  /** null = 未配置预算（无上限，只记账） */
  budget_usd: number | null;
}

export interface TaskUsage {
  turns: number;
  tool_calls: number;
  tokens: number;
  cost_usd: number;
  wall_sec: number;
  /**
   * PRD B7（2026-10-29 / G11）：后端 `TaskUsage.unknown_cost_calls`（`schema/task.py:157`）——
   * 「成本未知」的调用次数。这些调用**没被计入 `cost_usd`**，所以 UI 不能只显示金额，
   * 否则用户会把"未知"读成 0。
   */
  unknown_cost_calls?: number;
}

export interface TaskFinish {
  conclusion: string;
  completed: string[];
  unfinished: string[];
  reason: string;
}

export interface TaskRequestView {
  topic: string;
  persona_id: string;
  category_plugin_id: string;
  duration_sec: number;
  plan_only: boolean;
  extra: Record<string, unknown>;
}

export interface Task {
  id: string;
  status: TaskStatus;
  mode: string;
  request: TaskRequestView;
  plan: Plan | null;
  limits: TaskLimits;
  usage: TaskUsage;
  finish: TaskFinish | null;
  context_digest: Array<Record<string, unknown>>;
  created_at: string;
  updated_at: string;
}

export interface TaskEvent {
  seq: number;
  type: TaskEventType;
  ts: string;
  message: string;
  detail: Record<string, unknown>;
  /** trace 信封（B12）：结果事件用 causation_id 指回它对应的调用事件 `seq:<n>` */
  causation_id?: string;
  trace_id?: string;
  run_id?: string;
  span?: string;
}

export interface CreateTaskBody {
  topic: string;
  persona_id?: string;
  category_plugin_id?: string;
  duration_sec?: number;
  /** Q3：默认 true —— 先出计划给用户看，不偷偷开跑 */
  plan_only?: boolean;
  extra?: Record<string, unknown>;
}

export interface TaskListItem {
  id: string;
  status: TaskStatus;
  topic: string;
  updated_at: string;
  steps: number;
}

/**
 * 一次工具调用（全量轨迹里的一行，PRD modern-agent-review M3）。
 *
 * `source === 'internal'` 表示这是后端**内部操作**（MG 生成、素材检索、技能调用等），
 * 不是 LLM 主动发的工具调用——以前这类动作在 UI 上是黑区，现在照样落在轨迹里。
 */
export interface TaskToolCall {
  tool: string;
  capability?: string;
  status?: string;
  duration_ms?: number;
  args_brief?: string;
  output_brief?: string;
  error?: string;
  source?: string;
  [key: string]: unknown;
}

/** `GET /api/task/{id}/tool-calls` 的响应：某阶段某次尝试的完整轨迹（分页）。 */
export interface TaskToolCalls {
  task_id: string;
  stage: string;
  attempt: number;
  path: string;
  total: number;
  offset: number;
  limit: number;
  count: number;
  /** 内部操作条数（source=internal） */
  internal: number;
  /** 失败条数（status 非 success/ok/空） */
  failed: number;
  items: TaskToolCall[];
  /** 磁盘上可看的 `<stage>-<attempt>` 列表 */
  available: string[];
}


/** 一个子 agent run 的摘要（`GET /api/task/{id}/runs`）。 */
export interface TaskRunSummary {
  run_id: string;
  kind: string;
  stage: string;
  role: string;
  status: string;
  attempt: number;
  duration_ms: number;
  cost_usd: number | null;
  degradations: number;
  tool_calls: number;
  tool_calls_path: string;
  report_path: string;
  summary: string;
  replayed: boolean;
}

/** 一次派发里的单条降级（run 详情用） */
export interface TaskRunDegradation {
  kind?: string;
  scope?: string;
  detail?: string;
  impact?: string;
  [key: string]: unknown;
}

/** `GET /api/task/{id}/runs/{run_id}` 里的 AgentResult（只声明前端要读的字段） */
export interface TaskRunDetail {
  run_id?: string;
  kind?: string;
  stage?: string;
  role?: string;
  status?: string;
  attempt?: number;
  task_id?: string;
  summary?: string;
  brief?: string;
  outputs?: Record<string, unknown>;
  writes?: string[];
  needs?: Array<Record<string, unknown>>;
  failure?: Record<string, unknown> | null;
  degradations?: TaskRunDegradation[];
  tool_calls?: Array<Record<string, unknown>>;
  tool_calls_path?: string;
  duration_ms?: number;
  cost_usd?: number | null;
  provider?: string;
  model?: string;
  replayed?: boolean;
  [key: string]: unknown;
}
