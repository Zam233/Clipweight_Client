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

export function useTaskEvents(taskId: string | null, enabled = true): void {
  const applyEvent = useTaskStore((s) => s.applyEvent);

  useEffect(() => {
    if (!taskId || !enabled) return;
    const handle = connectSseStream({
      url: taskApi.eventsStreamUrl(taskId),
      onMessage: (raw) => {
        const event = toTaskEvent(raw);
        if (event) applyEvent(event);
      },
    });
    return () => handle.close();
  }, [taskId, enabled, applyEvent]);
}
