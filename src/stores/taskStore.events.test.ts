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

/** S-02/S-03（PRD §4 P1/P2）：窗口裁剪后游标必须同步；翻页历史也要并进 runEvents。 */
describe('taskStore S-02/S-03 事件窗口不变量', () => {
  it('S-02：实时事件把窗口裁到 400 条后，oldestLoadedSeq 同步前进且允许加载更早', () => {
    useTaskStore.setState({ task: null, activeTaskId: 't_trim', oldestLoadedSeq: 1 });
    for (let seq = 1; seq <= 450; seq += 1) {
      useTaskStore.getState().applyEvent(ev(seq), 't_trim');
    }
    const st = useTaskStore.getState();
    expect(st.events).toHaveLength(400);
    // 旧实现 oldestLoadedSeq 停在 1，翻页会以 1 为 beforeSeq 请求，中间段永远看不到
    expect(st.oldestLoadedSeq).toBe(51);
    expect(st.hasEarlierEvents).toBe(true);
  });

  it('S-02：未触发裁剪时游标保持不变（不误标缺口）', () => {
    useTaskStore.setState({ task: null, activeTaskId: 't_keep', oldestLoadedSeq: 7 });
    useTaskStore.getState().applyEvent(ev(7), 't_keep');
    expect(useTaskStore.getState().oldestLoadedSeq).toBe(7);
    expect(useTaskStore.getState().hasEarlierEvents).toBe(false);
  });

  it('S-03：loadEarlierEvents 把历史里的 agent_run_* 也并进 runEvents', async () => {
    const runEv = (seq: number) => ({
      seq, type: 'agent_run_start' as const, ts: '', message: `run${seq}`,
      detail: { run_id: `r${seq}` },
    });
    useTaskStore.setState({ task: null, activeTaskId: 't_runs' });
    api.events.mockResolvedValueOnce({
      task_id: 't_runs', count: 1, items: [ev(60)],
      latest_seq: 60, oldest_available_seq: 1, has_more: true,
    });
    await useTaskStore.getState().hydrateEvents('t_runs', { sinceSeq: 0 });
    expect(useTaskStore.getState().runEvents).toHaveLength(0);

    api.events.mockResolvedValueOnce({
      task_id: 't_runs', count: 2, items: [runEv(40), ev(41)],
      latest_seq: 60, oldest_available_seq: 1, has_more: true,
    });
    await useTaskStore.getState().loadEarlierEvents('t_runs', 2);
    const st = useTaskStore.getState();
    expect(st.runEvents.map((e) => e.seq)).toEqual([40]);
    expect(st.events.map((e) => e.seq)).toContain(40);
    expect(st.events.map((e) => e.seq)).toContain(60);
  });
});
