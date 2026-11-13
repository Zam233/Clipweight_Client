/**
 * D-2：插件插槽数据钩子 —— 拉取 /api/plugin/contributions，30s 缓存，
 * 插件启停后失效（与 PluginsPage 开关联动）。
 *
 * C4：请求代际令牌——失效后旧在途请求的响应不得回写缓存/组件。
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

/**
 * C4：请求代际。`fetchAllContributions` 发起时记录当前代，完成时若期间发生过
 * `invalidatePluginSlots()`（代已递增），该响应即过期——不写 cache、不回写组件。
 * 失效同时清 cache/inflight，让新请求立即发出；旧 promise 仍 resolve 给当时的调用方，
 * 但不会污染缓存（对应 PRD「A 旧请求晚于 B 禁用刷新返回，A 不回写」）。
 */
let generation = 0;
export function currentPluginSlotsGeneration(): number {
  return generation;
}

/** 插件启停 / loadAll 后调用：清缓存、递增代际并广播重取（保留 30s TTL 语义）。 */
export function invalidatePluginSlots(): void {
  generation += 1;
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

  const gen = generation; // 发起代
  let self: Promise<SlotContribution[]> | undefined;
  const task: Promise<SlotContribution[]> = (async () => {
    try {
      const { data } = await getApiClient().get('/api/plugin/contributions');
      const items = parseContributions(data);
      // C4：失效后的旧响应不得回写缓存/组件。
      if (gen === generation) cache.set(ALL_KEY, { at: Date.now(), items });
      return items;
    } catch {
      return []; // 插件面不阻塞宿主
    } finally {
      // 只清自己那一代留下的 inflight，避免误删失效后新发起的请求。
      if (gen === generation || inflight.get(ALL_KEY) === self) {
        inflight.delete(ALL_KEY);
      }
    }
  })();
  self = task;
  inflight.set(ALL_KEY, task);
  return task;
}

/** 拉取指定 slot 的全部贡献（含缓存/在途去重）。失败静默为空（插件面不阻塞宿主）。
 *  C4：同时过滤 kind==='ui_slot' 且 slot 匹配，避免把别类贡献混进 Slot。 */
export async function fetchSlotContributions(slot: SlotName): Promise<SlotContribution[]> {
  return fetchContributions(
    { kind: 'ui_slot', slot },
    (c) => c.kind === 'ui_slot' && c.slot === slot,
    `slot:${slot}`,
  );
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

  const gen = generation; // 发起代
  let self: Promise<SlotContribution[]> | undefined;
  const task: Promise<SlotContribution[]> = (async () => {
    try {
      void params; // 过滤在本地完成（全量数据来自 fetchAllContributions）
      const all = await fetchAllContributions();
      const items = all
        .filter(accept)
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
      // C4：失效后的旧响应不得回写缓存/组件。
      if (gen === generation) cache.set(cacheKey, { at: Date.now(), items });
      return items;
    } finally {
      if (gen === generation || inflight.get(cacheKey) === self) {
        inflight.delete(cacheKey);
      }
    }
  })();
  self = task;
  inflight.set(cacheKey, task);
  return task;
}

/** 按 kind 拉取贡献（export_preset 等非 slot 类）。C4：真按 c.kind===kind 过滤。 */
export function usePluginContributions(kind: string): SlotContribution[] {
  const key = `kind:${kind}`;
  const [items, setItems] = useState<SlotContribution[]>(() => cache.get(key)?.items ?? []);
  useResyncOnInvalidate(key, setItems, kind);
  useEffect(() => {
    let alive = true;
    const gen = generation;
    void fetchContributions({ kind }, (c) => c.kind === kind, key).then((list) => {
      // C4：失效后的旧响应即便 promise 已 resolve 也不回写组件。
      if (alive && gen === generation) setItems(list);
    });
    return () => { alive = false; };
  }, [key, kind]);
  return items;
}

/** React 钩子：返回指定 slot 的贡献列表（挂载即拉取，卸载不取消缓存）。 */
export function usePluginSlots(slot: SlotName): SlotContribution[] {
  // PL-12（审计 PRD §5D P3）：写入侧的缓存键是 `slot:${slot}`（见
  // fetchSlotContributions），旧实现在这里用裸 `slot` 读缓存 → 永远不命中，
  // 每次挂载都多发一次请求。两处必须用同一个键。
  const cacheKey = `slot:${slot}`;
  const [items, setItems] = useState<SlotContribution[]>(() => cache.get(cacheKey)?.items ?? []);
  useResyncOnInvalidate(cacheKey, setItems);
  useEffect(() => {
    let alive = true;
    const gen = generation;
    void fetchSlotContributions(slot).then((list) => {
      if (alive && gen === generation) setItems(list);
    });
    return () => { alive = false; };
  }, [slot, cacheKey]);
  return items;
}

/**
 * B14：已挂载的宿主与 `Slot` 组件在缓存失效后必须同步刷新。
 *
 * 此前 `invalidatePluginSlots()` 只清模块级缓存，已挂载组件仍持有旧 state
 * （要等下次挂载/30s TTL 过期才更新）——宿主与 Slot 短暂不一致。这里让
 * 每个 hook 订阅失效广播，收到后立即重取一次；C4 同时按代际丢弃过期响应。
 */
function useResyncOnInvalidate(
  cacheKey: string,
  setItems: (items: SlotContribution[]) => void,
  kind?: string,
): void {
  useEffect(() => {
    let alive = true;
    const off = onPluginSlotsInvalidated(() => {
      const gen = generation;
      const refresh = kind !== undefined
        ? fetchContributions({ kind }, (c) => c.kind === kind, cacheKey)
        : fetchSlotContributions(cacheKey.replace(/^slot:/, '') as SlotName);
      void refresh.then((list) => {
        if (alive && gen === generation) setItems(list);
      });
    });
    return () => { alive = false; off(); };
  }, [cacheKey, setItems, kind]);
}
