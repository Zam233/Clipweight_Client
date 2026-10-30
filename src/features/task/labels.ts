/**
 * 任务的对外文案映射（路线 C / C4）。
 *
 * 纪律（与 supervisor 同一套）：界面**不出现内部名**——不写 `run_pipeline`、
 * 不写 `write_local`。用户看到的是「整片生成」「会写入项目目录」。
 */

import type { CapabilityKind, StepStatus, TaskEventType, TaskStatus } from '@/types/task';

export const KIND_CN: Record<CapabilityKind, string> = {
  tool: '工具',
  skill: '技能',
  pipeline: '整片生成',
  subagent: '子代理',
  meta: '执行',
};

export const STATUS_CN: Record<TaskStatus, string> = {
  pending: '待开始',
  planning: '正在规划',
  running: '执行中',
  paused: '已暂停',
  waiting_user: '等待你的回答',
  done: '已完成',
  failed: '未完成',
  cancelled: '已取消',
  // PRD B5：后端给了前端还不认识的终态原因——如实说"后端终态"，不冒充失败
  unknown_terminal: '后端终态（待适配）',
};

export const STEP_STATUS_CN: Record<StepStatus, string> = {
  pending: '待执行',
  running: '执行中',
  done: '完成',
  failed: '失败',
  skipped: '跳过',
};

export const EVENT_CN: Record<TaskEventType, string> = {
  task_start: '任务开始',
  plan: '计划',
  replan: '改计划',
  step_start: '开始一步',
  tool_call: '调用能力',
  tool_result: '调用结果',
  approval_request: '请求授权',
  approval_result: '授权结果',
  degradation: '降级',
  artifact: '产物',
  step_end: '一步结束',
  gate_hit: '触发上限',
  checkpoint: '存档',
  task_end: '任务结束',
  inject: '人工插话',
  // PRD §19.4/§19.9
  narration: '主 agent 说明',
  intent: '准备执行',
  thinking: '思考',
  report: '阶段汇报',
  doc_write: '写入文档',
  context_loaded: '装载上下文',
  // M3：统一 AgentRun 事件
  agent_run_start: '派出子 agent',
  agent_run_update: '子 agent 进展',
  agent_run_end: '子 agent 结束',
  subagent_tool: '子 agent 工具调用',
  subagent_progress: '子 agent 进度',
  // 反思流 / 主动询问 / 进度播报（2026-10-30）
  question: '向你提问',
  answer: '已回答',
  progress: '阶段进度',
};

/**
 * `finish.reason` → 中文（PRD §6.1 文案表）。
 *
 * 只影响"为什么结束"这句话，**不改任务状态**：状态永远以后端 `status` 为准。
 * 返回空串表示"前端还不认识这个 reason"，调用方要原样展示并标「待适配」。
 */
const FINISH_REASON_CN: Record<string, string> = {
  tool_loop_completed: 'Agent 执行完成',
  plan_completed: '计划执行完成',
  task_completed: '任务完成',
  dry_run_preview: '预览运行完成（dry-run）',
  degradation_unresolved: '仍有降级未处置',
  cancelled: '任务已取消',
  cancel: '任务已取消',
  paused: '任务已暂停',
  validation_failed: '结果校验未通过',
};

export function finishReasonLabel(reason: string): string {
  const key = String(reason || '').trim();
  if (!key) return '未记录结束原因';
  if (key.startsWith('gate:')) return `达到运行限制：${key.slice(5) || '未知限制'}`;
  if (key.startsWith('tool_loop_error')) return 'Agent 执行出错';
  if (key.startsWith('tool_loop_unavailable')) return 'Agent 执行服务不可用';
  if (key.startsWith('step_failed')) return '执行步骤失败';
  return FINISH_REASON_CN[key] ?? '';
}

export function eventLabel(type: string): string {
  return EVENT_CN[type as TaskEventType] ?? type;
}

export function statusLabel(status: TaskStatus | string): string {
  return STATUS_CN[status as TaskStatus] ?? String(status || '');
}

export function stepLabel(step: { title?: string; capability: string }): string {
  return step.title || step.capability;
}

/** 金额文案：**未配置单价 ≠ $0**，必须说清差别。 */
export function moneyText(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return '未配置单价';
  if (usd <= 0) return '$0（未配置单价）';
  return `$${usd.toFixed(4)}`;
}

export function durationText(sec: number): string {
  if (!sec) return '0s';
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}m${s ? ` ${s}s` : ''}`;
}

