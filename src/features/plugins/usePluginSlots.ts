/**
 * D-2：插件插槽数据钩子 —— 拉取 /api/plugin/contributions，30s 缓存，
 * 插件启停后失效（与 PluginsPage 开关联动）。
 */
import { useEffect, useState } from 'react';
import { getApiClient } from '@/services/api';
import {
  isSlotName,
  sanitizeIContribution,
  type SlotContribution,
  type SlotName,
} from './slots';

interface CacheEntry {
  at: number;
  items: SlotContribution[];
}

const TTL_MS = 30_000;
/** B13：全量贡献只用这一个缓存键——各 slot 从同一份数据本地过滤，请求数不随 slot 数增长。 */
const ALL_KEY = '__all__';
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<SlotContribution[]>>();

/** B14：失效广播的订阅者（已挂载的 hook 收到后立即重取）。 */
const invalidateListeners = new Set<() => void>();

/** 插件启停后调用：清空缓存并广播——已挂载组件同步刷新，否则要等 TTL 过期。 */
export function invalidatePluginSlots(): void {
  cache.clear();
  inflight.clear();
  for (const fn of Array.from(invalidateListeners)) {
    try {
      fn();
    } catch {
      /* 单个订阅者异常不影响其它订阅者 */
    }
  }
}

/** B14：订阅「贡献失效」事件，返回取消订阅函数。 */
export function onPluginSlotsInvalidated(fn: () => void): () => void {
  invalidateListeners.add(fn);
  return () => invalidateListeners.delete(fn);
}

function parseContributions(raw: unknown): SlotContribution[] {
  const payload = raw as { contributions?: unknown } | null;
  const list = Array.isArray(payload?.contributions) ? payload!.contributions : [];
  const out: SlotContribution[] = [];
  for (const item of list) {
    const c = item as Partial<SlotContribution>;
    if (!c || typeof c.id !== 'string') continue;
    if (c.kind === 'ui_slot') {
      if (typeof c.title !== 'string') continue;
      if (!isSlotName(c.slot)) continue; // slot 名白名单（安全负例：未知 slot 丢弃）
    }
    out.push(sanitizeIContribution({ title: c.title ?? c.id, ...c } as SlotContribution));
  }
  return out;
}

/** B13：一次拉全量贡献（缓存/在途去重都在这里；各 slot 本地过滤）。 */
async function fetchAllContributions(): Promise<SlotContribution[]> {
  const now = Date.now();
  const hit = cache.get(ALL_KEY);
  if (hit && now - hit.at < TTL_MS) return hit.items;
  const pending = inflight.get(ALL_KEY);
  if (pending) return pending;

  const task = (async () => {
    try {
      const { data } = await getApiClient().get('/api/plugin/contributions');
      const items = parseContributions(data);
      cache.set(ALL_KEY, { at: Date.now(), items });
      return items;
    } catch {
      return []; // 插件面不阻塞宿主
    } finally {
      inflight.delete(ALL_KEY);
    }
  })();
  inflight.set(ALL_KEY, task);
  return task;
}

/** 拉取指定 slot 的全部贡献（含缓存/在途去重）。失败静默为空（插件面不阻塞宿主）。 */
export async function fetchSlotContributions(slot: SlotName): Promise<SlotContribution[]> {
  return fetchContributions({ kind: 'ui_slot', slot }, (c) => c.slot === slot, `slot:${slot}`);
}

/**
 * D-3 通用贡献拉取（非 ui_slot 类，如 export_preset）：同样的缓存/在途去重。
 * 过滤条件由调用方给出（避免把无关 kind 混进渲染）。
 *
 * B13：`params` 只用于「本端过滤语义」的记录，实际网络请求合并为一次全量拉取
 * （此前每个 slot 各发一次，首屏请求数随 slot 数线性增长）。
 */
export async function fetchContributions(
  params: Record<string, string>,
  accept: (c: SlotContribution) => boolean,
  cacheKey: string,
): Promise<SlotContribution[]> {
  const now = Date.now();
  const hit = cache.get(cacheKey);
  if (hit && now - hit.at < TTL_MS) return hit.items;
  const pending = inflight.get(cacheKey);
  if (pending) return pending;

  const task = (async () => {
    try {
      void params; // 过滤在本地完成（全量数据来自 fetchAllContributions）
      const all = await fetchAllContributions();
      const items = all
        .filter(accept)
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
      cache.set(cacheKey, { at: Date.now(), items });
      return items;
    } finally {
      inflight.delete(cacheKey);
    }
  })();
  inflight.set(cacheKey, task);
  return task;
}

/** 按 kind 拉取贡献（export_preset 等非 slot 类；slot 字段仅用于形态统一）。 */
export function usePluginContributions(kind: string): SlotContribution[] {
  const key = `kind:${kind}`;
  const [items, setItems] = useState<SlotContribution[]>(() => cache.get(key)?.items ?? []);
  useResyncOnInvalidate(key, setItems);
  useEffect(() => {
    let alive = true;
    void fetchContributions({ kind }, () => true, key).then((list) => {
      if (alive) setItems(list);
    });
    return () => { alive = false; };
  }, [key, kind]);
  return items;
}

/** React 钩子：返回指定 slot 的贡献列表（挂载即拉取，卸载不取消缓存）。 */
export function usePluginSlots(slot: SlotName): SlotContribution[] {
  const [items, setItems] = useState<SlotContribution[]>(() => cache.get(slot)?.items ?? []);
  useResyncOnInvalidate(slot, setItems);
  useEffect(() => {
    let alive = true;
    void fetchSlotContributions(slot).then((list) => {
      if (alive) setItems(list);
    });
    return () => { alive = false; };
  }, [slot]);
  return items;
}

/**
 * B14：已挂载的宿主与 `Slot` 组件在缓存失效后必须同步刷新。
 *
 * 此前 `invalidatePluginSlots()` 只清模块级缓存，已挂载组件仍持有旧 state
 * （要等下次挂载/30s TTL 过期才更新）——宿主与 Slot 短暂不一致。这里让
 * 每个 hook 订阅失效广播，收到后立即重取一次。
 */
function useResyncOnInvalidate(
  cacheKey: string,
  setItems: (items: SlotContribution[]) => void,
): void {
  useEffect(() => {
    let alive = true;
    const off = onPluginSlotsInvalidated(() => {
      const refresh = cacheKey.startsWith('kind:')
        ? fetchContributions({ kind: cacheKey.slice(5) }, () => true, cacheKey)
        : fetchSlotContributions(cacheKey as SlotName);
      void refresh.then((list) => {
        if (alive) setItems(list);
      });
    });
    return () => { alive = false; off(); };
  }, [cacheKey, setItems]);
}
