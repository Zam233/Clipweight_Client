import { getApiClient } from './client';
import type { PipelineRequest, PipelineState } from '@/types/pipeline';
import type { Timeline } from '@/types/timeline';

export const pipelineApi = {
  /** Run pipeline v2 (dynamic routing + self-heal) */
  async runV2(request: PipelineRequest) {
    const { data } = await getApiClient().post('/api/pipeline/run-v2', request);
    return data as { pipeline_id: string; status: string; steps: unknown[]; error?: string };
  },

  /** Run pipeline (fixed sequence) */
  async run(request: PipelineRequest) {
    const { data } = await getApiClient().post<PipelineState>('/api/pipeline/run', request);
    return data;
  },

  /** Run pipeline async, returns pipeline_id immediately */
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
    return data as { pipeline_id: string; status: string; phase?: string; progress?: number };
  },

  /** Retry from failed agent */
  async retry(pipelineId: string, agentName: string) {
    const { data } = await getApiClient().post(
      `/api/pipeline/retry/${pipelineId}/${agentName}`,
    );
    return data;
  },

  /** Regenerate a specific scene */
  async regenerateScene(pipelineId: string, sceneIndex: number) {
    const { data } = await getApiClient().post(
      `/api/pipeline/regenerate-scene/${pipelineId}/${sceneIndex}`,
    );
    return data;
  },

  /** Run single agent step */
  async step(agentName: string, request: Record<string, unknown>) {
    const { data } = await getApiClient().post(`/api/pipeline/step/${agentName}`, request);
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

  /** Create SSE stream URL for pipeline trace */
  getTraceStreamUrl(pipelineId: string): string {
    const base = getApiClient().defaults.baseURL || 'http://localhost:8000';
    return `${base}/api/pipeline/trace/stream/${pipelineId}`;
  },
};
