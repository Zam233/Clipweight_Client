import { getApiClient } from './client';
import type { Persona } from '@/types/persona';

export const personaApi = {
  /** List all persona IDs */
  async listIds() {
    const { data } = await getApiClient().get<string[]>('/api/persona/list');
    return data;
  },

  /** List all personas with full details (batch fetch) */
  async list(): Promise<Persona[]> {
    const ids = await personaApi.listIds();
    if (ids.length === 0) return [];
    const results = await Promise.allSettled(ids.map((id) => personaApi.get(id)));
    return results
      .filter((r): r is PromiseFulfilledResult<Persona> => r.status === 'fulfilled')
      .map((r) => r.value);
  },

  /** Get a single persona */
  async get(personaId: string) {
    const { data } = await getApiClient().get(`/api/persona/${personaId}`);
    return data as Persona;
  },

  /** Create a new persona */
  async create(persona: Partial<Persona>) {
    const { data } = await getApiClient().post('/api/persona/create', persona);
    return data;
  },

  /** Update a persona */
  async update(personaId: string, updates: Partial<Persona>) {
    const { data } = await getApiClient().put(`/api/persona/${personaId}`, updates);
    return data;
  },

  /** Delete a persona */
  async remove(personaId: string) {
    const { data } = await getApiClient().delete(`/api/persona/${personaId}`);
    return data;
  },

  // ── Chat Forge ──

  /** Start a chat forge session */
  async chatForgeStart(description?: string) {
    const { data } = await getApiClient().post('/api/persona/forge/chat/start', {
      description,
    });
    return data as { session_id: string; persona_draft?: unknown; progress?: Record<string, number>; reply?: string };
  },

  /** Send a chat forge message */
  async chatForgeMessage(sessionId: string, message: string) {
    const { data } = await getApiClient().post('/api/persona/forge/chat/message', {
      session_id: sessionId,
      message,
    });
    return data as { reply?: string; persona_draft?: unknown; progress?: Record<string, number>; missing_dimensions?: string[] };
  },

  /** Upload knowledge content for chat forge (sends text content, chunked) */
  async chatForgeKnowledge(sessionId: string, content: string, source?: string) {
    const { data } = await getApiClient().post(
      '/api/persona/forge/chat/knowledge',
      { session_id: sessionId, content, source: source || 'user_upload' },
    );
    return data as { reply?: string; persona_draft?: unknown; progress?: Record<string, number> };
  },

  /** Commit/finalize the persona from chat forge */
  async chatForgeCommit(sessionId: string, personaName: string) {
    const { data } = await getApiClient().post('/api/persona/forge/chat/commit', {
      session_id: sessionId,
      persona_name: personaName,
    });
    return data;
  },

  // ── PersonaForge (from prompt) ──

  /** Generate persona from description */
  async forgeFromPrompt(description: string) {
    const { data } = await getApiClient().post('/api/persona/forge/from-prompt', {
      description,
    });
    return data;
  },
};
