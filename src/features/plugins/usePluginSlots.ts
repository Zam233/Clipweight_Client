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
const cache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<SlotContribution[]>>();

/** 插件启停后调用：清空缓存，下一次挂载重新拉取（G7 生命周期同步）。 */
export function invalidatePluginSlots(): void {
  cache.clear();
}

function parseContributions(raw: unknown): SlotContribution[] {
  const payload = raw as { contributions?: unknown } | null;
  const list = Array.isArray(payload?.contributions) ? payload!.contributions : [];
  const out: SlotContribution[] = [];
  for (const item of list) {
    const c = item as Partial<SlotContribution>;
    if (!c || typeof c.id !== 'string' || typeof c.title !== 'string') continue;
    if (!isSlotName(c.slot)) continue; // slot 名白名单（安全负例：未知 slot 丢弃）
    out.push(sanitizeIContribution(c as SlotContribution));
  }
  return out;
}

/** 拉取指定 slot 的全部贡献（含缓存/在途去重）。失败静默为空（插件面不阻塞宿主）。 */
export async function fetchSlotContributions(slot: SlotName): Promise<SlotContribution[]> {
  const now = Date.now();
  const hit = cache.get(slot);
  if (hit && now - hit.at < TTL_MS) return hit.items;
  const pending = inflight.get(slot);
  if (pending) return pending;

  const task = (async () => {
    try {
      const { data } = await getApiClient().get('/api/plugin/contributions', {
        params: { kind: 'ui_slot', slot },
      });
      const items = parseContributions(data)
        .filter((c) => c.slot === slot)
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
      cache.set(slot, { at: Date.now(), items });
      return items;
    } catch {
      return [];
    } finally {
      inflight.delete(slot);
    }
  })();
  inflight.set(slot, task);
  return task;
}

/** React 钩子：返回指定 slot 的贡献列表（挂载即拉取，卸载不取消缓存）。 */
export function usePluginSlots(slot: SlotName): SlotContribution[] {
  const [items, setItems] = useState<SlotContribution[]>(() => cache.get(slot)?.items ?? []);
  useEffect(() => {
    let alive = true;
    void fetchSlotContributions(slot).then((list) => {
      if (alive) setItems(list);
    });
    return () => { alive = false; };
  }, [slot]);
  return items;
}
