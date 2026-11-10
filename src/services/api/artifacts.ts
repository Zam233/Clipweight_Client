/**
 * 通用产物 API（M6）—— 对齐后端 `clipwright/api/artifacts.py`。
 *
 * 所有视频类型/插件共用：按 project/task 列出产物，按 MIME 由调用方决定
 * 预览方式（video/image/text/download）；不暴露本地绝对路径。
 */
import { getApiClient } from './client';
import { apiBase } from './sse';

export interface ArtifactItem {
  artifact_id: string;
  plugin_id: string;
  task_id?: string;
  project_id?: string;
  job_id?: string;
  path: string;
  mime: string;
  size: number;
  sha256?: string;
  role: string;
  status: string;
  retention?: string;
  created_at?: number;
  failure_reason?: string;
  _cursor?: string;
}

export interface ArtifactListResult {
  items: ArtifactItem[];
  next_cursor: string;
  total_estimate: number | null;
}

export const artifactsApi = {
  async list(
    projectId: string,
    opts: { taskId?: string; pluginId?: string; status?: string; cursor?: string; limit?: number } = {},
  ): Promise<ArtifactListResult> {
    const { data } = await getApiClient().get('/api/artifacts', {
      params: {
        project_id: projectId,
        task_id: opts.taskId || undefined,
        plugin_id: opts.pluginId || undefined,
        status: opts.status || undefined,
        cursor: opts.cursor || undefined,
        limit: opts.limit ?? 50,
      },
    });
    return data;
  },

  /** 原始文件 URL（交给 <video>/<img>/<a> 使用；带鉴权时仍走同一 origin）。 */
  rawUrl(pluginId: string, artifactId: string, projectId: string): string {
    const query = new URLSearchParams({ project_id: projectId }).toString();
    return `${apiBase()}/api/artifacts/${encodeURIComponent(pluginId)}/${encodeURIComponent(artifactId)}/raw?${query}`;
  },
};
