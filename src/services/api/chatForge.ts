import { getApiClient } from './client';

export interface ChatForgeSession {
  session_id: string;
  scope?: string;
  context?: Record<string, unknown>;
  reply?: string;
  persona_draft?: unknown;
  progress?: Record<string, number>;
}

export interface ChatForgeReply {
  reply?: string;
  persona_draft?: unknown;
  progress?: Record<string, number>;
  missing_dimensions?: string[];
}

export interface PromptDraftResult {
  prompt: string;
  avoid: string[];
  rationale: string;
  degraded: boolean;
  source_messages: number;
  session_id: string;
}

export interface ChatPromptMessage {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * MV 提示词对话（PRD §II.12 / F-05）。
 *
 * 复用 ChatForge 的会话与消息端点，但把 `scope` 标成 `mv_prompt`，
 * 并把"对话 → 提示词"交给 `/commit-prompt`（后端规则/LLM 双路蒸馏）。
 */
export const chatForgeApi = {
  async startPromptSession(context: Record<string, unknown> = {}): Promise<ChatForgeSession> {
    const { data } = await getApiClient().post<ChatForgeSession>(
      '/api/persona/forge/chat/start',
      { persona_id: '', scope: 'mv_prompt', context },
    );
    return data;
  },

  async message(sessionId: string, message: string): Promise<ChatForgeReply> {
    const { data } = await getApiClient().post<ChatForgeReply>(
      '/api/persona/forge/chat/message',
      { session_id: sessionId, message },
    );
    return data;
  },

  /** 把对话蒸馏成提示词（`degraded=true` 表示走了规则兜底）。 */
  async commitPrompt(
    messages: ChatPromptMessage[],
    options: { sessionId?: string; maxChars?: number } = {},
  ): Promise<PromptDraftResult> {
    const { data } = await getApiClient().post<PromptDraftResult>(
      '/api/persona/forge/chat/commit-prompt',
      {
        messages,
        session_id: options.sessionId ?? '',
        max_chars: options.maxChars ?? 4000,
      },
    );
    return data;
  },
};

export type { ChatForgeSession as ChatForgeSessionType };
