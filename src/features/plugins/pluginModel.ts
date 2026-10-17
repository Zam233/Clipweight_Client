import type { PluginHealthItem } from '@/services/api/project';

/** 插件列表项（UI 形态）——由 `/api/plugin/list` + `/api/plugin/discover` + `/api/plugin/health` 合并。 */
export interface PluginItem {
  id: string;
  name: string;
  description?: string;
  version?: string;
  kind?: string;
  loaded: boolean;
  has_ui?: boolean;
  agents?: string[];
  /** B2：已注册贡献（kind/id） */
  contributions?: Array<{ kind: string; id: string }>;
  /** B2：manifest 声明了但运行时没注册（如缺 API Key） */
  declaredOnly?: string[];
  /** P10：健康聚合里属于该插件的条目（后端不可达时为 undefined） */
  health?: PluginHealthItem;
}

/**
 * 把 `/api/plugin/list` 的响应规整为 PluginItem。
 *
 * 兼容两种形态：新格式 `{manifest:{...}, enabled}` 与旧格式直接把 manifest 摊平。
 * 抽到独立文件是因为首页与插件管理页都要用——两份 normalize 必然漂移。
 */
export function normalizePluginList(data: unknown): PluginItem[] {
  if (!Array.isArray(data)) return [];
  return data.map((d) => {
    const o = d as Record<string, unknown>;
    const m = (o.manifest ?? o) as Record<string, unknown>;
    return {
      id: String(m.id ?? o.id ?? ''),
      name: String(m.name ?? o.name ?? m.id ?? ''),
      description: m.description ? String(m.description) : undefined,
      version: m.version ? String(m.version) : undefined,
      kind: m.kind ? String(m.kind) : undefined,
      loaded: Boolean(o.enabled ?? o.loaded ?? true),
      agents: Array.isArray(o.agents) ? o.agents.map(String) : undefined,
      // B2：已注册贡献与「声明未注册」——让「已加载但零能力」可见
      contributions: Array.isArray(o.contributions)
        ? (o.contributions as Array<Record<string, unknown>>).map((c) => ({
          kind: String(c.kind ?? ''),
          id: String(c.id ?? ''),
        }))
        : undefined,
      declaredOnly: Array.isArray(o.declared_only)
        ? (o.declared_only as unknown[]).map(String)
        : undefined,
    };
  }).filter((p) => p.id);
}

/** 把健康聚合的结果挂到对应插件上（按 plugin_id 对齐，找不到就留空）。 */
export function attachPluginHealth(
  plugins: PluginItem[],
  health: PluginHealthItem[] | undefined,
): PluginItem[] {
  if (!health || health.length === 0) return plugins;
  const byId = new Map(health.map((h) => [h.plugin_id, h]));
  return plugins.map((p) => ({ ...p, health: byId.get(p.id) }));
}
