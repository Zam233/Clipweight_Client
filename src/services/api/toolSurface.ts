/**
 * Agent 工具面（只读目录）类型与客户端 —— PRD B3（2026-10-29 / G5、G12）。
 *
 * 为什么单独一个 client：`/api/tools*` 是**Kernel 工具面**（主 agent 真正能调什么），
 * 和旧 `/api/tool/list`（原子工具清单 + 执行器）不是一回事。前者只读，绝不做执行入口。
 */
import { getApiClient } from './client';

/** `/api/tools` 的目录项（后端 `SurfaceEntry.to_public()`，schema 另开 /schema） */
export interface ToolSurfaceEntry {
  name: string;
  tier: string;
  description: string;
  available: boolean;
  idempotent: boolean;
  dry_run: boolean;
  cost_hint: string;
}

export interface ToolSurfaceStats {
  coverage?: number;
  [key: string]: unknown;
}

export interface ToolSurfaceCatalog {
  count: number;
  tiers: string[];
  stats: ToolSurfaceStats;
  items: ToolSurfaceEntry[];
}

export interface ToolSurfaceSchemaItem {
  type?: string;
  function?: { name?: string; description?: string; parameters?: Record<string, unknown> };
}

/** 调用审计记录（后端 records() 的 to_public） */
export interface ToolCallRecord {
  name?: string;
  tool?: string;
  status?: string;
  pipeline_id?: string;
  duration_ms?: number;
  cost_usd?: number | null;
  ts?: number | string;
  [key: string]: unknown;
}

export const toolSurfaceApi = {
  /** 工具面目录（可只取某档位 / 只看可用） */
  async listCatalog(opts: { tier?: string; availableOnly?: boolean } = {}): Promise<ToolSurfaceCatalog> {
    const params: Record<string, unknown> = {};
    if (opts.tier) params.tier = opts.tier;
    if (opts.availableOnly) params.available_only = true;
    const { data } = await getApiClient().get('/api/tools', { params });
    return {
      count: Number((data as ToolSurfaceCatalog)?.count ?? 0),
      tiers: Array.isArray((data as ToolSurfaceCatalog)?.tiers) ? (data as ToolSurfaceCatalog).tiers : [],
      stats: ((data as ToolSurfaceCatalog)?.stats ?? {}) as ToolSurfaceStats,
      items: Array.isArray((data as ToolSurfaceCatalog)?.items) ? (data as ToolSurfaceCatalog).items : [],
    };
  },

  /** 模型实际看到的 tool schema（openai 格式），用于核对 */
  async getSchema(): Promise<{ count: number; tools: ToolSurfaceSchemaItem[] }> {
    const { data } = await getApiClient().get('/api/tools/schema');
    const payload = (data ?? {}) as { count?: number; tools?: ToolSurfaceSchemaItem[] };
    return { count: Number(payload.count ?? 0), tools: Array.isArray(payload.tools) ? payload.tools : [] };
  },

  /** 最近调用记录（可按 pipeline_id 过滤） */
  async listRecords(pipelineId = ''): Promise<{ count: number; items: ToolCallRecord[] }> {
    const { data } = await getApiClient().get('/api/tools/records', {
      params: pipelineId ? { pipeline_id: pipelineId } : undefined,
    });
    const payload = (data ?? {}) as { count?: number; items?: ToolCallRecord[] };
    return { count: Number(payload.count ?? 0), items: Array.isArray(payload.items) ? payload.items : [] };
  },
};
