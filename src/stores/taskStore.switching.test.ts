/**
 * 任务切换隔离（2026-11-01 审查修复）。
 *
 * 现象：任务 A 已收到 seq=500，切到任务 B 后 B 的前 500 条事件被 `lastSeq`
 * 当成重复整段丢弃；更慢的旧请求还能在水合完成后把 A 的数据写回 B 的窗口。
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { api } = vi.hoisted(() => ({
  api: {
    get: vi.fn(),
    events: vi.fn(),
    eventsStreamUrl: vi.fn((id: string) => `http://x/${id}`),
  },
}));

vi.mock('@/services/api/task', () => ({ taskApi: api }));

import { useTaskStore } from './taskStore';
import type { Task, TaskEvent } from '@/types/task';

function makeTask(id: string, status: Task['status'] = 'running'): Task {
  return {
    id,
    status,
    mode: 'on',
    request: {
      topic: id, persona_id: '', category_plugin_id: '',
      duration_sec: 0, plan_only: false, extra: {},
    },
    plan: null,
    limits: { max_turns: 30, max_tool_calls: 80, max_wall_sec: 3600, budget_usd: null },
    usage: { turns: 0, tool_calls: 0, tokens: 0, cost_usd: 0, wall_sec: 0 },
    finish: null,
    context_digest: [],
    created_at: '',
    updated_at: '',
  };
}

const ev = (seq: number): TaskEvent => ({
  seq, type: 'narration', ts: '', message: `e${seq}`, detail: {},
});

beforeEach(() => {
  useTaskStore.getState().reset();
  api.get.mockReset();
  api.events.mockReset();
});

describe('taskStore 任务切换', () => {
  it('切任务立即清空旧事件与 seq 游标，再装新任务', async () => {
    useTaskStore.setState({
      task: makeTask('task_a'),
      activeTaskId: 'task_a',
      events: [ev(499), ev(500)],
      lastSeq: 500,
      oldestLoadedSeq: 499,
      hasEarlierEvents: true,
      seqGap: { from: 1, to: 2 },
    });
    api.get.mockResolvedValue({ task: makeTask('task_b'), events: 0 });

    const pending = useTaskStore.getState().load('task_b');
    // 同步阶段就必须切干净：SSE 可能在 taskApi 返回前就到达。
    expect(useTaskStore.getState().activeTaskId).toBe('task_b');
    expect(useTaskStore.getState().events).toEqual([]);
    expect(useTaskStore.getState().lastSeq).toBe(0);
    expect(useTaskStore.getState().oldestLoadedSeq).toBe(0);
    expect(useTaskStore.getState().hasEarlierEvents).toBe(false);
    expect(useTaskStore.getState().seqGap).toBeNull();

    await pending;
    expect(useTaskStore.getState().task?.id).toBe('task_b');
  });

  it('切任务前发出的水合请求，返回后不会污染新任务', async () => {
    useTaskStore.setState({ task: makeTask('task_a'), activeTaskId: 'task_a' });
    let resolveOld!: (value: unknown) => void;
    api.events.mockReturnValue(new Promise((r) => { resolveOld = r; }));

    const oldHydrate = useTaskStore.getState().hydrateEvents('task_a', { sinceSeq: 0 });
    api.get.mockResolvedValue({ task: makeTask('task_b'), events: 0 });
    await useTaskStore.getState().load('task_b');

    resolveOld({
      task_id: 'task_a', count: 1, items: [ev(1)],
      latest_seq: 1, oldest_available_seq: 1, has_more: false,
    });
    await oldHydrate;

    expect(useTaskStore.getState().activeTaskId).toBe('task_b');
    expect(useTaskStore.getState().events).toEqual([]);
    expect(useTaskStore.getState().lastSeq).toBe(0);
  });

  it('原始事件窗口挤掉 start 后，run 生命周期仍保留', () => {
    useTaskStore.setState({ task: makeTask('task_r'), activeTaskId: 'task_r' });
    useTaskStore.getState().applyEvent({
      seq: 1, type: 'agent_run_start', ts: '', message: '派出',
      detail: { run_id: 'run_1', stage: 'material', status: 'running' },
    }, 'task_r');
    for (let seq = 2; seq <= 700; seq += 1) {
      useTaskStore.getState().applyEvent(ev(seq), 'task_r');
    }
    expect(useTaskStore.getState().events).toHaveLength(400);
    expect(useTaskStore.getState().runEvents.map((e) => e.type)).toEqual(['agent_run_start']);
  });

  it('plan_only_completed 按成功处理', async () => {
    useTaskStore.setState({ task: makeTask('task_p'), activeTaskId: 'task_p' });
    useTaskStore.getState().applyEvent({
      seq: 1, type: 'task_end', ts: '', message: '规划完成',
      detail: { reason: 'plan_only_completed', completed: ['plan'], unfinished: [] },
    }, 'task_p');
    expect(useTaskStore.getState().task?.status).toBe('done');
    expect(useTaskStore.getState().task?.finish?.completed).toEqual(['plan']);
  });

  it('task_end 缺省未完成字段时保留已有收尾信息', () => {
    const task = makeTask('task_f', 'failed');
    task.finish = {
      conclusion: '旧结论', completed: ['结构'], unfinished: ['degraded:anim'], reason: 'old',
    };
    useTaskStore.setState({ task, activeTaskId: 'task_f' });
    useTaskStore.getState().applyEvent({
      seq: 1, type: 'task_end', ts: '', message: '工具循环失败',
      detail: { reason: 'tool_loop_error:model' },
    }, 'task_f');
    expect(useTaskStore.getState().task?.finish?.unfinished).toEqual(['degraded:anim']);
  });
});
