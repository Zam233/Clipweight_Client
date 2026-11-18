import { getApiClient } from './client';
import { useSettingsStore } from '@/stores/settingsStore';
import type { TypeDefinition } from './typeMaker';

export interface TypeForgeSession {
  session_id: string;
  title: string;
  message_count: number;
  updated_at: string;
  draft_name: string;
}

export interface TypeForgeDetail {
  session_id: string;
  title: string;
  revision: number;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  draft: Partial<TypeDefinition>;
  created_at: string;
  updated_at: string;
}

export const typeForgeApi = {
  async start(): Promise<{ session_id: string; draft: Partial<TypeDefinition> }> {
    const { data } = await getApiClient().post('/api/type-forge/chat/start', {});
    return data;
  },
  async sessions(): Promise<{ sessions: TypeForgeSession[]; total: number }> {
    const { data } = await getApiClient().get('/api/type-forge/chat/sessions');
    return data;
  },
  async detail(sessionId: string): Promise<TypeForgeDetail> {
    const { data } = await getApiClient().get(`/api/type-forge/chat/sessions/${sessionId}`);
    return data;
  },
  async message(sessionId: string, message: string, attachments: Array<Record<string, unknown>> = []) {
    const { data } = await getApiClient().post('/api/type-forge/chat/message', {
      session_id: sessionId, message, attachments,
    });
    return data as { reply: string; draft: Partial<TypeDefinition>; missing_fields: string[]; progress: Record<string, number> };
  },
  async messageStream(
    sessionId: string, message: string, attachments: Array<Record<string, unknown>> = [],
    onDelta?: (delta: string) => void,
  ): Promise<{ reply: string; draft: Partial<TypeDefinition>; missing_fields: string[]; progress: Record<string, number> }> {
    const base = useSettingsStore.getState().apiBaseUrl || '';
    const token = useSettingsStore.getState().authToken;
    const res = await fetch(`${base}/api/type-forge/chat/message/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({ session_id: sessionId, message, attachments }),
    });
    if (!res.ok || !res.body) throw new Error(`stream HTTP ${res.status}`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let final: { reply: string; draft: Partial<TypeDefinition>; missing_fields: string[]; progress: Record<string, number> } | null = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const line = chunk.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        const event = JSON.parse(line.slice(6));
        if (event.type === 'delta') onDelta?.(String(event.content ?? ''));
        if (event.type === 'done') final = event;
        if (event.type === 'error') throw new Error(String(event.message ?? 'stream error'));
      }
    }
    if (!final) throw new Error('stream ended without done');
    return final;
  },

  async commit(sessionId: string, typeId: string, definition: Partial<TypeDefinition>) {
    const { data } = await getApiClient().post('/api/type-forge/chat/commit', {
      session_id: sessionId, type_id: typeId, definition,
    });
    return data;
  },
  async remove(sessionId: string) {
    const { data } = await getApiClient().delete(`/api/type-forge/chat/sessions/${sessionId}`);
    return data;
  },
};
