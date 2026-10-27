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
  | 'done'
  | 'failed'
  | 'cancelled';

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
  | 'agent_run_end';

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
