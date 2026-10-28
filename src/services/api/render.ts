import { getApiClient } from './client';
import { apiBase } from './sse';
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

/**
 * Render progress SSE event. Backend B12: `completed`/`failed` events now
 * include `output_path` — the relative rendered file path, e.g.
 * `renders/渲染完成-发布会.mp4`.
 */
export interface RenderProgressEvent extends RenderProgress {
  output_path?: string;
}

/**
 * Build the render download URL path. Prefers the basename (last path segment)
 * of the SSE `output_path` so CJK/unicode filenames survive; falls back to
 * `fallbackFilename` when no `output_path` was received. The chosen filename is
 * URL-encoded for safe insertion into the URL path.
 */
export function buildRenderDownloadUrl(outputPath?: string, fallbackFilename?: string): string {
  const basename = outputPath ? outputPath.split(/[/\\]/).filter(Boolean).pop() : undefined;
  const filename = (basename ?? fallbackFilename ?? '').trim();
  if (!filename) return '';
  return `/api/render/download/${encodeURIComponent(filename)}`;
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

  /** 批C：取消队列渲染任务（后端 terminate ffmpeg 进程并标记 cancelled） */
  async cancel(taskId: string) {
    const { data } = await getApiClient().delete(`/api/render/queue/${taskId}`);
    return data;
  },

  /** List all queue tasks (for restoring in-flight renders after page reload) */
  async listQueue() {
    const { data } = await getApiClient().get<{ tasks: RenderProgress[] }>('/api/render/queue');
    return data.tasks ?? [];
  },

  /** Get SSE stream URL for render progress（token 由调用方用 withSseToken 附加） */
  getQueueStreamUrl(taskId: string): string {
    return `${apiBase()}/api/render/queue/stream/${taskId}`;
  },

  /** Get render status */
  async getStatus(renderId: string) {
    const { data } = await getApiClient().get(`/api/render/status/${renderId}`);
    return data;
  },

  /** P0-10: 带凭据下载成片（/api 端点需 Authorization，改用 axios blob） */
  async downloadFile(filename: string, outputPath?: string): Promise<void> {
    const url = buildRenderDownloadUrl(outputPath, filename);
    if (!url) throw new Error('无法确定下载路径');
    const resp = await getApiClient().get(url, { responseType: 'blob', timeout: 600_000 });
    const blob = resp.data as Blob;
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'render.mp4';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  },

  /** Get video thumbnail */
  getThumbnailUrl(path: string, timeSec = 0.5): string {
    return `${apiBase()}/api/render/thumbnail?path=${encodeURIComponent(path)}&time_sec=${timeSec}`;
  },

  /** Get video proxy URL for preview */
  getVideoUrl(path: string): string {
    return `${apiBase()}/api/render/video?path=${encodeURIComponent(path)}`;
  },

  /** List export presets */
  async getPresets() {
    const { data } = await getApiClient().get<{ presets: Record<string, Partial<ExportPreset>> }>('/api/render/presets');
    return data?.presets ?? {};
  },

  // ── PRD B8（2026-10-29 / G6）：后端早已有、前端一直没有的两条运维能力 ──

  /**
   * 渲染后端清单（内建 + 插件贡献）：`{backends, requested, effective, remote_render_url}`。
   * 排障时能一眼看出"为什么回退到了本机"。
   */
  async getBackends(): Promise<{
    backends: Array<Record<string, unknown>>;
    requested: string;
    effective: string;
    remote_render_url: boolean;
  }> {
    const { data } = await getApiClient().get('/api/render/backends');
    const payload = (data ?? {}) as {
      backends?: unknown[]; requested?: string; effective?: string; remote_render_url?: boolean;
    };
    return {
      backends: Array.isArray(payload.backends) ? payload.backends as Array<Record<string, unknown>> : [],
      requested: String(payload.requested ?? ''),
      effective: String(payload.effective ?? ''),
      remote_render_url: Boolean(payload.remote_render_url),
    };
  },

  /** 清理过期渲染产物（**破坏性**：真删 renders/ 下的文件，调用方必须二次确认） */
  async cleanupArtifacts(days = 30): Promise<{ status: string; removed: number; older_than_days: number }> {
    const { data } = await getApiClient().delete('/api/render/artifacts', { params: { days } });
    const payload = (data ?? {}) as { status?: string; removed?: number; older_than_days?: number };
    return {
      status: String(payload.status ?? ''),
      removed: Number(payload.removed ?? 0),
      older_than_days: Number(payload.older_than_days ?? days),
    };
  },
};
