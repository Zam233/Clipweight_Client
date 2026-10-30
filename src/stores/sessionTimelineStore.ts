/**
 * 会话时间线 store（session-timeline PRD §6）。
 *
 * 只有一件事必须做对：**位置 = 服务端 `seq`**。
 *
 * - `hydrate` 用 `GET /timeline` 拉一段（刷新/分页）；
 * - `applyFrame` 吃 SSE 的 `snapshot / append / chunk / patch / finish`；
 * - 同一 seq 只存在一份，`chunk` 增量追加到该 seq 的文本上——这就是流式渲染；
 * - **没有** dispatch 序号、没有 `Date.parse` 比较、没有临时条目（这些是 S4 删掉的东西）。
 *
 * 排序只发生在读取时（按 seq 数值升序），而且只是"把 map 摊平成数组"。
 */

import { create } from 'zustand';

import type {
  SessionTimelineFrame,
  SessionTimelineItem,
} from '@/features/sessionTimeline/types';

export type SessionLinkState = 'idle' | 'loading' | 'live' | 'retry' | 'down';

export type SessionBucket = Record<number, SessionTimelineItem>;

interface SessionTimelineState {
  /** sessionId → (seq → item) */
  bySession: Record<string, SessionBucket>;
  /** sessionId → 已收到的最新 seq（重连用它补齐） */
  latestSeq: Record<string, number>;
  /** sessionId → 服务端还有更早的（has_more） */
  hasMore: Record<string, boolean>;
  /** sessionId → 归档边界（早于它的条目在服务端 archive/ 里） */
  archivedUntil: Record<string, number>;
  /** sessionId → 连接状态（"重连中"要如实显示，不假装一切正常） */
  link: Record<string, SessionLinkState>;

  hydrate: (
    sessionId: string,
    items: SessionTimelineItem[],
    opts?: { latestSeq?: number; hasMore?: boolean; archivedUntil?: number },
  ) => void;
  applyFrame: (sessionId: string, frame: SessionTimelineFrame) => void;
  setLink: (sessionId: string, link: SessionLinkState) => void;
  reset: (sessionId?: string) => void;
}

export const EMPTY_BUCKET: SessionBucket = {};
const EMPTY_ITEMS: SessionTimelineItem[] = [];

function upsert(bucket: SessionBucket, item: SessionTimelineItem): SessionBucket {
  const prev = bucket[item.seq];
  if (!prev) return { ...bucket, [item.seq]: item };
  // 同一 seq 只更新：`seq` / `time` / `type` 是身份字段，永不改写。
  // `content` 允许变短——服务端收尾时用的是权威全文，不是"拼得越长越对"。
  return {
    ...bucket,
    [item.seq]: {
      ...prev,
      ...item,
      seq: prev.seq,
      time: prev.time,
      type: prev.type,
      content: item.content === undefined ? prev.content : item.content,
    },
  };
}

function sortBucket(bucket: SessionBucket): SessionTimelineItem[] {
  return Object.keys(bucket)
    .map(Number)
    .sort((a, b) => a - b)
    .map((seq) => bucket[seq]);
}

/** 摊平并排序（组件用 `useMemo` 缓存，别每次渲染新建数组）。 */
export function itemsOf(bucket: SessionBucket | undefined): SessionTimelineItem[] {
  if (!bucket) return EMPTY_ITEMS;
  return sortBucket(bucket);
}

export function maxSeqOf(bucket: SessionBucket | undefined): number {
  if (!bucket) return 0;
  const seqs = Object.keys(bucket).map(Number);
  return seqs.length ? Math.max(...seqs) : 0;
}

export const useSessionTimelineStore = create<SessionTimelineState>((set) => ({
  bySession: {},
  latestSeq: {},
  hasMore: {},
  archivedUntil: {},
  link: {},

  hydrate: (sessionId, items, opts = {}) => set((s) => {
    const bucket: SessionBucket = { ...(s.bySession[sessionId] ?? {}) };
    for (const item of items) {
      if (!item || typeof item.seq !== 'number') continue;
      bucket[item.seq] = { ...(bucket[item.seq] ?? {}), ...item, seq: item.seq };
    }
    const latest = Math.max(s.latestSeq[sessionId] ?? 0, opts.latestSeq ?? 0, maxSeqOf(bucket));
    return {
      bySession: { ...s.bySession, [sessionId]: bucket },
      latestSeq: { ...s.latestSeq, [sessionId]: latest },
      hasMore: { ...s.hasMore, [sessionId]: opts.hasMore ?? s.hasMore[sessionId] ?? false },
      archivedUntil: {
        ...s.archivedUntil,
        [sessionId]: opts.archivedUntil ?? s.archivedUntil[sessionId] ?? 0,
      },
    };
  }),

  applyFrame: (sessionId, frame) => set((s) => {
    const bucket: SessionBucket = { ...(s.bySession[sessionId] ?? {}) };
    const prevLatest = s.latestSeq[sessionId] ?? 0;

    switch (frame.op) {
      case 'snapshot': {
        for (const item of frame.items ?? []) {
          if (!item || typeof item.seq !== 'number') continue;
          bucket[item.seq] = item;
        }
        const latest = Math.max(prevLatest, frame.latest_seq ?? 0, maxSeqOf(bucket));
        return {
          bySession: { ...s.bySession, [sessionId]: bucket },
          latestSeq: { ...s.latestSeq, [sessionId]: latest },
          hasMore: { ...s.hasMore, [sessionId]: !!frame.has_more },
          archivedUntil: { ...s.archivedUntil, [sessionId]: frame.archived_until_seq ?? 0 },
        };
      }
      case 'append':
      case 'patch':
      case 'finish': {
        const item = frame.item;
        if (!item || typeof item.seq !== 'number') return s;
        return {
          bySession: { ...s.bySession, [sessionId]: upsert(bucket, item) },
          latestSeq: { ...s.latestSeq, [sessionId]: Math.max(prevLatest, item.seq) },
        };
      }
      case 'chunk': {
        const prev = bucket[frame.seq];
        // 没占位就来的增量直接丢弃：它会随 snapshot 一起补齐，不能凭空造条目
        if (!prev) return s;
        const text = typeof prev.content === 'string' ? prev.content : '';
        bucket[frame.seq] = { ...prev, content: text + (frame.delta ?? '') };
        return { bySession: { ...s.bySession, [sessionId]: bucket } };
      }
      default:
        return s;
    }
  }),

  setLink: (sessionId, link) => set((s) => ({
    link: { ...s.link, [sessionId]: link },
  })),

  reset: (sessionId) => set((s) => {
    if (!sessionId) {
      return { bySession: {}, latestSeq: {}, hasMore: {}, archivedUntil: {}, link: {} };
    }
    const { [sessionId]: _d, ...rest } = s.bySession;
    const { [sessionId]: _l, ...latest } = s.latestSeq;
    const { [sessionId]: _h, ...hasMore } = s.hasMore;
    const { [sessionId]: _a, ...arch } = s.archivedUntil;
    const { [sessionId]: _k, ...link } = s.link;
    return { bySession: rest, latestSeq: latest, hasMore, archivedUntil: arch, link };
  }),
}));
