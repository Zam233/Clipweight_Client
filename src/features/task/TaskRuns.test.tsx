/**
 * 子会话列表（PRD modern-agent-review M2）。
 *
 * 锁四件事：列出每个阶段 run 的关键事实（状态/降级/工具数）、追问要发到该 run、
 * 重放走 replay 接口并刷新列表、任务结束后按钮不可用（run 已不在内存里）。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: { runs: vi.fn(), runMessage: vi.fn(), runReplay: vi.fn() },
}));
vi.mock('@/services/api', () => ({ taskApi: api }));

import { TaskRuns } from './TaskRuns';

const RUNS = {
  task_id: 'task_1',
  count: 2,
  items: [
    { run_id: 'run_a', kind: 'stage', stage: 'animation', role: '', status: 'degraded',
      attempt: 2, duration_ms: 1200, cost_usd: null, degradations: 1, tool_calls: 7,
      tool_calls_path: 'reports/tool_calls/animation-2.json', report_path: '', 
      summary: '动画已编排（弱动效）', replayed: false },
    { run_id: 'run_b', kind: 'stage', stage: 'audio', role: '', status: 'ok',
      attempt: 1, duration_ms: 800, cost_usd: 0.01, degradations: 0, tool_calls: 3,
      tool_calls_path: '', report_path: 'reports/10-audio-1.md',
      summary: '音频完成', replayed: false },
  ],
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.runs.mockResolvedValue(RUNS);
});

describe('TaskRuns', () => {
  it('列出每次派发的状态/降级/工具数', async () => {
    render(<TaskRuns taskId="task_1" active />);
    const box = await screen.findByTestId('task-runs');
    expect(box.textContent).toContain('animation');
    expect(box.textContent).toContain('降级 1');
    expect(box.textContent).toContain('工具 7');
    expect(document.querySelector('[data-run-id="run_b"]')?.textContent).toContain('audio');
  });

  it('追问把文字发到对应 run，并提示排队条数', async () => {
    api.runMessage.mockResolvedValue({ stage: 'animation', pending: 1 });
    render(<TaskRuns taskId="task_1" active />);
    await screen.findByTestId('task-runs');

    fireEvent.change(document.querySelector('[data-run-message="run_a"]')!, {
      target: { value: '文字改大一点' },
    });
    fireEvent.click(document.querySelector('[data-run-send="run_a"]')!);

    await waitFor(() =>
      expect(api.runMessage).toHaveBeenCalledWith('task_1', 'run_a', '文字改大一点'));
    expect((await screen.findByTestId('task-runs-note')).textContent).toContain('已排队 1 条');
  });

  it('重放调用 replay 接口并刷新列表', async () => {
    api.runReplay.mockResolvedValue({ stage: 'animation', status: 'ok', replayed: false });
    render(<TaskRuns taskId="task_1" active />);
    await screen.findByTestId('task-runs');
    fireEvent.click(document.querySelector('[data-run-replay="run_a"]')!);

    await waitFor(() => expect(api.runReplay).toHaveBeenCalledWith('task_1', 'run_a'));
    await waitFor(() => expect(api.runs).toHaveBeenCalledTimes(2));
    expect((await screen.findByTestId('task-runs-note')).textContent).toContain('已重跑');
  });

  it('任务结束后追问/重放不可点', async () => {
    render(<TaskRuns taskId="task_1" active={false} />);
    await screen.findByTestId('task-runs');
    const send = document.querySelector('[data-run-send="run_a"]') as HTMLButtonElement;
    const replay = document.querySelector('[data-run-replay="run_a"]') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    expect(replay.disabled).toBe(true);
  });

  it('没有 run 时不渲染', async () => {
    api.runs.mockResolvedValue({ task_id: 'task_1', count: 0, items: [] });
    const { container } = render(<TaskRuns taskId="task_1" active />);
    await waitFor(() => expect(api.runs).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="task-runs"]')).toBeNull();
  });
});
