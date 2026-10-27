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
};
