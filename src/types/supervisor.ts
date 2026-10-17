/**
 * 调度中枢（Supervisor）类型层 —— 对齐后端 `clipwright/schema/supervisor.py`。
 *
 * 契约优先：后端契约变更必须先改本文件（对账见 docs/frontend-backend-parity.md）。
 * B2 起逐步增长：账本 / 归因 / 诊断书；B3+ 追加派工单、子代理、执行记录。
 */

// ── 账本（F1 / B1）────────────────────────────────────────────

export type FailureCategory =
  | 'resource_missing'
  | 'input_insufficient'
  | 'model_incapable'
  | 'timeout'
  | 'external_unavailable'
  | 'constraint_conflict'
  | 'internal_defect'
  | 'unknown';

export type RetryMode = 'retry_same' | 'needs_upstream' | 'needs_human' | 'permanent';

export interface FailureReport {
  category: FailureCategory;
  blocking_point?: string;
  location?: Record<string, unknown>;
  attempts?: Array<Record<string, unknown>>;
  retryable?: RetryMode;
  needs?: Array<{ from_stage: string; field: string; why?: string }>;
  evidence?: Array<Record<string, unknown>>;
}

export interface Degradation {
  kind: string;
  detail: string;
  scope: string;
  impact: string;
}

export interface LedgerEntry {
  id: string;
  stage: string;
  attempt: number;
  decision: 'pass' | 'fail' | 'cancelled' | 'skipped' | string;
  input_digest?: string;
  failure?: FailureReport | null;
  degradations: Degradation[];
  warnings: string[];
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number; [k: string]: unknown };
  duration_ms: number;
  ts: string;
}

export interface LedgerResponse {
  pipeline_id: string;
  found: boolean;
  count: number;
  attempts: Record<string, number>;
  entries: LedgerEntry[];
  source?: 'mongo';
}

// ── 归因（F2 / B2）────────────────────────────────────────────

export type Confidence = 'high' | 'mid' | 'low';

export interface Attribution {
  primary_stage: string;
  upstream_chain: string[];
  evidence_refs: string[];
  confidence: Confidence;
  unrepairable: boolean;
  reason: string;
  source: 'rule' | 'llm' | 'fallback';
}

export interface AttributionResponse extends Attribution {
  pipeline_id: string;
  found: boolean;
}

// ── 诊断书（F5 / B2）──────────────────────────────────────────

export type SuggestionAction =
  | 'retry_with_model'
  | 'redo_stage'
  | 'accept_degraded'
  | 'manual';

export interface DiagnosisSuggestion {
  id: string;
  label: string;
  action: SuggestionAction;
  target_stage?: string;
  est_cost_usd?: number | null;
}

export interface DiagnosisReport {
  conclusion: string;
  problems: Array<{
    severity: 'error' | 'warning' | string;
    title: string;
    location?: string;
    stage?: string;
    category?: string;
  }>;
  evidence: Array<{ text: string; ref?: string }>;
  attempted: Array<{ action: string; outcome: string }>;
  suggestions: DiagnosisSuggestion[];
  cost: {
    tokens: number;
    spent_usd: number | null;
    budget_usd: number | null;
    subagent_tokens: number;
  };
  mode: 'off' | 'shadow' | 'on';
  pipeline_id: string;
}

export interface DiagnosisResponse extends DiagnosisReport {
  found: boolean;
}

// ── 预算（F6 / B5）────────────────────────────────────────────

export interface BudgetSnapshot {
  spent_usd: number;
  /** false = 设置里未填预算（PRD F6：无上限，不阻断） */
  budgetEnabled: boolean;
  budget_usd?: number;
  ratio?: number;
  level: 'unlimited' | 'ok' | 'warn' | 'blocked';
  subagentSpentUsd?: number;
}

// ── 调度决策（F3/F4 / B3）─────────────────────────────────────

export type Strategy =
  | 'S1_same'
  | 'S2_model'
  | 'S3_upstream'
  | 'S4_accept_degraded'
  | 'S5_new_path'
  | 'S6_abort';

export interface SupervisorDecision {
  id: string;
  strategy: Strategy | string;
  target_stage: string;
  reason: string;
  allow_degrade: boolean;
  aborted: boolean;
  stage_attempts: Record<string, number>;
  previous_strategy?: string;
  mode: 'off' | 'shadow' | 'on' | string;
  ts?: string;
}

export interface DecisionsResponse {
  pipeline_id: string;
  found: boolean;
  count: number;
  accepted_degraded: boolean;
  decisions: SupervisorDecision[];
}

/** 调度中枢的 SSE 事件（复用管线 trace 流，按 type 分流） */
export type SupervisorSSEEvent =
  | { type: 'ledger_entry'; data?: LedgerEntry | Record<string, unknown> }
  | { type: 'attribution'; data?: Attribution }
  | { type: 'diag_report'; data?: DiagnosisReport }
  | { type: 'dispatch'; data?: SupervisorDecision };

// ── 子代理（F10/F12 / B7–B8）──────────────────────────────────

export type SubagentStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled';

export interface SubagentNode {
  id: string;
  parentId?: string | null;
  role: string;
  kind: 'stage' | 'plugin' | 'ephemeral';
  status: SubagentStatus;
  model?: { provider: string; model: string };
  durationMs?: number;
  costUsd?: number;
  lastOutput?: string;
  cancellable: boolean;
}

// ── 执行（F11 / B9）──────────────────────────────────────────

export type RiskLevel = 'low' | 'med' | 'high' | 'critical';

export interface ExecRecord {
  id: string;
  ts: string;
  kind: 'shell' | 'python';
  command: string;
  cwd: string;
  riskLevel: RiskLevel;
  riskReasons: string[];
  dangerExplanation?: string;
  autoMode: boolean;
  exitCode: number | null;
  durationMs: number;
  outputTail?: string;
  rejected?: { reason: string };
}

export interface PendingExecApproval {
  id: string;
  command: string;
  riskLevel: Exclude<RiskLevel, 'low'>;
  riskReasons: string[];
  dangerExplanation: string;
  requestedBy: string;
  expiresAt: string;
}

export interface PendingWorkerReview {
  id: string;
  role: string;
  toolAllowlist: string[];
  hasExecPermission: boolean;
  systemPrompt: string;
  risk: { level: 'low' | 'med' | 'high'; reasons: string[]; suggestedAction: string };
  createdAt: string;
}
