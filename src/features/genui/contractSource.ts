/**
 * `display_spec` 契约获取（B4-T4.1）：**运行期唯一真相**是插件注册表，
 * 前端不再持有自己的组件/上限规则。
 *
 * - 数据源：`GET /api/plugin/contributions?kind=display_spec`（既有统一出口，已透传 meta）；
 * - 缓存：模块级 30s TTL（与 `usePluginSlots` 同节奏）；
 * - 失效：复用 `onPluginSlotsInvalidated` 广播——插件启停后已挂载组件立刻重取；
 * - 失败：静默返回空 Map（插件面不阻塞宿主，沿用 `usePluginSlots.ts` 语义）。
 *
 * 为什么契约不"构建期同步"：插件可运行时启停，构建期快照必然与运行态不一致，
 * 用户在插件页关掉 genui 后前端仍按旧快照渲染——那正是要消灭的"第二真相"。
 */
import { useEffect, useState } from 'react';
import { getApiClient } from '@/services/api';
import { onPluginSlotsInvalidated } from '@/features/plugins/usePluginSlots';

/** 一条 `display_spec` 贡献的契约（来自插件 `meta`，形状由后端 dispatch 校验）。 */
export interface DisplaySpecContract {
  specId: string;
  version: number;
  source: string;
  components: string[];
  containers: string[];
  actions: string[];
  tones: string[];
  badgeTones: string[];
  textSizes: string[];
  limits: Record<string, number>;
  order: number;
  trust: 'sanitize' | 'recipe_only';
}

export type ContractMap = Map<string, DisplaySpecContract>;

const TTL_MS = 30_000;
let cache: { at: number; map: ContractMap } | null = null;
let inflight: Promise<ContractMap> | null = null;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((x): x is string => typeof x === 'string' && !!x) : [];
}

function asLimits(value: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!value || typeof value !== 'object') return out;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const n = Number(raw);
    if (Number.isFinite(n) && n > 0) out[key] = Math.floor(n);
  }
  return out;
}

/** 从 `/api/plugin/contributions` 的条目里解析契约；形状不完整的条目直接跳过（不猜）。 */
export function contractFromContribution(item: unknown): DisplaySpecContract | null {
  const entry = item as { kind?: unknown; id?: unknown; meta?: unknown } | null;
  if (!entry || entry.kind !== 'display_spec') return null;
  const meta = (entry.meta ?? {}) as Record<string, unknown>;
  const specId = typeof meta.spec_id === 'string' ? meta.spec_id : '';
  if (!specId || specId !== entry.id) return null;
  const components = asStringArray(meta.components);
  if (components.length === 0) return null;
  const trust = meta.trust === 'recipe_only' ? 'recipe_only' : 'sanitize';
  const version = Number(meta.version);
  return {
    specId,
    version: Number.isFinite(version) ? version : 1,
    source: typeof meta.source === 'string' ? meta.source : '',
    components,
    containers: asStringArray(meta.containers),
    actions: asStringArray(meta.actions),
    tones: asStringArray(meta.tones),
    badgeTones: asStringArray(meta.badge_tones),
    textSizes: asStringArray(meta.text_sizes),
    limits: asLimits(meta.limits),
    order: Number(meta.order) || 0,
    trust,
  };
}

export function contractsFromResponse(raw: unknown): ContractMap {
  const payload = raw as { contributions?: unknown } | null;
  const list = Array.isArray(payload?.contributions) ? payload.contributions : [];
  const map: ContractMap = new Map();
  for (const item of list) {
    const contract = contractFromContribution(item);
    if (contract) map.set(contract.specId, contract);
  }
  return map;
}

/** 插件启停后调用（亦由 `onPluginSlotsInvalidated` 自动触发）。 */
export function invalidateDisplaySpecContracts(): void {
  cache = null;
  inflight = null;
}

onPluginSlotsInvalidated(invalidateDisplaySpecContracts);

/** 拉取契约（30s 缓存 + 在途去重）；失败返回空 Map，不抛。 */
export async function fetchDisplaySpecContracts(): Promise<ContractMap> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.map;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const raw = await getApiClient().get('/api/plugin/contributions?kind=display_spec');
      const map = contractsFromResponse(raw);
      cache = { at: Date.now(), map };
      return map;
    } catch {
      return new Map<string, DisplaySpecContract>();
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

/** 组件用：拿到当前可用契约；插件被禁用时返回空 Map。 */
export function useDisplaySpecContracts(): ContractMap {
  const [map, setMap] = useState<ContractMap>(() => cache?.map ?? new Map());
  useEffect(() => {
    let alive = true;
    const load = () => {
      void fetchDisplaySpecContracts().then((next) => {
        if (alive) setMap(next);
      });
    };
    load();
    const off = onPluginSlotsInvalidated(load);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return map;
}

/** 一个待渲染的 spec：`specId` 决定用哪份契约，`raw` 是未校验的原始数据。 */
export interface ResolvedSpec {
  specId: string;
  raw: unknown;
}

/**
 * 从业务对象里解析出待渲染的 spec 列表。
 *
 * 优先新形状 `display_specs`（键即 specId）；否则回退老键 `genui`
 * （2026-11-03~07 落库数据），把它当作 `surface` 面对应的那一份。
 */
export function resolveDisplaySpecs(obj: unknown, surface: 'brief' | 'plan'): ResolvedSpec[] {
  if (!obj || typeof obj !== 'object') return [];
  const record = obj as Record<string, unknown>;
  const container = record.display_specs;
  if (container && typeof container === 'object' && !Array.isArray(container)) {
    const out: ResolvedSpec[] = [];
    for (const [specId, raw] of Object.entries(container as Record<string, unknown>)) {
      if (raw && typeof raw === 'object') out.push({ specId, raw });
    }
    if (out.length > 0) return out;
  }
  const legacy = record.genui;
  if (legacy && typeof legacy === 'object' && Object.keys(legacy as object).length > 0) {
    return [{ specId: surface, raw: legacy }];
  }
  return [];
}
