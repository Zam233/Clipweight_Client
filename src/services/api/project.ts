import { getApiClient } from './client';
import type { Project, ProjectSaveRequest, HealthResponse, PluginInfo, AnimationDef } from '@/types/api';

export const projectApi = {
  async save(request: ProjectSaveRequest) {
    const { data } = await getApiClient().post('/api/project/save', request);
    return data;
  },

  async load(projectId: string) {
    const { data } = await getApiClient().get<Project>(`/api/project/load/${projectId}`);
    return data;
  },

  async list() {
    const { data } = await getApiClient().get<Project[]>('/api/project/list');
    return data;
  },

  async remove(projectId: string) {
    const { data } = await getApiClient().delete(`/api/project/delete/${projectId}`);
    return data;
  },
};

export const healthApi = {
  async check() {
    const { data } = await getApiClient().get<HealthResponse>('/health');
    return data;
  },
};

export const pluginApi = {
  async discover() {
    const { data } = await getApiClient().get<string[]>('/api/plugin/discover');
    return data;
  },

  async list() {
    const { data } = await getApiClient().get('/api/plugin/list');
    return data as { manifest: { id: string; name: string; description?: string; version?: string; kind?: string }; enabled: boolean }[];
  },

  async loadAll() {
    const { data } = await getApiClient().post<string[]>('/api/plugin/load-all');
    return data;
  },

  async load(pluginId: string) {
    const { data } = await getApiClient().post(`/api/plugin/load/${pluginId}`);
    return data;
  },

  async unload(pluginId: string) {
    const { data } = await getApiClient().post(`/api/plugin/unload/${pluginId}`);
    return data;
  },

  async capabilities() {
    const { data } = await getApiClient().get('/api/plugin/capabilities');
    return data;
  },

  async getConfig(pluginId: string) {
    const { data } = await getApiClient().get(`/api/plugin/${pluginId}/config`);
    return data as { fields: Record<string, { type: string; value: unknown; label: string; description?: string }> };
  },

  async saveConfig(pluginId: string, yaml: string) {
    const { data } = await getApiClient().put(`/api/plugin/${pluginId}/config`, yaml, {
      headers: { 'Content-Type': 'text/plain' },
    });
    return data;
  },

  async deleteConfig(pluginId: string) {
    const { data } = await getApiClient().delete(`/api/plugin/${pluginId}/config`);
    return data;
  },
};

export const animationApi = {
  async list() {
    const { data } = await getApiClient().get<AnimationDef[]>('/api/animation/list');
    return data;
  },
};

export const toolApi = {
  async list() {
    const { data } = await getApiClient().get('/api/tool/list');
    return data;
  },

  async execute(toolName: string, params: Record<string, unknown>) {
    const { data } = await getApiClient().post('/api/tool/execute', {
      tool: toolName,
      params,
    });
    return data;
  },
};

export const skillApi = {
  async list() {
    const { data } = await getApiClient().get('/api/skill/list');
    return data;
  },

  async execute(skillName: string, params: Record<string, unknown>) {
    const { data } = await getApiClient().post('/api/skill/execute', {
      skill: skillName,
      params,
    });
    return data;
  },
};
