// @vitest-environment jsdom
/**
 * B11（2026-10-28 PRD / 缺口 N3、N4、N9）：
 * - 授权请求必须有**提交入口**（旧实现只有一行日志，任务永远卡在 paused）；
 * - 子 agent 详情消费 `agent_run_*` 事件（不再只查 tracker 快照）；
 * - 筹码不把 `replayed` 当状态，并显示 failure/needs。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { CopilotTaskRunTab } from './CopilotTaskRunTab';
import { CopilotSubagentTab, foldRunDetail } from './CopilotSubagentTab';
import { chipStatusText, foldRunChips } from './RunningSubagents';
import { useCopilotStore, REQUIREMENTS_TAB } from '@/stores/copilotStore';
import type { TaskEvent } from '@/types/task';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    approveExec: vi.fn(),
    rejectExec: vi.fn(),
    getSubagents: vi.fn(),
    events: [] as TaskEvent[],
  },
}));

vi.mock('@/services/api', () => ({
  supervisorApi: {
    approveExec: mocks.approveExec,
    rejectExec: mocks.rejectExec,
    getSubagents: mocks.getSubagents,
  },
}));
vi.mock('@/features/task/useTaskEvents', () => ({ useTaskEvents: () => undefined }));
vi.mock('@/stores/taskStore', () => ({
  useTaskStore: (sel: (s: Record<string, unknown>) => unknown) => sel({
    task: null, events: mocks.events, loading: false,
    pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), inject: vi.fn(),
  }),
}));
vi.mock('@/features/task/EventFeed', () => ({ EventFeed: () => <div data-testid="event-feed" /> }));
vi.mock('@/features/task/PlanPanel', () => ({ PlanPanel: () => <div data-testid="plan-panel" /> }));
vi.mock('@/features/task/TaskArtifacts', () => ({ TaskArtifacts: () => <div data-testid="artifacts" /> }));
vi.mock('@/features/task/TaskToolbar', () => ({ Toolbar: () => <div />, TaskToolbar: () => <div data-testid="toolbar" /> }));

const APPROVAL_EVENTS: TaskEvent[] = [
  { seq: 1, type: 'approval_request', ts: '', message: '工具 run_shell 等待授权',
    detail: { risk: 'high', approval_id: 'ap_1', tool: 'run_shell' } },
];

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mocks.events = APPROVAL_EVENTS;
  mocks.approveExec.mockResolvedValue(undefined);
  mocks.rejectExec.mockResolvedValue(undefined);
  useCopilotStore.setState({ projectId: 'p1', tabs: [REQUIREMENTS_TAB], activeId: REQUIREMENTS_TAB.id });
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(cleanup);

describe('B11 / N4：授权提交入口', () => {
  it('待授权行有「授权 / 拒绝」两个按钮', () => {
    render(<CopilotTaskRunTab taskId="task_x" />);
    expect(screen.getByTestId('approval-rows').textContent).toContain('待授权');
    expect(screen.getByRole('button', { name: '授权' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '拒绝' })).toBeTruthy();
  });

  it('点授权 → approveExec(高风险两次确认) 并回显已授权', async () => {
    render(<CopilotTaskRunTab taskId="task_x" />);
    fireEvent.click(screen.getByRole('button', { name: '授权' }));

    await waitFor(() => expect(mocks.approveExec).toHaveBeenCalledWith(
      'task_x', 'ap_1', true, false,
    ));
    expect(window.confirm).toHaveBeenCalled();
    expect(await screen.findByText('已授权')).toBeTruthy();
  });

  it('点拒绝 → rejectExec 并回显已拒绝', async () => {
    render(<CopilotTaskRunTab taskId="task_x" />);
    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    await waitFor(() => expect(mocks.rejectExec).toHaveBeenCalledWith('task_x', 'ap_1'));
    expect(await screen.findByText('已拒绝')).toBeTruthy();
  });

  it('提交失败如实回显，不假装已授权', async () => {
    mocks.approveExec.mockRejectedValue(new Error('后端离线'));
    render(<CopilotTaskRunTab taskId="task_x" />);
    fireEvent.click(screen.getByRole('button', { name: '授权' }));

    expect(await screen.findByText(/提交失败：后端离线/)).toBeTruthy();
    expect(screen.queryByText('已授权')).toBeNull();
  });

  it('高风险二次确认被用户取消 → 不发请求', async () => {
    (window.confirm as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    render(<CopilotTaskRunTab taskId="task_x" />);
    fireEvent.click(screen.getByRole('button', { name: '授权' }));
    await waitFor(() => expect(window.confirm).toHaveBeenCalled());
    expect(mocks.approveExec).not.toHaveBeenCalled();
  });
});

describe('B11 / N3：子 agent 详情消费 agent_run_*', () => {
  it('foldRunDetail 折叠 start/update/end（保留标签、失败与 needs）', () => {
    const detail = foldRunDetail([
      { seq: 1, type: 'agent_run_start', ts: '', message: '', detail: { run_id: 'r1', stage: 'edit' } },
      { seq: 2, type: 'agent_run_update', ts: '', message: '', detail: { run_id: 'r1', status: 'needs', needs: [{ field: 'timeline' }] } },
      { seq: 3, type: 'agent_run_end', ts: '', message: '', detail: { run_id: 'r1', status: 'failed', summary: '缺时间线', cost_usd: 0.02, duration_ms: 900, failure: { blocking_point: 'timeline 为空', retryable: 'needs_upstream' } } },
    ], 'r1');
    expect(detail).not.toBeNull();
    expect(detail!.label).toBe('edit');
    expect(detail!.status).toBe('failed');
    expect(detail!.summary).toBe('缺时间线');
    expect(detail!.needs[0].field).toBe('timeline');
    expect(detail!.failure?.blocking_point).toBe('timeline 为空');
    expect(detail!.cost).toBe(0.02);
  });

  it('有事件时不打 tracker，直接渲染状态/结论/报告/失败', () => {
    mocks.events = [
      { seq: 1, type: 'agent_run_start', ts: '', message: '', detail: { run_id: 'r1', stage: 'quality' } },
      { seq: 2, type: 'agent_run_end', ts: '', message: '', detail: {
        run_id: 'r1', status: 'failed', summary: '质检没过', report_path: 'reports/01-quality.md',
        failure: { blocking_point: '黑帧 3 处', retryable: 'retry_same' },
        needs: [{ field: 'final_timeline', from_stage: 'audio' }],
      } },
    ];
    render(<CopilotSubagentTab taskId="task_x" subagentId="r1" />);

    const tab = screen.getByTestId('subagent-tab');
    expect(tab.getAttribute('data-source')).toBe('events');
    expect(tab.textContent).toContain('quality');
    expect(tab.textContent).toContain('failed');
    expect(tab.textContent).toContain('质检没过');
    expect(tab.textContent).toContain('reports/01-quality.md');
    expect(screen.getByTestId('subagent-failure').textContent).toContain('黑帧 3 处');
    expect(screen.getByTestId('subagent-needs').textContent).toContain('final_timeline');
    expect(mocks.getSubagents).not.toHaveBeenCalled();
  });

  it('没有事件才回落到 supervisor 快照，并明说来源', async () => {
    mocks.events = [];
    mocks.getSubagents.mockResolvedValue({ tree: [{ id: 'old_1', role: '旧角色', status: 'done', cost_usd: 0.1 }] });
    render(<CopilotSubagentTab taskId="task_x" subagentId="old_1" />);

    const tab = await screen.findByTestId('subagent-tab');
    expect(tab.getAttribute('data-source')).toBe('snapshot');
    expect(tab.textContent).toContain('旧角色');
    expect(tab.textContent).toContain('数据来自 supervisor 快照');
  });
});

describe('B11 / N9：筹码状态不把 replayed 当状态', () => {
  it('replayed 只是标记，不覆盖真实状态', () => {
    const chips = foldRunChips([
      { type: 'agent_run_start', detail: { run_id: 'r1', stage: 'edit' } },
      { type: 'agent_run_update', detail: { run_id: 'r1', status: 'running', replayed: true } },
    ]);
    expect(chips[0].status).toBe('running');
    expect(chips[0].replayed).toBe(true);
    expect(chipStatusText(chips[0])).toBe('running·回放');
  });

  it('needs 状态带"缺输入"提示，失败筹码带 failure', () => {
    const chips = foldRunChips([
      { type: 'agent_run_start', detail: { run_id: 'r1', stage: 'audio' } },
      { type: 'agent_run_update', detail: { run_id: 'r1', status: 'needs', needs: [{ field: 'script' }] } },
      { type: 'agent_run_start', detail: { run_id: 'r2', stage: 'edit' } },
      { type: 'agent_run_end', detail: { run_id: 'r2', status: 'failed', failure: { blocking_point: '缺 ffmpeg' } } },
    ]);
    expect(chipStatusText(chips[0])).toBe('needs（缺输入）');
    expect(chips[0].needs).toEqual(['script']);
    expect(chips[1].failure).toBe('缺 ffmpeg');
  });
});
