/**
 * 任务 API 客户端（路线 C / C4）——对齐后端 `clipwright/api/task.py`。
 *
 * 纪律与 `supervisorApi` 一致：直接返回 `data`，统一走 `getApiClient()`，
 * 不新建 axios 实例（鉴权/续期拦截器必须复用）。
 */

import { getApiClient } from './client';
import { apiBase } from './sse';
import type {
  CreateTaskBody,
  Task,
  TaskEvent,
  TaskListItem,
} from '@/types/task';

export const taskApi = {
  /** 创建任务。`plan_only` 默认 true：只出计划，等用户按"开始"。 */
  async create(body: CreateTaskBody): Promise<{
    task: Task;
    planned: boolean;
    started: boolean;
  }> {
    const { data } = await getApiClient().post('/api/task', {
      plan_only: true,
      ...body,
    });
    return data;
  },

  async get(taskId: string): Promise<{ task: Task; events: number }> {
    const { data } = await getApiClient().get(`/api/task/${taskId}`);
    return data;
  },

  async events(taskId: string, sinceSeq = 0): Promise<{
    task_id: string;
    since_seq: number;
    count: number;
    items: TaskEvent[];
  }> {
    const { data } = await getApiClient().get(`/api/task/${taskId}/events`, {
      params: sinceSeq ? { since_seq: sinceSeq } : undefined,
    });
    return data;
  },

  /** SSE 订阅地址（token 由 `connectSseStream` 附加）。 */
  eventsStreamUrl(taskId: string): string {
    return `${apiBase()}/api/task/${taskId}/events/stream`;
  },

  async pause(taskId: string): Promise<{ status: string }> {
    const { data } = await getApiClient().post(`/api/task/${taskId}/pause`);
    return data;
  },

  /**
   * 继续任务（PRD B11 / G8）。
   *
   * 后端对**终态任务**返回 409 + `{reason:"task_terminal", status, message}`；
   * 这里把它转成结构化结果而不是抛裸错误，让调用方能禁用按钮并原样展示原因。
   * 其它错误（404/500/网络）继续抛出。
   */
  async resume(taskId: string): Promise<{
    status: string;
    resumed?: boolean;
    refused?: boolean;
    reason?: string;
    message?: string;
    terminalStatus?: string;
  }> {
    try {
      const { data } = await getApiClient().post(`/api/task/${taskId}/resume`);
      return data;
    } catch (e) {
      const resp = (e as { response?: { status?: number; data?: { detail?: unknown } } })?.response;
      const detail = resp?.data?.detail;
      if (resp?.status === 409 && detail && typeof detail === 'object') {
        const d = detail as { reason?: string; status?: string; message?: string };
        return {
          status: 'refused',
          resumed: false,
          refused: true,
          reason: d.reason ?? 'task_terminal',
          message: d.message ?? '任务已结束，无法继续',
          terminalStatus: d.status,
        };
      }
      throw e;
    }
  },

  async cancel(taskId: string): Promise<{ status: string }> {
    const { data } = await getApiClient().post(`/api/task/${taskId}/cancel`);
    return data;
  },

  async inject(taskId: string, text: string): Promise<{ injected: boolean }> {
    const { data } = await getApiClient().post(`/api/task/${taskId}/inject`, { text });
    return data;
  },

  async replan(taskId: string): Promise<{ task: Task }> {
    const { data } = await getApiClient().post(`/api/task/${taskId}/plan`);
    return data;
  },

  async list(limit = 20): Promise<{ count: number; items: TaskListItem[] }> {
    const { data } = await getApiClient().get('/api/task', { params: { limit } });
    return data;
  },

  /** 任务产物快照：有没有可编辑的 timeline、几条轨道、时长。 */
  async result(taskId: string): Promise<{
    task_id: string;
    has_timeline: boolean;
    tracks: number;
    clips: number;
    duration_sec: number;
    output_path: string;
  }> {
    const { data } = await getApiClient().get(`/api/task/${taskId}/result`);
    return data;
  },

  /** 把任务产物落成一个项目（编辑器继续剪的入口）。 */
  async toProject(taskId: string, name = ''): Promise<{
    task_id: string;
    project_id: string;
    name: string;
  }> {
    const { data } = await getApiClient().post(`/api/task/${taskId}/to-project`, { name });
    return data;
  },
};
