import { getApiClient } from './client';
import { apiBase } from './sse';

/**
 * 工作区（PRD docs/workspace-prd-2026-10-24.md）
 *
 * 一个项目 = 一个目录：工程文件、素材、下载、成片、缓存都在里面。
 * `materials/` 是用户唯一写入区（系统下载也落这里），新文件会被自动索引 + 视觉解读。
 */

/**
 * 工作区事件（扫描/索引进度）。
 *
 * 后端形状（`clipwright/services/workspace.py::add_event`）：
 * `{seq, ts, level, message, detail}`；seq 单调递增，用作增量游标。
 */
export interface WorkspaceEvent {
  seq: number;
  /** 秒级时间戳（后端用 time.time()，不是 ISO 字符串） */
  ts: number;
  level: string;
  message: string;
  detail: Record<string, unknown>;
}

export interface WorkspaceEventsBatch {
  project_id: string;
  events: WorkspaceEvent[];
  last_seq: number;
}

export interface WorkspaceCounts {
  total: number;
  video: number;
  image: number;
  audio: number;
  other: number;
  indexed: number;
  pending: number;
}

export interface WorkspaceStatus {
  project_id: string;
  exists: boolean;
  name?: string;
  root: string;
  counts: WorkspaceCounts;
  index: {
    vision?: boolean;
    provider?: string;
    provider_stale?: string;
    spent_today_usd?: number;
    daily_budget_usd?: number;
  };
  scan: { auto?: boolean; interval_sec?: number; last_scan_at?: string; pending?: number };
  dirs?: Record<string, string>;
  health: 'ok' | 'degraded' | 'missing';
}

export interface WorkspaceMaterial {
  sha256: string;
  path: string;
  rel: string;
  kind: 'video' | 'image' | 'audio' | string;
  size: number;
  status: 'indexed' | 'failed' | 'deferred' | string;
  tags?: string[];
  meta?: Record<string, unknown>;
  vision?: {
    status?: string;
    provider?: string;
    /** 来源：llm=真看了画面；clip=本地零样本；classifier=本地分类器；filename=只看文件名 */
    source?: string;
    tags?: string[];
    summary?: string;
    degraded_reason?: string;
    evidence?: Record<string, string>;
  };
  indexed_at?: string;
}

/** 子 agent 报告（reports/*.md 的索引条目） */
export interface WorkspaceReport {
  seq: number;
  stage: string;
  status: string;
  attempt: number;
  headline: string;
  path: string;
  cost_usd?: number | null;
  created_at?: string;
  preview?: string;
  next_for?: string;
}

/** 需求文档（docs/brief.md、docs/plan.md） */
export interface WorkspaceDoc {
  name: string;
  path: string;
  bytes: number;
  updated_at: string;
  content: string;
  truncated: boolean;
}

export interface ScanReport {  scanned: number;
  changed: number;
  new: number;
  deduped: number;
  indexed: number;
  deferred: number;
  failed: number;
  dry_run?: boolean;
  items?: Array<{ rel: string; kind?: string; status: string; tags?: string[]; vision?: string }>;
}

