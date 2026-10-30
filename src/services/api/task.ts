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
  TaskEventPage,
  Task,
  TaskEvent,
  TaskListItem,
  TaskQuestionItem,
  TaskRunDetail,
  TaskRunSummary,
  TaskToolCall,
  TaskToolCalls,
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

  async events(taskId: string, opts: {
    sinceSeq?: number;
    beforeSeq?: number;
    limit?: number;
  } = {}): Promise<TaskEventPage> {
    const params: Record<string, number> = {};
    if (opts.sinceSeq) params.since_seq = opts.sinceSeq;
    if (opts.beforeSeq) params.before_seq = opts.beforeSeq;
    if (opts.limit) params.limit = opts.limit;
    const { data } = await getApiClient().get(`/api/task/${taskId}/events`, {
      params: Object.keys(params).length ? params : undefined,
    });
    return data as TaskEventPage;
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

  /**
   * 回答 ask_user 的问题（PRD §15.5）。
   *
   * 错误语义（前端要按码分流，不能只显示 message）：
   * 404 问题不存在 / 409 已回答或任务已取消 / 410 已超时或服务重启失效 / 400 选项非法。
   */
  async answer(taskId: string, body: {
    questionId: string;
    optionId?: string | null;
    text?: string | null;
  }): Promise<{
    task_id: string;
    question_id: string;
    status: string;
    task_status: string;
    option_id?: string | null;
    source?: string;
  }> {
    const { data } = await getApiClient().post(`/api/task/${taskId}/answer`, {
      question_id: body.questionId,
      option_id: body.optionId ?? null,
      text: body.text ?? null,
    });
    return data;
  },

  /** 待答问题（刷新后恢复问题卡；默认只要 pending）。 */
  async questions(taskId: string, status = 'pending'): Promise<{
    task_id: string;
    status: string;
    count: number;
    items: TaskQuestionItem[];
  }> {
    const { data } = await getApiClient().get(`/api/task/${taskId}/questions`, {
      params: { status },
    });
    return data;
  },

  /** 该任务派过的全部子 agent run（PRD modern-agent-review M2 可寻址子会话）。 */
  async runs(taskId: string): Promise<{ task_id: string; count: number; items: TaskRunSummary[] }> {
    const { data } = await getApiClient().get(`/api/task/${taskId}/runs`);
    return data;
  },

  /** 单个 run 的全量结果（含降级、工具轨迹、失败原因）。 */
  async runDetail(taskId: string, runId: string): Promise<{
    task_id: string;
    run: TaskRunDetail;
  }> {
    const { data } = await getApiClient().get(`/api/task/${taskId}/runs/${runId}`);
    return data;
  },

  /** 给某个 run 所在的阶段子会话留一条补充要求（下次派发时并入 brief）。 */
  async runMessage(taskId: string, runId: string, text: string): Promise<{
    stage: string;
    pending: number;
  }> {
    const { data } = await getApiClient().post(
      `/api/task/${taskId}/runs/${runId}/message`, { text });
    return data;
  },

  /**
   * 重放一个 run：同样阶段与 brief **真重跑**（跳过幂等回放）。
   *
   * 后端会带回本次的 `run`（AgentResult）——`replayed=true` 说明服务端其实回了缓存，
   * 界面必须照实说"未确认真实重跑"，不能宣传成"已重跑"。
   */
  async runReplay(taskId: string, runId: string): Promise<{
    task_id?: string;
    stage: string;
    status: string;
    replayed: boolean;
    run?: TaskRunDetail;
  }> {
    const { data } = await getApiClient().post(`/api/task/${taskId}/runs/${runId}/replay`);
    return data;
  },

  /**
   * 某阶段的**全量**工具轨迹（PRD modern-agent-review M3）。
   *
   * 主 agent 的工具结果里只带 12 条采样 + `tool_calls_path`；用户要"点开看全部"时
   * 走这个接口分页读盘上的 `reports/tool_calls/<stage>-<n>.json`。
   * `stage` 留空 = 取最近一次落盘的那份（任务刚结束、用户还没选阶段时用）。
   */
  async toolCalls(
    taskId: string,
    opts: { stage?: string; attempt?: number; limit?: number; offset?: number } = {},
  ): Promise<TaskToolCalls> {
    const params: Record<string, string | number> = {};
    if (opts.stage) params.stage = opts.stage;
    if (opts.attempt) params.attempt = opts.attempt;
    if (opts.limit) params.limit = opts.limit;
    if (opts.offset) params.offset = opts.offset;
    const { data } = await getApiClient().get(`/api/task/${taskId}/tool-calls`, {
      params: Object.keys(params).length ? params : undefined,
    });
    return data as TaskToolCalls;
  },
};
