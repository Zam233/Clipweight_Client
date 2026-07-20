import { getApiClient } from './client';
import type { Persona } from '@/types/persona';

export const personaApi = {
  /** List all personas */
  async list() {
    const { data } = await getApiClient().get('/api/persona/list');
    return data as Persona[];
  },

  /** Get a single persona */
  async get(personaId: string) {
    const { data } = await getApiClient().get(`/api/persona/get/${personaId}`);
    return data as Persona;
  },

  /** Create a new persona */
  async create(persona: Partial<Persona>) {
    const { data } = await getApiClient().post('/api/persona/create', persona);
    return data;
  },

  /** Update a persona */
  async update(personaId: string, updates: Partial<Persona>) {
    const { data } = await getApiClient().put(`/api/persona/update/${personaId}`, updates);
    return data;
  },

  /** Delete a persona */
  async remove(personaId: string) {
    const { data } = await getApiClient().delete(`/api/persona/delete/${personaId}`);
    return data;
  },

  /** Analyze videos to auto-generate persona */
  async analyze(videoDir: string) {
    const { data } = await getApiClient().post('/api/persona/analyze', { video_dir: videoDir });
    return data;
  },

  // ── Chat Forge ──

  /** Start a chat forge session */
  async chatForgeStart(description?: string) {
    const { data } = await getApiClient().post('/api/persona/forge/chat/start', {
      description,
    });
    return data as { session_id: string };
  },

  /** Send a chat forge message */
  async chatForgeMessage(sessionId: string, message: string) {
    const { data } = await getApiClient().post('/api/persona/forge/chat/message', {
      session_id: sessionId,
      message,
    });
    return data;
  },

  /** Upload knowledge file for chat forge */
  async chatForgeKnowledge(sessionId: string, file: File) {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await getApiClient().post(
      `/api/persona/forge/chat/knowledge?session_id=${sessionId}`,
      formData,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return data;
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
