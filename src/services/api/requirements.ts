import { getApiClient } from './client';
import { apiBase, fetchSseToken, withSseToken } from './sse';
import type { RequirementsInitRequest, RequirementsChatRequest } from '@/types/api';
import type { TaskEvent, TaskQuestionItem } from '@/types/task';
import type { SessionTimelineItem } from '@/features/sessionTimeline/types';

export const requirementsApi = {
  /** Initialize a requirements session */
  async init(request: RequirementsInitRequest) {
    const { data } = await getApiClient().post('/api/requirements/init', request);
    return data as { session_id: string; status: string };
  },

  /** Send a chat message */
  async chat(request: RequirementsChatRequest, signal?: AbortSignal) {
    // 规划书生成需要结构 Agent + 翻译，耗时可达 2-5 分钟，
    // 覆盖 axios 默认 60s 超时。P1-35: signal 支持取消长请求。
    const { data } = await getApiClient().post('/api/requirements/chat', request, { timeout: 600_000, signal });
    return data;
  },

  /**
   * W1: 流式消费需求对话（SSE）— 边收边回调 chunk（type/status/result），
   * 返回最终 result payload。长耗时对话不再受 axios 超时影响，且能实时显示「思考中」。
   */
  async streamChat(
    sessionId: string,
    message: string,
    onChunk?: (chunk: { type: string; data: unknown }) => void,
    signal?: AbortSignal,
    projectId?: string,
  ): Promise<Record<string, unknown>> {
    const base = apiBase();
    const form = new URLSearchParams();
    form.append('message', message);
    // 带上项目 id：中止后「续跑」要靠它定位原工作区，否则会新建一个工作区,
    // docs/ 与成片都写不到当前项目里。
    if (projectId) form.append('project_id', projectId);
    const token = await fetchSseToken();
    // P1-36：一次性 SSE token 走 query（后端 _consume_sse_token 只消费 qtok）——
    // 旧实现放 Authorization 头在 token/jwt 模式下必 401 且无回退
    const url = withSseToken(`${base}/api/requirements/chat/stream/${sessionId}`, token);
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal, // P1-35
    });
    if (!resp.ok || !resp.body) {
      throw new Error(`chat stream failed: ${resp.status}`);
    }
    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: Record<string, unknown> = {};
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE 以空行分隔事件
      const parts = buffer.split('\n\n');
      buffer = parts.pop() ?? '';
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data:'));
        if (!line) continue;
        const payload = line.slice(5).trim();
        if (payload === '[DONE]') continue;
        try {
          const chunk = JSON.parse(payload) as { type: string; data: unknown };
          onChunk?.(chunk);
          if (chunk.type === 'result') result = (chunk.data as Record<string, unknown>) ?? result;
        } catch { /* 忽略坏块 */ }
      }
    }
    return result;
  },

  /** Edit timeline by selected clips + natural-language instruction (C6/C7; W12 支持区域) */
  async edit(request: {
    session_id: string;
    message: string;
    timeline: unknown;
    selected_clip_ids: string[];
    region_start_sec?: number;
    region_end_sec?: number;
  }, signal?: AbortSignal) {
    // 换素材/重做动画/数值调整可能调用 Agent，耗时可长，对齐 chat 的超时
    const { data } = await getApiClient().post('/api/requirements/edit', request, { timeout: 600_000, signal });
    return data;
  },

  /** Get SSE stream URL for chat（token 由调用方用 withSseToken 附加） */
  getChatStreamUrl(sessionId: string): string {
    return `${apiBase()}/api/requirements/chat/stream/${sessionId}`;
  },

  /**
   * R6：解析一句自然语言剪辑指令 → 意图 + 落位预览（**不修改时间线**）。
   *
   * 返回 `{ intent, resolution: { preview, affected_clip_ids, questions, ... }, problems, blocked }`；
   * 前端"意图确认卡"据此展示"将改动什么"与"需要用户拍板的问题"。
   */
  async intent(sessionId: string, request: {
    message: string;
    timeline: unknown;
    selected_clip_ids?: string[];
    region_start_sec?: number;
    region_end_sec?: number;
    project_id?: string;
  }, signal?: AbortSignal) {
    const { data } = await getApiClient().post(
      `/api/requirements/${sessionId}/intent`, request, { timeout: 180_000, signal });
    return data as {
      session_id: string;
      intent: string;
      blocked: boolean;
      resolution: {
        preview: string[];
        affected_clip_ids: string[];
        questions: { code: string; text: string; options: { value: string; label: string }[]; op_index: number }[];
        problems: string[];
      };
      problems: { level: string; where: string; message: string }[];
    };
  },

  /**
   * R7：把确认过的意图**编译成时间线补丁**并执行（`apply: true`）。
   *
   * 与 `/intent` 的分工：`/intent` 负责"说清要干什么"（只读），本方法负责"干"。
   * 传 `intent_raw`（`/intent` 已解析的那份）+ `answers`（用户在卡上做的选择），
   * 保证**执行的就是用户确认过的那份意图**，而不是重新解析出来的另一份。
   *
   * 返回 `{ patch, report, applied, blocked, timeline? }`：
   * `applied=true` 时 `timeline` 是新的时间线；`blocked=true` 时 `report.problems`
   * 里是"为什么没执行"（硬错误，或仍有未答问题）。
   */
  async intentApply(sessionId: string, request: {
    message: string;
    timeline: unknown;
    selected_clip_ids?: string[];
    region_start_sec?: number;
    region_end_sec?: number;
    project_id?: string;
    apply?: boolean;
    answers?: Record<string, string>;
    intent_raw?: unknown;
  }, signal?: AbortSignal) {
    const { data } = await getApiClient().post(
      `/api/requirements/${sessionId}/intent/apply`, request, { timeout: 180_000, signal });
    return data as {
      session_id: string;
      intent: string;
      applied: boolean;
      blocked: boolean;
      timeline?: unknown;
      report: {
        preview: string[];
        problems: { level: string; where: string; message: string }[];
        clips_before: number;
        clips_after: number;
        duration_before: number;
        duration_after: number;
        affected_clip_ids: string[];
      };
      problems: { level: string; where: string; message: string }[];
    };
  },

  /** Get session state */
  async getSession(sessionId: string) {
    const { data } = await getApiClient().get(`/api/requirements/session/${sessionId}`);
    return data;
  },

  /**
   * M5c：需求会话的问题列表（PRD §15.5）。
   *
   * 需求会话**不走任务 API**：问题归属会话，路由也在 `/api/requirements`。
   * `status=pending` 只要待答（校准用），`all` 给全部（刷新后重建卡片）。
   */
  async questions(sessionId: string, status: 'pending' | 'all' = 'all') {
    const { data } = await getApiClient().get(
      `/api/requirements/${sessionId}/questions`,
      { params: { status } },
    );
    return data as { session_id: string; items: TaskQuestionItem[]; status: string };
  },

  /** 回答需求会话的问题；后端会让 agent 带着答案继续。 */
  async answer(
    sessionId: string,
    body: { question_id: string; option_id?: string | null; text?: string | null },
  ) {
    const { data } = await getApiClient().post(
      `/api/requirements/${sessionId}/answer`,
      body,
      { timeout: 600_000 },
    );
    return data;
  },

  /**
   * M4：需求消息历史分页（unified-stream PRD §M4）。
   * `beforeId` = 上一页最早那条的 id（不含）；返回 `{items, has_more, oldest_id, total}`。
   */
  async messages(sessionId: string, opts: { beforeId?: string; limit?: number } = {}) {
    const { data } = await getApiClient().get(
      `/api/requirements/${sessionId}/messages`,
      { params: { before_id: opts.beforeId || '', limit: opts.limit ?? 50 } },
    );
    return data as {
      items: { id: string; role: string; content: string; timestamp?: string }[];
      has_more: boolean;
      oldest_id: string;
      total: number;
    };
  },

  /** 会话事件（question/answer）：刷新/重连按 seq 补齐。 */
  async sessionEvents(sessionId: string, sinceSeq = 0, limit = 200, beforeSeq = 0) {
    const { data } = await getApiClient().get(
      `/api/requirements/${sessionId}/events`,
      { params: { since_seq: sinceSeq, limit, ...(beforeSeq ? { before_seq: beforeSeq } : {}) } },
    );
    return data as {
      session_id: string;
      items: TaskEvent[];
      has_more: boolean;
      latest_seq: number;
    };
  },

  /**
   * 会话时间线（唯一有序流，session-timeline PRD §5.1）。
   *
   * 返回的条目**已按 seq 升序**，前端不做任何本地排序——顺序由服务端分配。
   */
  async timeline(
    sessionId: string,
    opts: { sinceSeq?: number; untilSeq?: number; beforeSeq?: number; limit?: number } = {},
  ) {
    const { data } = await getApiClient().get(
      `/api/requirements/${sessionId}/timeline`,
      {
        params: {
          since_seq: opts.sinceSeq ?? 0,
          ...(opts.untilSeq ? { until_seq: opts.untilSeq } : {}),
          ...(opts.beforeSeq ? { before_seq: opts.beforeSeq } : {}),
          limit: opts.limit ?? 200,
        },
      },
    );
    return data as {
      session_id: string;
      items: SessionTimelineItem[];
      has_more: boolean;
      latest_seq: number;
      archived_until_seq: number;
      /** 服务端在本次请求里回填了几条（存量会话迁移；0 = 没回填） */
      backfilled?: number;
      /** 绑定到本会话的任务（按绑定顺序）；「轨迹」固定标签靠它接上当前任务 */
      task_ids?: string[];
      counters?: Record<string, number>;
    };
  },

  /** 时间线实时流 URL（EventSource 直连；token 由 connectSseStream 拼）。 */
  timelineStreamUrl(sessionId: string, sinceSeq = -1): string {
    const base = `${apiBase()}/api/requirements/${sessionId}/timeline/stream`;
    return sinceSeq >= 0 ? `${base}?since_seq=${sinceSeq}` : base;
  },

  /**
   * 派发「生成制作规划书」（plan-dispatch PRD D1）。
   *
   * 幂等键在服务端是 `session_id:brief_hash`：同一版简报且任务还在跑就返回既有
   * `task_id`（`reused=true`），不会点两次建两个任务。`retry=true` 强制重建。
   */
  async dispatchPlan(sessionId: string, retry = false) {
    const { data } = await getApiClient().post(
      `/api/requirements/${sessionId}/plan/dispatch`,
      { retry },
    );
    return data as { task_id: string; run_id?: string; status: string; reused: boolean };
  },

  /** Get production plan */
  async getPlan(sessionId: string) {
    const { data } = await getApiClient().get(`/api/requirements/plan/${sessionId}`);
    return data;
  },

  /** Upload reference file */
  async upload(sessionId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await getApiClient().post(
      `/api/requirements/upload/${sessionId}`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return data;
  },

  /** Proceed to pipeline（批B：projectId 可选——成品时间线自动保存回项目） */
  async proceed(sessionId: string, personaId: string, pluginId: string, extraParams?: Record<string, unknown>, projectId?: string, signal?: AbortSignal) {
    const { data } = await getApiClient().post('/api/requirements/proceed', {
      session_id: sessionId,
      persona_id: personaId,
      category_plugin_id: pluginId,
      project_id: projectId || '',
      extra_params: extraParams,
    }, { timeout: 300_000, signal });
    return data;
  },
};
