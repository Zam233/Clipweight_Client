/**
 * 任务事件订阅（路线 C / C4）。
 *
 * 复用 `connectSseStream`（一次性 token + 退避重连），但**换了一条流**：
 * `/api/task/{id}/events/stream`。事件形状与管线 trace 不同——是 typed TaskEvent，
 * 所以这里不做"detail→data"的搬运，直接进 taskStore。
 *
 * 纪律：一条任务只订阅一条流。C3 的双轨期如果 off 模式还在用 trace 流，
 * 由页面决定挂哪个 hook，绝不同时挂两条（否则事件重复、成本翻倍）。
 */

import { useEffect } from 'react';

import { connectSseStream } from '@/services/api/sseStream';
import { taskApi } from '@/services/api/task';
import { useTaskStore } from '@/stores/taskStore';
import type { TaskEvent } from '@/types/task';

/** 只认 TaskEvent 形状（有 seq + type），其余丢弃——不猜、不兜底。 */
export function toTaskEvent(raw: unknown): TaskEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const ev = raw as Partial<TaskEvent>;
  if (typeof ev.seq !== 'number' || typeof ev.type !== 'string') return null;
  // B12/N6：causation_id 是「结果事件指回调用事件」的唯一可靠线索（`seq:<n>`）。
  // 旧实现靠工具名配对，同名工具并发时会串台。
  const causation = typeof ev.causation_id === 'string' ? ev.causation_id : '';
  return {
    seq: ev.seq,
    type: ev.type,
    ts: String(ev.ts || ''),
    message: String(ev.message || ''),
    detail: (ev.detail as Record<string, unknown>) || {},
    ...(causation ? { causation_id: causation } : {}),
    ...(typeof ev.run_id === 'string' && ev.run_id ? { run_id: ev.run_id } : {}),
    ...(typeof ev.trace_id === 'string' && ev.trace_id ? { trace_id: ev.trace_id } : {}),
    ...(typeof ev.span === 'string' && ev.span ? { span: ev.span } : {}),
  };
}

/**
 * 同一 taskId 的**引用计数**：M3 合流后，时间线宿主与任务面板可能同时挂这个 hook，
 * 两个组件各自订阅同一条 SSE 会导致事件重复应用、成本翻倍（PRD §8 反模式 3）。
 * 这里保证一条任务只有一条活跃流，最后一个卸载时才关闭。
 */
const _taskSubs = new Map<string, number>();

export function useTaskEvents(taskId: string | null, enabled = true): void {
  const applyEvent = useTaskStore((s) => s.applyEvent);
  const hydrateEvents = useTaskStore((s) => s.hydrateEvents);

  useEffect(() => {
    if (!taskId || !enabled) return;
    // 已有别的组件在订阅同一条任务流 → 本组件不重复订阅
    const refs = _taskSubs.get(taskId) ?? 0;
    _taskSubs.set(taskId, refs + 1);
    if (refs > 0) {
      return () => {
        const left = (_taskSubs.get(taskId) ?? 1) - 1;
        if (left <= 0) _taskSubs.delete(taskId);
        else _taskSubs.set(taskId, left);
      };
    }
    let closed = false;
    let handle: { close: () => void } | null = null;

    /**
     * 顺序很重要（PRD §7.2）：
     * 1. **先** REST 水合（把刷新/断线期间漏掉的历史补齐）；
     * 2. **再** 订 SSE（只收新事件）；
     * 3. SSE 断开时用 store 的 `lastSeq` 再补一段，然后重连。
     *
     * 旧实现直接订 SSE，一刷新就只剩"从此刻起"的事件；热层淘汰掉的历史
     * 更是永远看不到——用户会以为任务前面什么都没发生。
     */
    const start = async () => {
      await hydrateEvents(taskId, { sinceSeq: 0, limit: 2000 });
      if (closed) return;
      handle = connectSseStream({
        url: taskApi.eventsStreamUrl(taskId),
        onMessage: (raw) => {
          const event = toTaskEvent(raw);
          if (event) applyEvent(event);
        },
        // 每次重连**前**补一段：EventSource 重连只会从"新消息"开始发，
        // 断开那段时间的事件必须靠 REST 补回来（PRD §7.2）。
        onRetry: () => {
          if (closed) return;
          const last = useTaskStore.getState().lastSeq;
          void hydrateEvents(taskId, { sinceSeq: last, limit: 2000 });
        },
      });
    };
    void start();

    return () => {
      closed = true;
      handle?.close();
      _taskSubs.delete(taskId);
    };
  }, [taskId, enabled, applyEvent, hydrateEvents]);
}
