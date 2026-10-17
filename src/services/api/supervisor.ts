/**
 * 调度中枢 API 客户端 —— 对齐后端 `clipwright/api/supervisor.py`。
 *
 * 约定：与 `pipelineApi` 一致，直接返回 `data`（不返回 axios response）；
 * 统一走 `getApiClient()`，不新建实例（鉴权/续期拦截器复用）。
 */

import { getApiClient } from './client';
import type {
  AttributionResponse,
  DecisionsResponse,
  DiagnosisResponse,
  LedgerResponse,
  PendingExecApproval,
  PendingWorkerReview,
  SubagentNode,
  SubagentsResponse,
  ExecRecord,
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

  // ── 以下为 B7–B9 端点（后端就绪后启用；前端 F6–F8 依赖）──

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
};
