import { getApiClient } from './client';
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
