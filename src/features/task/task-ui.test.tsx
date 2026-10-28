/**
 * C4：任务界面组件 + SSE 订阅 + 入口页。
 *
 * 覆盖三件会坏的事：
 * 1. 事件映射（`toTaskEvent` 只认 TaskEvent 形状，脏数据丢弃）；
 * 2. 计划面板的**诚实文案**（未配置单价 ≠ $0；只有点「按计划执行」才花钱）；
 * 3. 收尾三件套与插话/暂停控件真的能点。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';

const { stream } = vi.hoisted(() => ({
  stream: {
    onMessage: null as null | ((data: unknown) => void),
    close: vi.fn(),
  },
}));

vi.mock('@/services/api/sseStream', () => ({
  connectSseStream: vi.fn((opts: { onMessage: (d: unknown) => void }) => {
    stream.onMessage = opts.onMessage;
    return { close: stream.close, reconnect: vi.fn() };
  }),
}));

vi.mock('@/services/api/task', () => ({
  taskApi: {
    eventsStreamUrl: (id: string) => `http://x/api/task/${id}/events/stream`,
    list: vi.fn(async () => ({ count: 0, items: [] })),
    create: vi.fn(),
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ taskId: 'task_1' }),
}));

import { connectSseStream } from '@/services/api/sseStream';
import { useTaskStore } from '@/stores/taskStore';
import { toTaskEvent, useTaskEvents } from '@/features/task/useTaskEvents';
import { PlanPanel } from '@/features/task/PlanPanel';
import { TaskToolbar } from '@/features/task/TaskToolbar';
import { EventFeed } from '@/features/task/EventFeed';
import { moneyText } from '@/features/task/labels';
import type { Task } from '@/types/task';

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'task_1',
    status: 'pending',
    mode: 'on',
    request: {
      topic: '县域经济', persona_id: '', category_plugin_id: '',
      duration_sec: 60, plan_only: true, extra: {},
    },
    plan: {
      steps: [
        {
          id: 's1', title: '探测素材', capability: 'media_probe', kind: 'tool', args: {},
          why: '先确认素材可用', est_cost_usd: 0.02, status: 'pending', attempt: 0,
          result_brief: '', error: null, duration_ms: 0,
        },
        {
          id: 's2', title: '整片生成', capability: 'run_pipeline', kind: 'pipeline',
          args: {}, why: '常规套路走流水线', est_cost_usd: null, status: 'pending',
          attempt: 0, result_brief: '', error: null, duration_ms: 0,
        },
      ],
      version: 1, rationale: '两条腿走路', est_total_cost_usd: null,
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

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  stream.onMessage = null;
  useTaskStore.getState().reset();
});

describe('toTaskEvent', () => {
  it('认 TaskEvent 形状', () => {
    const ev = toTaskEvent({ seq: 3, type: 'step_end', message: 'm', detail: { a: 1 } });
    expect(ev).toEqual({ seq: 3, type: 'step_end', ts: '', message: 'm', detail: { a: 1 } });
  });

  it('脏数据返回 null', () => {
    expect(toTaskEvent(null)).toBeNull();
    expect(toTaskEvent({ type: 'x' })).toBeNull();
    expect(toTaskEvent({ seq: '3', type: 'x' })).toBeNull();
  });
});

describe('useTaskEvents', () => {
  it('订阅 task 事件流并喂给 store（老计划 hypothesis_only=false 时仍折叠步骤状态）', () => {
    const task = makeTask();
    task.plan!.hypothesis_only = false; // PRD B6：只有"非假设"的老计划才追踪步骤进度
    useTaskStore.setState({ task });
    renderHook(() => useTaskEvents('task_1', true));
    expect(connectSseStream).toHaveBeenCalledTimes(1);
    stream.onMessage?.({ seq: 1, type: 'step_start', detail: { step_id: 's1', attempt: 1 } });
    expect(useTaskStore.getState().events).toHaveLength(1);
    expect(useTaskStore.getState().task!.plan!.steps[0].status).toBe('running');
  });

  it('PRD B6：假设态 Plan 不因进度事件改动（事件仍入 store）', () => {
    const task = makeTask();
    task.plan!.hypothesis_only = true;
    useTaskStore.setState({ task });
    renderHook(() => useTaskEvents('task_1', true));

    stream.onMessage?.({ seq: 1, type: 'step_start', detail: { step_id: 's1', attempt: 1 } });
    stream.onMessage?.({ seq: 2, type: 'step_end', detail: { step_id: 's1', status: 'done' } });

    const st = useTaskStore.getState();
    expect(st.events).toHaveLength(2);                       // 事件照收（真实进展要看事件）
    expect(st.task!.plan!.steps[0].status).toBe('pending');  // 假设不被进度污染
  });

  it('enabled=false 或空 id 不订阅', () => {
    renderHook(() => useTaskEvents(null, true));
    renderHook(() => useTaskEvents('task_1', false));
    expect(connectSseStream).not.toHaveBeenCalled();
  });
});

describe('PlanPanel', () => {
  it('未配置单价时明说只能统计 token（不许假装 $0）', () => {
    render(<PlanPanel task={makeTask()} />);
    // B10：假设态下成本是「假设成本」（不是已发生的花费）
    expect(screen.getByText(/假设成本/)).toBeTruthy();
    expect(moneyText(null)).toBe('未配置单价');
  });

  it('全部步骤无估价时提示未配置单价', () => {
    const task = makeTask();
    task.plan!.steps[0].est_cost_usd = null;
    render(<PlanPanel task={task} />);
    expect(screen.getByText(/未配置模型单价/)).toBeTruthy();
  });

  it('B10：默认按「初始假设」展示，不把 Plan 当执行进度', () => {
    const task = makeTask();
    task.plan!.hypothesis_only = true;
    render(<PlanPanel task={task} />);

    expect(screen.getByText(/初始假设/)).toBeTruthy();
    expect(screen.getByText(/仅供参考，不是执行进度/)).toBeTruthy();
    expect(screen.getByTestId('plan-hypothesis-note').textContent).toContain('可能不按这里走');
    // pending 步骤标「设想」而不是进度状态
    expect(screen.getAllByText('设想').length).toBe(2);
    expect(screen.getByLabelText('初始假设').getAttribute('data-hypothesis')).toBe('true');
  });

  it('B10：老计划（hypothesis_only=false）保留「按计划执行」语义', () => {
    const task = makeTask();
    task.plan!.hypothesis_only = false;
    const onStart = vi.fn();
    render(<PlanPanel task={task} onStart={onStart} />);

    expect(screen.getByText(/^计划（/)).toBeTruthy();
    expect(screen.queryByTestId('plan-hypothesis-note')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /按计划执行/ }));
    expect(onStart).toHaveBeenCalled();
  });

  it('假设态下开始按钮说明"按现场推进"；已开始后禁用', () => {
    const onStart = vi.fn();
    render(<PlanPanel task={makeTask({ plan: { ...makeTask().plan!, hypothesis_only: true } })}
      onStart={onStart} />);
    fireEvent.click(screen.getByRole('button', { name: /开始（按现场推进）/ }));
    expect(onStart).toHaveBeenCalled();

    cleanup();
    render(<PlanPanel task={makeTask({ status: 'running' })} onStart={vi.fn()} />);
    const btn = screen.getByRole('button', { name: /已开始/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('失败步骤显示错误文案', () => {
    const task = makeTask();
    task.plan!.steps[0].status = 'failed';
    task.plan!.steps[0].error = 'ffmpeg 失败';
    render(<PlanPanel task={task} />);
    expect(screen.getByText(/ffmpeg 失败/)).toBeTruthy();
  });
});

describe('TaskToolbar', () => {
  it('PRD B11：状态→动作映射唯一（终态没有「继续」，paused 有）', () => {
    const { rerender } = render(<TaskToolbar status="paused" onResume={vi.fn()} />);
    expect(screen.getByRole('button', { name: /继续/ })).toBeTruthy();

    for (const st of ['done', 'failed', 'cancelled', 'unknown_terminal'] as const) {
      rerender(<TaskToolbar status={st} onResume={vi.fn()} onViewResult={vi.fn()} />);
      expect(screen.queryByRole('button', { name: /继续|开始/ }), st).toBeNull();
      expect(screen.getByRole('button', { name: /查看结果/ }), st).toBeTruthy();
    }
  });

  it('PRD B11：unknown_terminal 明确说「后端终态」而不是冒充失败', () => {
    render(<TaskToolbar status="unknown_terminal" onViewResult={vi.fn()} />);
    expect(screen.getByTestId('task-toolbar').getAttribute('data-status')).toBe('unknown_terminal');
    expect(screen.getByTestId('task-status-hint').textContent).toContain('不认识的终态原因');
    expect(screen.getByText('后端终态（待适配）')).toBeTruthy();
  });

  it('运行中显示暂停与取消，插话走回调', () => {
    const onPause = vi.fn();
    const onInject = vi.fn();
    render(<TaskToolbar status="running" onPause={onPause} onInject={onInject} />);
    fireEvent.click(screen.getByRole('button', { name: /暂停/ }));
    expect(onPause).toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText('人工插话'), { target: { value: '换实拍' } });
    fireEvent.click(screen.getByRole('button', { name: /插话/ }));
    expect(onInject).toHaveBeenCalledWith('换实拍');
  });

  it('结束态不再显示插话框', () => {
    render(<TaskToolbar status="done" />);
    expect(screen.queryByLabelText('人工插话')).toBeNull();
  });
});

describe('EventFeed', () => {
  it('渲染调用记录；checkpoint 行保留但内容默认折叠（PRD B5）', () => {
    render(
      <EventFeed
        events={[
          { seq: 1, type: 'checkpoint', ts: '', message: '检查点已保存', detail: {} },
          { seq: 2, type: 'tool_call', ts: '', message: 'media_probe', detail: {} },
          { seq: 3, type: 'tool_result', ts: '', message: 'media_probe → ok', detail: {} },
        ]}
      />,
    );
    expect(screen.getByText('调用能力')).toBeTruthy();
    expect(screen.getByText('调用结果')).toBeTruthy();
    // 内容默认折叠（不刷屏），但行还在、可点开看到
    expect(screen.queryByText('检查点已保存')).toBeNull();
    expect(document.querySelector('[data-event-type="checkpoint"]')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /详情/ }));
    expect(screen.getByText('检查点已保存')).toBeTruthy();
  });

  it('空态给明确说明', () => {
    render(<EventFeed events={[]} />);
    expect(screen.getByText(/还没有执行记录/)).toBeTruthy();
  });
});
