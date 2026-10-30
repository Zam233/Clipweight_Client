/**
 * 统一时间线 store（unified-stream PRD §4.5）。
 *
 * 命名注意：编辑器自己的 `src/stores/timelineStore.ts` 是**工程时间线**（tracks/clips），
 * 这里叫 `unifiedTimelineStore`，两者不要混。
 *
 * 只是一个**只读展示投影**：
 * - 领域状态仍归 `agentStore`（brief/plan/status）与 `taskStore`（task/usage/lastSeq）；
 * - 这里不主动发请求：hydrate/apply 由既有 hook 调用（不重复订阅第二条 SSE）；
 * - 合并、去重、排序只在这里做，组件里禁止 `[...messages, ...events].sort()`。
 */

import { create } from 'zustand';
import type { TaskEvent } from '@/types/task';
import type { TimelineItem } from '@/features/unifiedTimeline/types';
import {
  compareTimeline,
  normalizeRequirementEvent,
  normalizeRequirementMessage,
  normalizeTaskEvent,
} from '@/features/unifiedTimeline/normalize';

export interface ScopeState {
  loaded: boolean;
  hasEarlier: boolean;
  lastSeq: number;
  oldestSeq: number;
  seqGap: { from: number; to: number } | null;
}

interface UnifiedTimelineState {
  itemsByKey: Record<string, TimelineItem>;
  /** 单调派发序号：跨源按"到达顺序"排，不碰时钟 */
  dispatch: number;
  requirements: ScopeState & { sessionId: string | null };
  tasks: Record<string, ScopeState>;
  live: { requirements: boolean; tasks: Record<string, boolean> };

  resetAll: () => void;
  resetRequirements: () => void;
  resetTask: (taskId: string) => void;

  applyRequirementMessages: (
    sessionId: string,
    messages: { id: string; role: string; content: string; timestamp?: string; streaming?: boolean }[],
  ) => void;
  applyRequirementEvent: (sessionId: string, event: TaskEvent) => void;
  applyRequirementReasoning: (sessionId: string, delta: string, done?: boolean) => void;

  hydrateTaskEvents: (taskId: string, events: TaskEvent[]) => void;
  applyTaskEvent: (taskId: string, event: TaskEvent) => void;
  setLive: (scope: 'requirements' | string, value: boolean) => void;

  ordered: () => TimelineItem[];
}

const _emptyScope = (): ScopeState => ({
  loaded: false, hasEarlier: false, lastSeq: 0, oldestSeq: 0, seqGap: null,
});

type Rec = Record<string, unknown>;

/** 合并一条条目：同 dedupeKey → patch，不新增（tool_result 回填、answer 覆盖 question）。 */
function _merge(
  prev: Record<string, TimelineItem>,
  item: TimelineItem,
  dispatch: number,
): { items: Record<string, TimelineItem>; dispatch: number; added: boolean } {
  const existing = prev[item.dedupeKey];
  const patch = item as unknown as Rec;
  if (!existing) {
    const withOrder = {
      ...patch,
      order: { ...(patch.order as Rec), ordinal: (patch.order as Rec).ordinal || dispatch },
    } as unknown as TimelineItem;
    return {
      items: { ...prev, [item.dedupeKey]: withOrder },
      dispatch: dispatch + 1,
      added: true,
    };
  }
  const next = { ...(existing as unknown as Rec) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined) continue;
    if (k === 'kind' && v !== next.kind) {
      // question → answer：同一 question_id 只留一条，标记已回答
      if (next.kind === 'question' && v === 'answer') {
        next.status = 'answered';
        next.answeredWith = { optionId: patch.optionId, text: patch.text };
      }
      continue;
    }
    if (k === 'text' && typeof v === 'string' && typeof next[k] === 'string') {
      next[k] = (next[k] as string) + v;      // reasoning 增量追加
      continue;
    }
    next[k] = v;
  }
  return {
    items: { ...prev, [item.dedupeKey]: next as unknown as TimelineItem },
    dispatch,
    added: false,
  };
}

