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
import type { SseStreamHandle } from '@/services/api/sseStream';
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
 * 同一 taskId 的共享流。**引用计数与连接必须放在同一条记录里**：
 * 旧实现只计 refs，首个订阅者卸载时无条件 close——即使还有别的组件在看，
 * 剩余那些就永久失联了。
 */
interface TaskSub {
  refs: number;
  handle: SseStreamHandle | null;
  closed: boolean;
}

const _taskSubs = new Map<string, TaskSub>();

function _terminal(): boolean {
  const st = useTaskStore.getState();
  if (st.task && ['done', 'failed', 'cancelled', 'unknown_terminal'].includes(st.task.status)) {
    return true;
  }
  return st.events[st.events.length - 1]?.type === 'task_end';
}

export function useTaskEvents(taskId: string | null, enabled = true): void {
  const applyEvent = useTaskStore((s) => s.applyEvent);
  const hydrateEvents = useTaskStore((s) => s.hydrateEvents);

  useEffect(() => {
    if (!taskId || !enabled) return;
    let entry = _taskSubs.get(taskId);
    if (!entry) {
      entry = { refs: 0, handle: null, closed: false };
      _taskSubs.set(taskId, entry);
    }
    entry.refs += 1;

    const close = () => {
      entry!.closed = true;
      entry!.handle?.close();
      entry!.handle = null;
    };

    /**
     * 顺序很重要（PRD §7.2）：
     * 1. **先** REST 水合（把刷新/断线期间漏掉的历史补齐）；
     * 2. **再** 订 SSE（从 `lastSeq` 继续，不重放整段历史）；
     * 3. SSE 断开时用 store 的 `lastSeq` 再补一段，然后重连。
     */
    const start = async () => {
      if (entry!.refs <= 0 || entry!.closed) return;
      await hydrateEvents(taskId, { sinceSeq: 0, limit: 2000 });
      if (entry!.closed || entry!.refs <= 0) return;
      if (useTaskStore.getState().activeTaskId !== taskId) return;
      // 终态任务不再建立实时流：后端发完 task_end 就 EOF，前端若仍重连会形成
      // “回放 → EOF → 重连”的死循环（实测无限请求）。
      if (_terminal()) {
        close();
        return;
      }
      const since = useTaskStore.getState().lastSeq;
      entry!.handle = connectSseStream({
        url: taskApi.eventsStreamUrl(taskId, since),
        onMessage: (raw) => {
          const event = toTaskEvent(raw);
          if (!event) return;
          applyEvent(event, taskId);
          if (event.type === 'task_end') close();
        },
        // 每次重连**前**补一段：EventSource 重连只会从"新消息"开始发，
        // 断开那段时间的事件必须靠 REST 补回来（PRD §7.2）。
        onRetry: () => {
          if (entry!.closed) return;
          const last = useTaskStore.getState().lastSeq;
          void hydrateEvents(taskId, { sinceSeq: last, limit: 2000 });
        },
      });
    };

    if (entry.refs === 1) void start();

    return () => {
      entry!.refs -= 1;
      if (entry!.refs <= 0) {
        close();
        _taskSubs.delete(taskId);
      }
    };
  }, [taskId, enabled, applyEvent, hydrateEvents]);
}
