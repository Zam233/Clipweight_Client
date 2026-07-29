import { getApiClient } from './client';

export interface PreprocessOp {
  id: string;
  name: string;
  description: string;
}

export interface PreprocessTask {
  id: string;
  op_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress: number;
  result?: Record<string, unknown>;
}

export const preprocessApi = {
  async listOperations(): Promise<PreprocessOp[]> {
    const { data } = await getApiClient().get('/api/preprocess/operations');
    return data;
  },

  async submit(opId: string, assetPath: string, params?: Record<string, unknown>): Promise<PreprocessTask> {
    const { data } = await getApiClient().post('/api/preprocess/submit', {
      op_id: opId,
      asset_path: assetPath,
      params: params ?? {},
    });
    return data;
  },

  async batchSubmit(ops: Array<{ op_id: string; asset_path: string; params?: Record<string, unknown> }>): Promise<PreprocessTask[]> {
    const { data } = await getApiClient().post('/api/preprocess/batch-submit', { ops });
    return data;
  },

  async getTask(taskId: string): Promise<PreprocessTask> {
    const { data } = await getApiClient().get(`/api/preprocess/task/${taskId}`);
    return data;
  },

  async listResults(): Promise<PreprocessTask[]> {
    const { data } = await getApiClient().get('/api/preprocess/results');
    return data;
  },

  async removeTask(taskId: string): Promise<void> {
    await getApiClient().delete(`/api/preprocess/task/${taskId}`);
  },
};
