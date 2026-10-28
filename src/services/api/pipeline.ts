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

  // ── PRD B4（2026-10-29 / G14）：后端已有、前端此前没有客户端的三条能力 ──
  //
  // 注意边界：这三条属于**旧 pipeline 侧的兼容能力**，不是新创作主路径
  // （主路径仍是 requirements/proceed → Task）。所以 UI 只做"显式入口 + 只读预览"，
  // 批量提交必须二次确认，脚本工具结果绝不自动写入时间线。

  /**
   * 批量启动管线（单批上限 10）。每条独立入队/计费；单条失败不影响其余。
   * 返回 `{results: [{ok, topic, pipeline_id?...}], ...}`。
   */
  async runBatch(requests: Array<Record<string, unknown>>): Promise<{
    results: Array<{ ok: boolean; topic?: string; pipeline_id?: string; error?: string }>;
    [key: string]: unknown;
  }> {
    const { data } = await getApiClient().post('/api/pipeline/run-batch', { requests });
    const payload = (data ?? {}) as { results?: unknown[] };
    return {
      ...(payload as Record<string, unknown>),
      results: Array.isArray(payload.results)
        ? (payload.results as Array<{ ok: boolean; topic?: string; pipeline_id?: string; error?: string }>)
        : [],
    };
  },

  /**
   * 脚本工具：改写 / 扩写 / 缩写（LLM）。
   * 返回 `{mode, result, fallback?, note?}`；`fallback=true` 表示 LLM 不可用、返回原文。
   */
  async scriptTools(body: {
    mode: 'rewrite' | 'expand' | 'summarize';
    script_text: string;
    style?: string;
    max_length?: number;
  }): Promise<{ mode: string; result: string; fallback?: boolean; note?: string }> {
    const { data } = await getApiClient().post('/api/pipeline/script-tools', body);
    const payload = (data ?? {}) as Record<string, unknown>;
    return {
      mode: String(payload.mode ?? body.mode),
      result: String(payload.result ?? ''),
      fallback: Boolean(payload.fallback),
      note: payload.note ? String(payload.note) : undefined,
    };
  },

  /** 选题建议（LLM + 可选 trending，启发式回退）：返回 `[{title, reason}]`。 */
  async topicSuggest(body: { category?: string; count?: number; use_web?: boolean } = {}): Promise<{
    topics: Array<{ title: string; reason: string }>;
  }> {
    const { data } = await getApiClient().post('/api/pipeline/topic-suggest', {
      category: body.category ?? '',
      count: body.count ?? 5,
      use_web: body.use_web ?? false,
    });
    const payload = (data ?? {}) as { topics?: unknown[] };
    const topics = Array.isArray(payload.topics)
      ? payload.topics
        .map((t) => t as { title?: unknown; reason?: unknown })
        .map((t) => ({ title: String(t.title ?? ''), reason: String(t.reason ?? '') }))
        .filter((t) => t.title)
      : [];
    return { topics };
  },
};
