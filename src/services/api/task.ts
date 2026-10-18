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

  async resume(taskId: string): Promise<{ status: string }> {
    const { data } = await getApiClient().post(`/api/task/${taskId}/resume`);
    return data;
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
};