export const workspaceApi = {
  /** 创建或取回（幂等） */
  async create(body: {
    project_id: string;
    name?: string;
    root?: string;
    auto_index?: boolean;
    vision?: boolean;
  }): Promise<WorkspaceStatus> {
    const { data } = await getApiClient().post('/api/workspace', body);
    return data;
  },

  async get(projectId: string): Promise<WorkspaceStatus> {
    const { data } = await getApiClient().get(`/api/workspace/${encodeURIComponent(projectId)}`);
    return data;
  },

  async enable(projectId: string, patch: { auto_index?: boolean; vision?: boolean }): Promise<WorkspaceStatus> {
    const { data } = await getApiClient().post(
      `/api/workspace/${encodeURIComponent(projectId)}/enable`, patch,
    );
    return data;
  },

  async scan(projectId: string, body: { dry_run?: boolean; vision?: boolean } = {}): Promise<ScanReport> {
    const { data } = await getApiClient().post(
      `/api/workspace/${encodeURIComponent(projectId)}/scan`, body,
    );
    return data;
  },

  async materials(projectId: string, kind = ''): Promise<{
    project_id: string; root: string; count: number; items: WorkspaceMaterial[]; pending: number;
  }> {
    const { data } = await getApiClient().get(
      `/api/workspace/${encodeURIComponent(projectId)}/materials`,
      { params: kind ? { kind } : undefined },
    );
    return data;
  },

  /** 上传到 materials/<kind>/（后端落盘后会同步索引一次） */
  async upload(projectId: string, file: File): Promise<{ saved: string; kind: string; scan: ScanReport }> {
    const form = new FormData();
    form.append('file', file);
    const { data } = await getApiClient().post(
      `/api/workspace/${encodeURIComponent(projectId)}/materials`,
      form,
      { headers: { 'Content-Type': 'multipart/form-data' } },
    );
    return data;
  },

  /** 默认只删索引记录；purge=true 才删磁盘文件 */
  async remove(projectId: string, sha256: string, purge = false): Promise<{
    ok: boolean; purged: boolean; removed_file: string;
  }> {
    const { data } = await getApiClient().delete(
      `/api/workspace/${encodeURIComponent(projectId)}/materials/${encodeURIComponent(sha256)}`,
      { params: purge ? { purge: true } : undefined },
    );
    return data;
  },

  /**
   * 工作区事件（JSON，立即返回）——用于首屏回填与断线后补齐。
   *
   * PRD B2：`/events` 是**快照**端点（后端注释：拆两个端点就是为了避免普通 GET 挂死），
   * 持续进度必须订阅 `eventsStreamUrl()` 那条 SSE。
   */
  async events(projectId: string, since = 0): Promise<WorkspaceEventsBatch> {
    const { data } = await getApiClient().get(
      `/api/workspace/${encodeURIComponent(projectId)}/events`,
      { params: { since } },
    );
    const batch = (data ?? {}) as Partial<WorkspaceEventsBatch>;
    return {
      project_id: String(batch.project_id ?? projectId),
      events: Array.isArray(batch.events) ? batch.events : [],
      last_seq: Number(batch.last_seq ?? since) || 0,
    };
  },

  /**
   * 工作区事件流（SSE，`seq` 游标 + `data:` 帧）。
   *
   * 旧实现 `eventsUrl()` 拼的是 JSON 端点、且全仓 0 处调用（死方法），
   * 这里换成真正的 stream URL；`since` 用于断线续传。
   */
  eventsStreamUrl(projectId: string, since = 0): string {
    return `${apiBase()}/api/workspace/${encodeURIComponent(projectId)}/events/stream?since=${since}`;
  },

  /** 子 agent 报告索引（PRD §19.6 docs 标签数据源） */
  async reports(projectId: string, limit = 50): Promise<{
    project_id: string; root: string; count: number; reports: WorkspaceReport[];
  }> {
    const { data } = await getApiClient().get(
      `/api/workspace/${encodeURIComponent(projectId)}/reports`,
      { params: { limit } },
    );
    return data;
  },

  /** 读一份报告正文 */
  async report(projectId: string, seq: number, maxChars = 20000): Promise<{
    seq: number; path: string; truncated: boolean; content: string;
  }> {
    const { data } = await getApiClient().get(
      `/api/workspace/${encodeURIComponent(projectId)}/reports/${seq}`,
      { params: { max_chars: maxChars } },
    );
    return data;
  },

  /** 需求文档（brief.md / plan.md，只读） */
  async docs(projectId: string): Promise<{
    project_id: string; count: number; docs: WorkspaceDoc[];
  }> {
    const { data } = await getApiClient().get(
      `/api/workspace/${encodeURIComponent(projectId)}/docs`,
    );
    return data;
  },

  /** 可选的工作区父目录（04 步下拉） */
  async roots(): Promise<{ roots: Array<{ path: string; writable: boolean; default: boolean }> }> {
    const { data } = await getApiClient().get('/api/workspace/roots');
    return data;
  },
};
