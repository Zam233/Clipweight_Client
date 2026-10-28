/**
 * C4：taskStore —— 事件驱动状态推导。
 *
 * 关键点：**plan/step 状态由事件推导**，不是从后端再拉一份"当前阶段"。
 * 如果这里有 bug，界面会显示"计划 3 步全 pending，但任务已经 done"。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { api } = vi.hoisted(() => ({
  api: {
    create: vi.fn(),
    get: vi.fn(),
    events: vi.fn(),
    pause: vi.fn(async () => ({ status: 'paused' })),
    resume: vi.fn(async () => ({ status: 'running' })),
    cancel: vi.fn(async () => ({ status: 'cancelled' })),
    inject: vi.fn(async () => ({ injected: true })),
    replan: vi.fn(),
    list: vi.fn(async () => ({ count: 0, items: [] })),
    eventsStreamUrl: vi.fn((id: string) => `http://x/api/task/${id}/events/stream`),
  },
}));

vi.mock('@/services/api/task', () => ({ taskApi: api }));

import {  MAX_TASK_EVENTS, useTaskStore , terminalStatusOf } from './taskStore';
import type { Task, TaskEvent } from '@/types/task';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_1',
    status: 'pending',
    mode: 'on',
    request: {
      topic: '县域经济',
      persona_id: '',
      category_plugin_id: '',
      duration_sec: 60,
      plan_only: true,
      extra: {},
    },
    plan: {
      steps: [
        {
          id: 's1', title: '探测', capability: 'media_probe', kind: 'tool', args: {},
          why: '', est_cost_usd: 0.01, status: 'pending', attempt: 0,
          result_brief: '', error: null, duration_ms: 0,
        },
        {
          id: 's2', title: '整片生成', capability: 'run_pipeline', kind: 'pipeline',
          args: {}, why: '', est_cost_usd: null, status: 'pending', attempt: 0,
          result_brief: '', error: null, duration_ms: 0,
        },
      ],
      version: 1, rationale: '固定两步', est_total_cost_usd: null,
      created_at: '2026-10-17T00:00:00Z',
    },
    limits: { max_turns: 30, max_tool_calls: 80, max_wall_sec: 3600, budget_usd: null },
    usage: { turns: 0, tool_calls: 0, tokens: 0, cost_usd: 0, wall_sec: 0 },
    finish: null,
    context_digest: [],
    created_at: '2026-10-17T00:00:00Z',
    updated_at: '2026-10-17T00:00:00Z',
    ...overrides,
  };
}

function ev(seq: number, type: TaskEvent['type'], detail: Record<string, unknown> = {},
            message = ''): TaskEvent {
  return { seq, type, ts: '', message, detail };
}

beforeEach(() => {
  vi.clearAllMocks();
  useTaskStore.getState().reset();
});

describe('createTask / load', () => {
  it('创建任务后落 task，且默认 plan_only 交给 API 决定', async () => {
    api.create.mockResolvedValue({ task: makeTask(), planned: true, started: false });
    const task = await useTaskStore.getState().createTask({ topic: '县域经济' });
    expect(task?.id).toBe('task_1');
    expect(useTaskStore.getState().task?.request.topic).toBe('县域经济');
    expect(api.create).toHaveBeenCalledWith({ topic: '县域经济' });
  });

  it('创建失败落 error 并返回 null', async () => {
    api.create.mockRejectedValue(new Error('后端离线'));
    const task = await useTaskStore.getState().createTask({ topic: 'x' });
    expect(task).toBeNull();
    expect(useTaskStore.getState().error).toContain('后端离线');
  });
});

describe('applyEvent 推导', () => {
  it('step_start 把步骤置为 running 并累加 attempt', () => {
    useTaskStore.setState({ task: makeTask() });
    useTaskStore.getState().applyEvent(ev(1, 'step_start', { step_id: 's1', attempt: 1 }));
    const step = useTaskStore.getState().task!.plan!.steps[0];
    expect(step.status).toBe('running');
    expect(step.attempt).toBe(1);
  });

  it('tool_result 失败 → 步骤 failed 且带错误', () => {
    useTaskStore.setState({ task: makeTask() });
    useTaskStore.getState().applyEvent(
      ev(1, 'tool_result', { step_id: 's1', status: 'error', error: 'ffmpeg 失败' }),
    );
    const step = useTaskStore.getState().task!.plan!.steps[0];
    expect(step.status).toBe('failed');
    expect(step.error).toContain('ffmpeg');
  });

  it('step_end done → 步骤 done', () => {
    useTaskStore.setState({ task: makeTask() });
    useTaskStore.getState().applyEvent(
      ev(1, 'step_end', { step_id: 's1', status: 'done' }),
    );
    expect(useTaskStore.getState().task!.plan!.steps[0].status).toBe('done');
  });

  it('replan 追加步骤并抬版本号', () => {
    useTaskStore.setState({ task: makeTask() });
    useTaskStore.getState().applyEvent(
      ev(1, 'replan', {
        steps: [{
          id: 'r1', title: '补图', capability: 'text_diagram', kind: 'tool', args: {},
          why: '', est_cost_usd: null, status: 'pending', attempt: 0,
          result_brief: '', error: null, duration_ms: 0,
        }],
      }),
    );
    const plan = useTaskStore.getState().task!.plan!;
    expect(plan.steps).toHaveLength(3);
    expect(plan.version).toBe(2);
  });

  it('task_end plan_completed → done + 收尾三件套', () => {
    useTaskStore.setState({ task: makeTask({ status: 'running' }) });
    useTaskStore.getState().applyEvent(
      ev(9, 'task_end', { reason: 'plan_completed', completed: ['探测'], unfinished: [] },
        '已完成 1 步'),
    );
    const task = useTaskStore.getState().task!;
    expect(task.status).toBe('done');
    expect(task.finish?.conclusion).toBe('已完成 1 步');
    expect(task.finish?.completed).toEqual(['探测']);
  });

  it('task_end 非 completed → failed', () => {
    useTaskStore.setState({ task: makeTask({ status: 'running' }) });
    useTaskStore.getState().applyEvent(
      ev(2, 'task_end', { reason: 'step_failed:media_probe', unfinished: ['探测'] }),
    );
    expect(useTaskStore.getState().task!.status).toBe('failed');
  });

  it('重复 seq 被忽略（重连回放不重复渲染）', () => {
    useTaskStore.setState({ task: makeTask() });
    const e = ev(3, 'step_end', { step_id: 's1', status: 'done' });
    useTaskStore.getState().applyEvent(e);
    useTaskStore.getState().applyEvent(e);
    expect(useTaskStore.getState().events).toHaveLength(1);
    expect(useTaskStore.getState().lastSeq).toBe(3);
  });

  it('脏事件被丢弃且不抛错', () => {
    useTaskStore.getState().applyEvent({ seq: 1 } as never);
    useTaskStore.getState().applyEvent({} as never);
    expect(useTaskStore.getState().events).toHaveLength(0);
  });

  it('事件保留上限', () => {
    useTaskStore.setState({ task: makeTask() });
    for (let i = 1; i <= MAX_TASK_EVENTS + 5; i++) {
      useTaskStore.getState().applyEvent(ev(i, 'checkpoint', {}));
    }
    expect(useTaskStore.getState().events).toHaveLength(MAX_TASK_EVENTS);
  });
});

describe('动作', () => {
  it('pause/resume/cancel 都调用 API 并重载任务', async () => {
    api.get.mockResolvedValue({ task: makeTask({ status: 'paused' }), events: 0 });
    await useTaskStore.getState().pause('task_1');
    expect(api.pause).toHaveBeenCalledWith('task_1');
    expect(api.get).toHaveBeenCalledWith('task_1');

    api.get.mockResolvedValue({ task: makeTask(), events: 0 });
    await useTaskStore.getState().resume('task_1');
    expect(api.resume).toHaveBeenCalledWith('task_1');

    await useTaskStore.getState().cancel('task_1');
    expect(api.cancel).toHaveBeenCalledWith('task_1');
  });

  it('start 走 resume（新任务从检查点开跑）', async () => {
    api.get.mockResolvedValue({ task: makeTask({ status: 'running' }), events: 0 });
    await useTaskStore.getState().start('task_1');
    expect(api.resume).toHaveBeenCalledWith('task_1');
  });

  it('inject 透传文本', async () => {
    await useTaskStore.getState().inject('task_1', '第 3 段换实拍');
    expect(api.inject).toHaveBeenCalledWith('task_1', '第 3 段换实拍');
  });

  it('hydrateEvents 把历史事件折进状态', async () => {
    useTaskStore.setState({ task: makeTask() });
    api.events.mockResolvedValue({
      task_id: 'task_1', since_seq: 0, count: 2,
      items: [
        ev(1, 'step_start', { step_id: 's1', attempt: 1 }),
        ev(2, 'step_end', { step_id: 's1', status: 'done' }),
      ],
    });
    await useTaskStore.getState().hydrateEvents('task_1');
    expect(useTaskStore.getState().events).toHaveLength(2);
    expect(useTaskStore.getState().task!.plan!.steps[0].status).toBe('done');
  });
});

describe('terminalStatusOf', () => {
  it('正式跑完 = done', () => {
    expect(terminalStatusOf('tool_loop_completed')).toBe('done');
    expect(terminalStatusOf('plan_completed')).toBe('done');   // 兼容旧值
    expect(terminalStatusOf('task_completed')).toBe('done');
  });

  it('预览跑完 = done（不是失败）', () => {
    expect(terminalStatusOf('dry_run_preview')).toBe('done');
  });

  it('触闸 / 循环失败 / 无模型 = failed', () => {
    expect(terminalStatusOf('gate:工具调用数达到上限 60')).toBe('failed');
    expect(terminalStatusOf('tool_loop_error:model_final')).toBe('failed');
    expect(terminalStatusOf('tool_loop_unavailable:no_llm_credential')).toBe('failed');
    expect(terminalStatusOf('缺少可渲染时间线（final_timeline 为空）')).toBe('failed');
  });

  it('取消与暂停单独区分', () => {
    expect(terminalStatusOf('cancelled')).toBe('cancelled');
    expect(terminalStatusOf('paused')).toBe('paused');
  });

  it('空原因不冒充成功', () => {
    expect(terminalStatusOf('')).toBe('failed');
  });

  it('PRD B5：不认识的后端终态原因不再伪装成 failed', () => {
    expect(terminalStatusOf('some_future_reason')).toBe('unknown_terminal');
    expect(terminalStatusOf('budget_exhausted_v2')).toBe('unknown_terminal');
    // 异常类型名仍然算失败（Kernel 把 type(exc).__name__ 当 reason）
    expect(terminalStatusOf('TimeoutError')).toBe('failed');
    expect(terminalStatusOf('RuntimeError')).toBe('failed');
  });
});
