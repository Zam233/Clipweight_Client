/**
 * 会话时间线订阅（session-timeline PRD §5.2 / §6.4；adaptation PRD T2）。
 *
 * 顺序不能反：**先 REST 拉一段（补齐刷新/断线窗口）→ 再订 SSE**。
 * 反过来的话，刷新后只剩"从此刻起"的内容，历史永远缺一段。
 *
 * 失败必须**说出来**：旧实现 `catch {}` 把拉取失败吞掉，界面照样显示
 * 「还没有可显示的内容」——把"接口坏了"说成"本来没内容"，这是误导（T2）。
 */

import { useCallback, useEffect } from 'react';

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

function errorText(err: unknown): string {
  const e = err as { response?: { status?: number }; message?: string } | undefined;
  const status = e?.response?.status;
  if (status) return `HTTP ${status}`;
  return e?.message || '网络中断';
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
  // 重试靠计数触发 effect 重跑：关旧流 → 重新拉首屏 → 重连（比"只补一次数据"可靠）
  const retryTick = useSessionTimelineStore((s) => s.retryTick[sessionId ?? ''] ?? 0);

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

    const pull = async (sinceSeq: number, isFirst: boolean): Promise<boolean> => {
      try {
        const page = await requirementsApi.timeline(sessionId, { sinceSeq, limit });
        if (closed) return true;
        hydrate(sessionId, page.items ?? [], {
          latestSeq: page.latest_seq ?? 0,
          hasMore: page.has_more ?? false,
          archivedUntil: page.archived_until_seq ?? 0,
          backfilled: isFirst ? (page.backfilled ?? 0) : 0,
        });
        return true;
      } catch (err) {
        if (closed) return false;
        // 拉取失败要留痕：空态据此说"接口不可用"而不是"没有内容"
        setLink(sessionId, 'down', errorText(err));
        return false;
      }
    };

    const start = async () => {
      const ok = await pull(0, true);
      if (closed) return;
      // 拉取失败也仍尝试实时流：SSE 的 snapshot 还能补一段（网络短暂抖动时救命）
      setLink(sessionId, ok ? 'live' : 'retry');
      const since = useSessionTimelineStore.getState().latestSeq[sessionId] ?? 0;
      handle = connectSseStream({
        url: requirementsApi.timelineStreamUrl(sessionId, since),
        onMessage: (raw) => {
          const frame = asFrame(raw);
          if (!frame || frame.op === 'ping') return;
          applyFrame(sessionId, frame);
          if (frame.op === 'error') setLink(sessionId, 'retry', frame.detail || '时间线流中断');
          else if (useSessionTimelineStore.getState().link[sessionId] !== 'live') {
            setLink(sessionId, 'live');
          }
        },
        onRetry: () => {
          if (closed) return;
          setLink(sessionId, 'retry');
          const last = useSessionTimelineStore.getState().latestSeq[sessionId] ?? 0;
          void pull(last, false);
        },
        onGiveUp: () => {
          if (!closed) setLink(sessionId, 'down', '实时流多次重连失败');
        },
      });
    };
    void start();

    return () => {
      closed = true;
      handle?.close();
      _subs.delete(sessionId);
    };
  }, [sessionId, enabled, limit, hydrate, applyFrame, setLink, retryTick]);
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

/** 手动重试（空态的「重试」按钮）：重跑订阅（拉首屏 + 重连实时流）。 */
export function useRetrySessionTimeline(sessionId: string | null | undefined): () => void {
  const retry = useSessionTimelineStore((s) => s.retry);
  return useCallback(() => {
    if (sessionId) retry(sessionId);
  }, [sessionId, retry]);
}
