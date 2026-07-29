import { getApiClient } from './client';

export interface ShotParams {
  min_shot_sec: number;
  max_shot_sec: number;
  transition_type: string;
  transition_duration_sec: number;
  cut_on_beat: boolean;
}

export interface TypeDefinition {
  id: string;
  name: string;
  description: string;
  shot_params: ShotParams;
  persona_mappings?: Record<string, unknown>[];
  is_builtin: boolean;
  created_at?: string;
  updated_at?: string;
}

export const typeMakerApi = {
  async list(): Promise<TypeDefinition[]> {
    const { data } = await getApiClient().get('/api/type-maker/list');
    return data;
  },

  async get(id: string): Promise<TypeDefinition> {
    const { data } = await getApiClient().get(`/api/type-maker/${id}`);
    return data;
  },

  async create(definition: Partial<TypeDefinition> & { name: string }): Promise<TypeDefinition> {
    const { data } = await getApiClient().post('/api/type-maker/create', definition);
    return data;
  },

  async update(id: string, definition: Partial<TypeDefinition>): Promise<TypeDefinition> {
    const { data } = await getApiClient().put(`/api/type-maker/${id}`, definition);
    return data;
  },

  async remove(id: string): Promise<void> {
    await getApiClient().delete(`/api/type-maker/${id}`);
  },

  async preview(id: string, params?: Record<string, unknown>): Promise<Record<string, unknown>> {
    const { data } = await getApiClient().post(`/api/type-maker/preview`, { id, ...params });
    return data;
  },
};
