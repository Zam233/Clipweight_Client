import { getApiClient } from './client';
import { apiBase, fetchSseToken, withSseToken } from './sse';
import type { RequirementsInitRequest, RequirementsChatRequest } from '@/types/api';

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
  ): Promise<Record<string, unknown>> {
    const base = apiBase();
    const form = new URLSearchParams();
    form.append('message', message);
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
