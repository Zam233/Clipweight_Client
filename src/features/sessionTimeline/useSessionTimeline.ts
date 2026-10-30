/**
 * 会话时间线订阅（session-timeline PRD §5.2 / §6.4）。
 *
 * 顺序不能反：**先 REST 拉一段（补齐刷新/断线窗口）→ 再订 SSE**。
 * 反过来的话，刷新后只剩"从此刻起"的内容，历史永远缺一段。
 *
 * 断线重连按 `latestSeq` 补齐，不需要前端自己推断缺口——服务端给 `has_more`。
 */

import { useEffect } from 'react';

import { connectSseStream } from '@/services/api/sseStream';
import { requirementsApi } from '@/services/api/requirements';
import { useSessionTimelineStore } from '@/stores/sessionTimelineStore';
import type { SessionTimelineFrame } from '@/features/sessionTimeline/types';

/** 同会话只允许一条流（面板里可能同时挂"时间线"与"轨迹"）。 */
const _subs = new Map<string, number>();

function asFrame(raw: unknown): SessionTimelineFrame | null {
  if (!raw || typeof raw !== 'object') return null;
  const op = (raw as { op?: unknown }).op;
  if (typeof op !== 'string') return null;
  return raw as SessionTimelineFrame;
}

export interface UseSessionTimelineOptions {
  enabled?: boolean;
  /** 首屏拉取条数（默认 500：翻页靠 before_seq） */
  limit?: number;
}

export function useSessionTimeline(
  sessionId: string | null | undefined,
  opts: UseSessionTimelineOptions = {},
): void {
  const enabled = opts.enabled ?? true;
  const limit = opts.limit ?? 500;
  const hydrate = useSessionTimelineStore((s) => s.hydrate);
  const applyFrame = useSessionTimelineStore((s) => s.applyFrame);
  const setLink = useSessionTimelineStore((s) => s.setLink);

  useEffect(() => {
    if (!sessionId || !enabled) return;
    const refs = _subs.get(sessionId) ?? 0;
    _subs.set(sessionId, refs + 1);
    if (refs > 0) {
      return () => {
        const left = (_subs.get(sessionId) ?? 1) - 1;
        if (left <= 0) _subs.delete(sessionId);
        else _subs.set(sessionId, left);
      };
    }

    let closed = false;
    let handle: { close: () => void; reconnect: () => void } | null = null;
    setLink(sessionId, 'loading');

    const start = async () => {
      try {
        const page = await requirementsApi.timeline(sessionId, { sinceSeq: 0, limit });
        if (closed) return;
        hydrate(sessionId, page.items ?? [], {
          latestSeq: page.latest_seq ?? 0,
          hasMore: page.has_more ?? false,
          archivedUntil: page.archived_until_seq ?? 0,
        });
      } catch {
        // 拉取失败不阻断实时流：SSE 的 snapshot 还能补一段
      }
      if (closed) return;
      setLink(sessionId, 'live');
      const since = useSessionTimelineStore.getState().latestSeq[sessionId] ?? 0;
      handle = connectSseStream({
        url: requirementsApi.timelineStreamUrl(sessionId, since),
        onMessage: (raw) => {
          const frame = asFrame(raw);
          if (!frame) return;
          if (frame.op === 'ping') return;
          applyFrame(sessionId, frame);
          if (frame.op === 'error') setLink(sessionId, 'retry');
        },
        onRetry: () => {
          if (closed) return;
          setLink(sessionId, 'retry');
          // 断开那段补齐：按 latestSeq 再拉一次（服务端给 has_more，不靠猜）
          const last = useSessionTimelineStore.getState().latestSeq[sessionId] ?? 0;
          void requirementsApi.timeline(sessionId, { sinceSeq: last, limit })
            .then((page) => {
              if (closed) return;
              hydrate(sessionId, page.items ?? [], {
                latestSeq: page.latest_seq ?? 0,
                hasMore: page.has_more ?? false,
                archivedUntil: page.archived_until_seq ?? 0,
              });
              setLink(sessionId, 'live');
            })
            .catch(() => setLink(sessionId, 'retry'));
        },
        onGiveUp: () => {
          if (!closed) setLink(sessionId, 'down');
        },
      });
    };
    void start();

    return () => {
      closed = true;
      handle?.close();
      _subs.delete(sessionId);
    };
  }, [sessionId, enabled, limit, hydrate, applyFrame, setLink]);
}

/** 向前翻一页（"加载更早"）：`before_seq` 之前最后 limit 条。 */
export async function loadEarlier(sessionId: string, limit = 200): Promise<boolean> {
  const store = useSessionTimelineStore.getState();
  const bucket = store.bySession[sessionId];
  const seqs = bucket ? Object.keys(bucket).map(Number) : [];
  const oldest = seqs.length ? Math.min(...seqs) : 0;
  if (!oldest) return false;
  const page = await requirementsApi.timeline(sessionId, { beforeSeq: oldest, limit });
  store.hydrate(sessionId, page.items ?? [], { hasMore: page.has_more ?? false });
  return (page.items ?? []).length > 0;
}
