import { getApiClient } from './client';
import type { RenderRequest, RenderProgress } from '@/types/api';

/** Export preset shape (backend may omit optional fields). */
export interface ExportPreset {
  name: string;
  width: number;
  height: number;
  fps: number;
  bitrate: string;
  icon: string;
}

export const renderApi = {
  /** Start a render job */
  async start(request: RenderRequest) {
    const { data } = await getApiClient().post('/api/render/start', request);
    return data;
  },

  /** Submit to render queue */
  async submitQueue(request: RenderRequest) {
    const { data } = await getApiClient().post('/api/render/queue', request);
    return data as { task_id: string };
  },

  /** Get queue task status */
  async getQueueStatus(taskId: string) {
    const { data } = await getApiClient().get<RenderProgress>(`/api/render/queue/${taskId}`);
    return data;
  },

  /** List all queue tasks (for restoring in-flight renders after page reload) */
  async listQueue() {
    const { data } = await getApiClient().get<{ tasks: RenderProgress[] }>('/api/render/queue');
    return data.tasks ?? [];
  },

  /** Get SSE stream URL for render progress */
  getQueueStreamUrl(taskId: string): string {
    const base = getApiClient().defaults.baseURL || 'http://localhost:8000';
    return `${base}/api/render/queue/stream/${taskId}`;
  },

  /** Get render status */
  async getStatus(renderId: string) {
    const { data } = await getApiClient().get(`/api/render/status/${renderId}`);
    return data;
  },

  /** Download rendered file */
  getDownloadUrl(filename: string): string {
    const base = getApiClient().defaults.baseURL || 'http://localhost:8000';
    return `${base}/api/render/download/${filename}`;
  },

  /** Get video thumbnail */
  getThumbnailUrl(path: string, timeSec = 0.5): string {
    const base = getApiClient().defaults.baseURL || 'http://localhost:8000';
    return `${base}/api/render/thumbnail?path=${encodeURIComponent(path)}&time_sec=${timeSec}`;
  },

  /** Get video proxy URL for preview */
  getVideoUrl(path: string): string {
    const base = getApiClient().defaults.baseURL || 'http://localhost:8000';
    return `${base}/api/render/video?path=${encodeURIComponent(path)}`;
  },

  /** List export presets */
  async getPresets() {
    const { data } = await getApiClient().get<{ presets: Record<string, Partial<ExportPreset>> }>('/api/render/presets');
    return data?.presets ?? {};
  },
};
