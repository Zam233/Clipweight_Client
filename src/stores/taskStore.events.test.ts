/**
 * M3：事件恢复（先 hydrate 再 SSE、断线按 lastSeq 补拉、seq 缺口提示、往前翻页）。
 */
// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api, sse } = vi.hoisted(() => ({
  api: { events: vi.fn(), eventsStreamUrl: () => 'http://x/events/stream' },
  sse: { connectSseStream: vi.fn() },
}));
vi.mock('@/services/api/task', () => ({ taskApi: api }));
vi.mock('@/services/api/sseStream', () => ({ connectSseStream: sse.connectSseStream }));

import { useTaskStore } from '@/stores/taskStore';

const ev = (seq: number) => ({ seq, type: 'narration' as const, ts: '', message: `e${seq}`, detail: {} });

beforeEach(() => {
  useTaskStore.getState().reset();
  api.events.mockReset();
  sse.connectSseStream.mockReset();
  sse.connectSseStream.mockReturnValue({ close: vi.fn(), reconnect: vi.fn() });
});

describe('taskStore 事件恢复', () => {
  it('hydrateEvents 按 sinceSeq 拉取并逐条入栈（seq 去重）', async () => {
    api.events.mockResolvedValue({
      task_id: 't', count: 3, items: [ev(1), ev(2), ev(3)],
      latest_seq: 3, oldest_available_seq: 1, has_more: false,
    });
    await useTaskStore.getState().hydrateEvents('t', { sinceSeq: 0 });
    expect(api.events).toHaveBeenCalledWith('t', { sinceSeq: 0, beforeSeq: undefined, limit: undefined });
    expect(useTaskStore.getState().events.map((e) => e.seq)).toEqual([1, 2, 3]);
    expect(useTaskStore.getState().lastSeq).toBe(3);
    expect(useTaskStore.getState().hasEarlierEvents).toBe(false);
  });

  it('序号跳空时记录 seqGap（不假装完整）', async () => {
    api.events.mockResolvedValue({
      task_id: 't', count: 2, items: [ev(1), ev(9)],
      latest_seq: 9, oldest_available_seq: 1, has_more: false,
    });
    await useTaskStore.getState().hydrateEvents('t', { sinceSeq: 0 });
    expect(useTaskStore.getState().seqGap).toEqual({ from: 2, to: 8 });
  });

  it('has_more 且更早可用 → hasEarlierEvents=true', async () => {
    api.events.mockResolvedValue({
      task_id: 't', count: 2, items: [ev(50), ev(51)],
      latest_seq: 51, oldest_available_seq: 1, has_more: true,
    });
    await useTaskStore.getState().hydrateEvents('t', { sinceSeq: 0, limit: 2 });
    expect(useTaskStore.getState().hasEarlierEvents).toBe(true);
    expect(useTaskStore.getState().oldestLoadedSeq).toBe(50);
  });

  it('loadEarlierEvents 把更早的 prepend 并保持升序', async () => {
    api.events.mockResolvedValueOnce({
      task_id: 't', count: 2, items: [ev(50), ev(51)],
      latest_seq: 51, oldest_available_seq: 1, has_more: true,
    });
    await useTaskStore.getState().hydrateEvents('t', { sinceSeq: 0 });
    api.events.mockResolvedValueOnce({
      task_id: 't', count: 2, items: [ev(48), ev(49)],
      latest_seq: 51, oldest_available_seq: 1, has_more: true,
    });
    await useTaskStore.getState().loadEarlierEvents('t', 2);
    expect(api.events).toHaveBeenLastCalledWith('t', { beforeSeq: 50, limit: 2 });
    expect(useTaskStore.getState().events.map((e) => e.seq)).toEqual([48, 49, 50, 51]);
    expect(useTaskStore.getState().oldestLoadedSeq).toBe(48);
  });

  it('没有更早历史时 loadEarlierEvents 直接收口', async () => {
    api.events.mockResolvedValueOnce({
      task_id: 't', count: 1, items: [ev(1)],
      latest_seq: 1, oldest_available_seq: 1, has_more: false,
    });
    await useTaskStore.getState().hydrateEvents('t', { sinceSeq: 0 });
    await useTaskStore.getState().loadEarlierEvents('t');
    expect(useTaskStore.getState().hasEarlierEvents).toBe(false);
    expect(useTaskStore.getState().events).toHaveLength(1);
  });
});