export const useUnifiedTimelineStore = create<UnifiedTimelineState>((set, get) => ({
  itemsByKey: {},
  dispatch: 1,
  requirements: { ..._emptyScope(), sessionId: null },
  tasks: {},
  live: { requirements: false, tasks: {} },

  resetAll: () => set({
    itemsByKey: {}, dispatch: 1,
    requirements: { ..._emptyScope(), sessionId: null },
    tasks: {}, live: { requirements: false, tasks: {} },
  }),

  resetRequirements: () => set((s) => ({
    itemsByKey: Object.fromEntries(
      Object.entries(s.itemsByKey).filter(([, v]) => v.source !== 'requirements'),
    ),
    requirements: { ..._emptyScope(), sessionId: null },
  })),

  resetTask: (taskId) => set((s) => {
    const tasks = { ...s.tasks };
    delete tasks[taskId];
    return {
      itemsByKey: Object.fromEntries(
        Object.entries(s.itemsByKey).filter(([, v]) => v.taskId !== taskId),
      ),
      tasks,
    };
  }),

  applyRequirementMessages: (sessionId, messages) => set((s) => {
    let items = s.itemsByKey;
    let dispatch = s.dispatch;
    messages.forEach((m, i) => {
      const r = _merge(items, normalizeRequirementMessage(m, sessionId, i), dispatch);
      items = r.items; dispatch = r.dispatch;
    });
    return {
      itemsByKey: items, dispatch,
      requirements: { ...s.requirements, sessionId, loaded: true },
    };
  }),

  applyRequirementEvent: (sessionId, event) => set((s) => {
    const item = normalizeRequirementEvent(event, sessionId);
    if (!item) return {};
    const r = _merge(s.itemsByKey, item, s.dispatch);
    // 本轮思考已落盘成正式条目 → 丢掉流式期间那条临时条目（否则同一段思考出现两次）
    const liveKey = `req:live:${sessionId}`;
    const items = event.type === 'thinking' && r.items[liveKey]
      ? Object.fromEntries(Object.entries(r.items).filter(([k]) => k !== liveKey))
      : r.items;
    return { itemsByKey: items, dispatch: r.dispatch };
  }),

  applyRequirementReasoning: (sessionId, delta, done = false) => set((s) => {
    const key = `req:live:${sessionId}`;
    const existing = s.itemsByKey[key] as
      Extract<TimelineItem, { kind: 'reasoning' }> | undefined;
    if (existing) {
      const next = {
        ...existing,
        text: (existing.text + delta).slice(0, 400_000),
        done,
      };
      return {
        itemsByKey: { ...s.itemsByKey, [key]: next },
        live: { ...s.live, requirements: !done },
      };
    }
    const item = {
      key, dedupeKey: key, source: 'requirements',
      order: { ordinal: s.dispatch }, receivedAt: Date.now(),
      sessionId, kind: 'reasoning', phase: 'requirements',
      text: delta.slice(0, 400_000), done, availability: 'available',
    } as unknown as TimelineItem;
    return {
      itemsByKey: { ...s.itemsByKey, [key]: item },
      dispatch: s.dispatch + 1,
      live: { ...s.live, requirements: !done },
    };
  }),

  hydrateTaskEvents: (taskId, events) => set((s) => {
    let items = s.itemsByKey;
    let dispatch = s.dispatch;
    const pending = new Map<string, number[]>();
    let lastSeq = s.tasks[taskId]?.lastSeq ?? 0;
    let oldestSeq = s.tasks[taskId]?.oldestSeq ?? 0;
    for (const e of [...events].sort((a, b) => a.seq - b.seq)) {
      const item = normalizeTaskEvent(e, taskId, { pendingByName: pending });
      if (!item) continue;
      const r = _merge(items, item, dispatch);
      items = r.items; dispatch = r.dispatch;
      lastSeq = Math.max(lastSeq, e.seq);
      oldestSeq = oldestSeq ? Math.min(oldestSeq, e.seq) : e.seq;
    }
    return {
      itemsByKey: items, dispatch,
      tasks: {
        ...s.tasks,
        [taskId]: {
          loaded: true, hasEarlier: false, lastSeq, oldestSeq,
          seqGap: s.tasks[taskId]?.seqGap ?? null,
        },
      },
    };
  }),

  applyTaskEvent: (taskId, event) => set((s) => {
    const prevScope = s.tasks[taskId] ?? _emptyScope();
    // 缺口检测：seq 不连续 → 记 gap 并落成条目（不静默拼接历史）
    let gap = prevScope.seqGap;
    if (prevScope.lastSeq && event.seq > prevScope.lastSeq + 1) {
      gap = { from: prevScope.lastSeq + 1, to: event.seq - 1 };
    }
    const item = normalizeTaskEvent(event, taskId);
    const scope: ScopeState = {
      ...prevScope,
      loaded: true,
      lastSeq: Math.max(prevScope.lastSeq, event.seq),
      oldestSeq: prevScope.oldestSeq ? Math.min(prevScope.oldestSeq, event.seq) : event.seq,
      seqGap: gap,
    };
    let items = s.itemsByKey;
    let dispatch = s.dispatch;
    if (item) {
      const r = _merge(items, item, dispatch);
      items = r.items; dispatch = r.dispatch;
    }
    if (gap && gap !== prevScope.seqGap) {
      const gk = `task:gap:${taskId}:${gap.from}`;
      if (!items[gk]) {
        items = {
          ...items,
          [gk]: {
            key: gk, dedupeKey: gk, source: 'task', taskId,
            order: { ordinal: gap.from, seq: gap.from }, receivedAt: Date.now(),
            kind: 'gap', from: gap.from, to: gap.to,
          } as unknown as TimelineItem,
        };
        dispatch += 1;
      }
    }
    return { itemsByKey: items, dispatch, tasks: { ...s.tasks, [taskId]: scope } };
  }),

  setLive: (scope, value) => set((s) => (scope === 'requirements'
    ? { live: { ...s.live, requirements: value } }
    : { live: { ...s.live, tasks: { ...s.live.tasks, [scope]: value } } })),

  ordered: () => Object.values(get().itemsByKey).sort(compareTimeline),
}));

/** 按 scope 取有序条目（组件别自己再排一次）。 */
export function selectOrderedItems(
  state: Pick<UnifiedTimelineState, 'itemsByKey'>,
  filter?: { sessionId?: string; taskId?: string },
): TimelineItem[] {
  const all = Object.values(state.itemsByKey);
  const filtered = filter
    ? all.filter((it) => (!filter.sessionId || it.sessionId === filter.sessionId)
        && (!filter.taskId || it.taskId === filter.taskId))
    : all;
  return filtered.sort(compareTimeline);
}
