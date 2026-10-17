/**
 * 调度中枢 API 客户端 —— 对齐后端 `clipwright/api/supervisor.py`。
 *
 * 约定：与 `pipelineApi` 一致，直接返回 `data`（不返回 axios response）；
 * 统一走 `getApiClient()`，不新建实例（鉴权/续期拦截器复用）。
 */

import { getApiClient } from './client';
import type {
  AttributionResponse,
  BudgetSnapshot,
  DecisionsResponse,
  DiagnosisResponse,
  DispatchResponse,
  ExecRecord,
  ExecRequest,
  ExecResponse,
  LedgerResponse,
  PendingExecApproval,
  PendingWorkerReview,
  RouteCandidate,
  RoutesResponse,
  SubagentNode,
  SubagentsResponse,
  SuggestionResponse,
} from '@/types/supervisor';

export const supervisorApi = {
  /** 账本（PRD F1）。未知管线返回 found=false 而非 404。 */
  async getLedger(pipelineId: string, stage?: string): Promise<LedgerResponse> {
    const { data } = await getApiClient().get<LedgerResponse>(
      `/api/pipeline/${pipelineId}/ledger`,
      { params: stage ? { stage } : undefined },
    );
    return data;
  },

  /** 归因（PRD F2）。llm=true 才允许规则不命中时走兜底判定。 */
  async getAttribution(pipelineId: string, llm = false): Promise<AttributionResponse> {
    const { data } = await getApiClient().get<AttributionResponse>(
      `/api/pipeline/${pipelineId}/attribution`,
      { params: llm ? { llm: true } : undefined },
    );
    return data;
  },

  /** 诊断书（PRD F5，模板化，无 LLM）。 */
  async getDiagnosis(pipelineId: string): Promise<DiagnosisResponse> {
    const { data } = await getApiClient().get<DiagnosisResponse>(
      `/api/pipeline/${pipelineId}/diagnosis`,
    );
    return data;
  },

  /** 调度决策序列（PRD F3/F4，调度面板数据源）。 */
  async getDecisions(pipelineId: string): Promise<DecisionsResponse> {
    const { data } = await getApiClient().get<DecisionsResponse>(
      `/api/pipeline/${pipelineId}/decisions`,
    );
    return data;
  },

  /** 预算快照（PRD F6）。未配置预算时 level=unlimited、ratio=null。 */
  async getBudget(pipelineId: string): Promise<BudgetSnapshot> {
    const { data } = await getApiClient().get<BudgetSnapshot>(
      `/api/pipeline/${pipelineId}/budget`,
    );
    return data;
  },

  /** 人工改派工单（PRD F7）：登记 + **真跑一次重跑**（`auto_retry` 默认 true）。 */
  async dispatch(
    pipelineId: string,
    body: {
      target_stage: string;
      reason?: string;
      issues?: unknown[];
      auto_retry?: boolean;
    },
  ): Promise<DispatchResponse> {
    const { data } = await getApiClient().post<DispatchResponse>(
      `/api/pipeline/${pipelineId}/dispatch`,
      body,
    );
    return data;
  },

  /** 执行诊断书建议（PRD F7）：接受降级 / 换模型重跑 / 重做某阶段。 */
  async acceptSuggestion(
    pipelineId: string,
    body: { suggestion_id?: string; action?: string; target_stage?: string } = {},
  ): Promise<SuggestionResponse> {
    const { data } = await getApiClient().post<SuggestionResponse>(
      `/api/pipeline/${pipelineId}/accept-suggestion`,
      body,
    );
    return data;
  },

  // ── B7–B9 端点（子代理 / 执行 / 授权 / worker 审核）──

  /** 子代理树（PRD F12）。 */
  async getSubagents(pipelineId: string): Promise<SubagentsResponse> {
    const { data } = await getApiClient().get<SubagentsResponse>(
      `/api/pipeline/${pipelineId}/subagents`,
    );
    return data;
  },

  async cancelSubagent(pipelineId: string, subagentId: string): Promise<void> {
    await getApiClient().post(`/api/pipeline/${pipelineId}/subagents/${subagentId}/cancel`);
  },

  /** 执行日志（PRD F11）。 */
  async getExecLog(pipelineId: string): Promise<{ records: ExecRecord[] }> {
    const { data } = await getApiClient().get(`/api/pipeline/${pipelineId}/exec`);
    return data as { records: ExecRecord[] };
  },

  /**
   * 请求执行（PRD F11）：低风险直接跑；`med+` 返回 `pending_approval`（等授权）；
   * 命中硬底线返回 `rejected`（**任何模式都不可授权**）。
   */
  async requestExec(pipelineId: string, body: ExecRequest): Promise<ExecResponse> {
    const { data } = await getApiClient().post(`/api/pipeline/${pipelineId}/exec`, body);
    return data as ExecResponse;
  },

  async approveExec(pipelineId: string, execId: string, confirmHighRisk = false): Promise<void> {
    await getApiClient().post(`/api/pipeline/${pipelineId}/exec/${execId}/approve`, {
      confirm_high_risk: confirmHighRisk,
    });
  },

  async rejectExec(pipelineId: string, execId: string): Promise<void> {
    await getApiClient().post(`/api/pipeline/${pipelineId}/exec/${execId}/reject`);
  },

  /** 自动模式开关（用户决定；状态入账）。 */
  async getAutoMode(pipelineId: string): Promise<{ enabled: boolean }> {
    const { data } = await getApiClient().get(`/api/pipeline/${pipelineId}/exec/auto-mode`);
    return data as { enabled: boolean };
  },

  async setAutoMode(pipelineId: string, enabled: boolean): Promise<{ enabled: boolean }> {
    const { data } = await getApiClient().put(
      `/api/pipeline/${pipelineId}/exec/auto-mode`,
      { enabled },
    );
    return data as { enabled: boolean };
  },

  /** 待审核的临时 worker（PRD F10 审核门）。 */
  async getPendingWorkerReviews(): Promise<{ items: PendingWorkerReview[] }> {
    const { data } = await getApiClient().get('/api/supervisor/workers/pending-review');
    return data as { items: PendingWorkerReview[] };
  },

  async reviewWorker(
    workerId: string,
    approve: boolean,
    confirmHighRisk = false,
  ): Promise<void> {
    await getApiClient().post(`/api/supervisor/workers/${workerId}/review`, {
      approve,
      confirm_high_risk: confirmHighRisk,
    });
  },

  /** 待授权的执行命令（前端授权弹窗数据源）。 */
  async getPendingApprovals(pipelineId: string): Promise<{ items: PendingExecApproval[] }> {
    const { data } = await getApiClient().get(
      `/api/pipeline/${pipelineId}/exec/pending-approvals`,
    );
    return data as { items: PendingExecApproval[] };
  },

  // ── 路由表与模式（管理员，F5）────────────────────────────

  async getRoutes(): Promise<RoutesResponse> {
    const { data } = await getApiClient().get<RoutesResponse>('/api/supervisor/routes');
    return data;
  },

  async updateRoutes(
    body: { routes?: RouteCandidate[][]; whitelist?: string[] } | Record<string, unknown>,
  ): Promise<{ applied: string[]; how: string }> {
    const { data } = await getApiClient().put('/api/supervisor/routes', body);
    return data as { applied: string[]; how: string };
  },

  async getMode(): Promise<{ mode: 'off' | 'shadow' | 'on' }> {
    const { data } = await getApiClient().get('/api/supervisor/mode');
    return data as { mode: 'off' | 'shadow' | 'on' };
  },

  async setMode(mode: 'off' | 'shadow' | 'on'): Promise<{ mode: string; how: string }> {
    const { data } = await getApiClient().put('/api/supervisor/mode', { mode });
    return data as { mode: string; how: string };
  },
};
