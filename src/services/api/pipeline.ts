import { getApiClient } from './client';
import { apiBase } from './sse';
import type { PipelineRequest } from '@/types/pipeline';

/** Single Agent span inside a pipeline run record (aligned with backend pipeline_v2.get_run_records). */
export interface PipelineSpan {
  agent: string;
  start: number;
  dur: number;
  status: 'ok' | 'fail' | 'retry';
}

/** Pipeline run history record — shape of GET /api/pipeline/runs. */
export interface PipelineRunRecord {
  id: string;
  topic: string;
  status: 'completed' | 'running' | 'failed';
  duration_ms: number;
  started_at: string;
  agents: PipelineSpan[];
}

export const pipelineApi = {
  /**
   * @deprecated PRD B1（2026-10-29）：**已退役**。后端 `/api/pipeline/run-async`
   * 只在 `agent_mode=on` 时转成 Task，其余情况返回 410。新任务请走
   * `requirementsApi.proceed`（`POST /api/requirements/proceed`）或 `taskApi.create`
   * （`POST /api/task`）。此方法仅为老外部调用方保留签名，新 UI 不得使用。
   */
  async runAsync(request: PipelineRequest) {
    const { data } = await getApiClient().post('/api/pipeline/run-async', request);
    return data as { pipeline_id: string; status: string };
  },

  /** Get pipeline result */
  async getResult(pipelineId: string) {
    const { data } = await getApiClient().get(`/api/pipeline/result/${pipelineId}`);
    return data;
  },

  /** Get pipeline status */
  async getStatus(pipelineId: string) {
    const { data } = await getApiClient().get(`/api/pipeline/status/${pipelineId}`);
    return data as { pipeline_id: string; status: string; has_result: boolean };
  },

  /** Get pipeline run history (real execution records for the admin console) */
  async getRunRecords(limit = 50): Promise<PipelineRunRecord[]> {
    const { data } = await getApiClient().get('/api/pipeline/runs', {
      params: { limit },
    });
    if (!Array.isArray(data)) return [];
    return data as PipelineRunRecord[];
  },

  /** A10: 队列任务概览（含重启恢复项 recovered/interrupted） */
  async getTasks(limit = 50) {
    const { data } = await getApiClient().get('/api/pipeline/tasks', {
      params: { limit },
    });
    return data as {
      tasks: Array<{
        task_id: string;
        task_type: string;
        priority: number;
        status: string;
        progress: number;
        progress_text: string;
        error: string;
        duration_sec: number;
        created_at: string;
      }>;
      recovered: Array<Record<string, unknown> & { task_id: string; recovered: boolean; status: string }>;
      running: number;
      pending: number;
    };
  },

  /**
   * @deprecated PRD B1（2026-10-29）：**已退役**。后端 `/api/pipeline/retry/{id}/{agent}`
   * 返回 410（执行引擎已在 M3 物理删除，依赖闭包由 `replan_closure` 计算）。
   * 恢复任务请走主 Agent 任务：`POST /api/task/{id}/resume`，或让主 agent
   * 重新 `delegate_agent` 失败的那个阶段。此方法仅为老外部调用方保留签名。
   */
  async retry(pipelineId: string, agentName: string) {
    const { data } = await getApiClient().post(
      `/api/pipeline/retry/${pipelineId}/${agentName}`,
    );
    return data;
  },

  /** Cancel a running pipeline (cooperative cancel, backend marks step CANCELLED) */
  async cancel(pipelineId: string) {
    const { data } = await getApiClient().post(
      `/api/pipeline/cancel/${pipelineId}`,
    );
    return data;
  },

  /** Predict script configuration */
  async predictScript(scriptText: string) {
    const { data } = await getApiClient().post(
      '/api/pipeline/predict-script',
      { script_text: scriptText },
    );
    return data;
  },

  /** Predict material usage (analyze a material file) */
  async predictMaterial(filePath: string, fileSize = 0) {
    const { data } = await getApiClient().post(
      '/api/pipeline/predict-material',
      { file_path: filePath, file_size: fileSize },
    );
    return data;
  },

  /** Get pipeline trace events as a JSON array */
  async getTraceJson(pipelineId: string) {
    const { data } = await getApiClient().get(`/api/pipeline/trace/${pipelineId}`);
    return data as Array<{
      type: string;
      time: number;
      agent?: string;
      message?: string;
      [key: string]: unknown;
    }>;
  },

  /** Create SSE stream URL for pipeline trace（token 由调用方用 withSseToken 附加） */
  getTraceStreamUrl(pipelineId: string): string {
    return `${apiBase()}/api/pipeline/trace/stream/${pipelineId}`;
  },
};
