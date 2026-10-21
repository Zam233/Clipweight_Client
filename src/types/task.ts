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
  | 'inject';

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
