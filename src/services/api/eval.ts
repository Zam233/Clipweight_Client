/**
 * 评估报告 API 客户端（closeout B10）。
 *
 * 数据源：`GET /api/eval/reports`（列表摘要）/ `/api/eval/reports/{name}`（全文）。
 * 报告由后端 `python -m clipwright.services.golden_eval` 生成，落 `_cache/eval`。
 */
import { getApiClient } from './client';

export interface EvalReportSummary {
  name: string;
  topic_id?: string;
  topic?: string;
  runs?: number;
  success_rate_mean?: number | null;
  success_rate_spread?: number | null;
  cost_avg_usd?: number | null;
  warnings?: number;
  mtime?: number;
  error?: string;
}

export interface EvalMetricSummary {
  n?: number;
  mean?: number;
  min?: number;
  max?: number;
  spread?: number;
}

export interface EvalReportPayload {
  ok?: boolean;
  runs?: number;
  topic?: { id?: string; topic?: string; duration_sec?: number };
  metrics?: Record<string, EvalMetricSummary>;
  warnings?: string[];
  raw_runs?: {
    task_id?: string;
    status?: string;
    finish_reason?: string;
    turns?: number;
    tool_calls?: number;
    cost_usd?: number | null;
    wall_sec?: number;
  }[];
  generated_at?: number;
}

export const evalApi = {
  async listReports(limit = 50): Promise<{ count: number; items: EvalReportSummary[] }> {
    const { data } = await getApiClient().get('/api/eval/reports', { params: { limit } });
    return data;
  },

  async getReport(name: string): Promise<{ name: string; payload: EvalReportPayload }> {
    const { data } = await getApiClient().get(
      `/api/eval/reports/${encodeURIComponent(name)}`,
    );
    return data;
  },

  /**
   * 最近一份报告（PRD B9 / G13）：`GET /api/eval/latest`。
   *
   * 后端"没有报告"时返回 **404**（`clipwright/api/eval.py:79-87`），那是**正常空态**，
   * 不是错误——所以这里把 404 映射成 `null`，其它错误照常抛出，让面板能区分
   * "还没跑过评估" 与 "接口/网络挂了"。
   */
  async latest(): Promise<{ name: string; payload: EvalReportPayload } | null> {
    try {
      const { data } = await getApiClient().get('/api/eval/latest');
      const payload = (data ?? {}) as { name?: string; payload?: EvalReportPayload };
      // 后端直接返回报告 payload（可能不含 name）——两种形状都接住
      const body = (payload.payload ?? (data as EvalReportPayload)) ?? {};
      return { name: String(payload.name ?? 'latest'), payload: body as EvalReportPayload };
    } catch (e) {
      const status = (e as { response?: { status?: number } })?.response?.status;
      if (status === 404) return null;
      throw e;
    }
  },
};
