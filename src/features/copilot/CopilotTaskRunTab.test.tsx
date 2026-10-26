// @vitest-environment jsdom
/** 任务运行标签 + 思考折叠条（PRD §19.3/§19.4 / 需求 9、10）。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ThinkingDisclosure } from './ThinkingDisclosure';
import { CopilotTaskRunTab } from './CopilotTaskRunTab';
import { useCopilotStore, REQUIREMENTS_TAB } from '@/stores/copilotStore';
import type { TaskEvent } from '@/types/task';

const events: TaskEvent[] = [
  { seq: 1, type: 'task_start', ts: '', message: '开始', detail: {} },
  { seq: 2, type: 'intent', ts: '', message: '准备调用 material', detail: { text: '先找素材' } },
  { seq: 3, type: 'thinking', ts: '', message: '思考', detail: { delta: '我先看看素材库有什么', done: true } },
  { seq: 4, type: 'step_start', ts: '', message: '开始', detail: { stage: 'material' } },
  { seq: 5, type: 'step_end', ts: '', message: '结束', detail: { stage: 'material', status: 'ok', summary: '候选 0 条', cost_usd: 0.01 } },
];

vi.mock('@/features/task/useTaskEvents', () => ({ useTaskEvents: () => undefined }));
vi.mock('@/stores/taskStore', () => ({
  useTaskStore: (sel: (s: Record<string, unknown>) => unknown) => sel({
    task: null, events, loading: false,
    pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), inject: vi.fn(),
  }),
}));
vi.mock('@/features/task/EventFeed', () => ({ EventFeed: () => <div data-testid="event-feed" /> }));
vi.mock('@/features/task/PlanPanel', () => ({ PlanPanel: () => <div data-testid="plan-panel" /> }));
vi.mock('@/features/task/TaskArtifacts', () => ({ TaskArtifacts: () => <div data-testid="artifacts" /> }));
vi.mock('@/features/task/TaskToolbar', () => ({ TaskToolbar: () => <div data-testid="toolbar" /> }));
vi.mock('@/services/api', () => ({
  supervisorApi: { getSubagents: vi.fn().mockResolvedValue({ subagents: [] }) },
}));

describe('ThinkingDisclosure', () => {
  afterEach(cleanup);

  it('有 thinking 事件时可展开看到内容', () => {
    render(<ThinkingDisclosure events={events} />);
    const btn = screen.getByRole('button');
    expect(btn.textContent).toContain('思考了 1 段');
    fireEvent.click(btn);
    expect(screen.getByText('我先看看素材库有什么')).toBeTruthy();
  });

  it('没有 thinking 时明说"未提供"，不假装', () => {
    render(<ThinkingDisclosure events={[events[0]]} />);
    expect(screen.getByRole('button').textContent).toContain('未提供思考内容');
  });
});

describe('CopilotTaskRunTab', () => {
  beforeEach(() => {
    localStorage.clear();
    useCopilotStore.setState({ projectId: 'p1', tabs: [REQUIREMENTS_TAB], activeId: REQUIREMENTS_TAB.id });
  });
  afterEach(cleanup);

  it('渲染事件流、阶段行与工具栏（主 agent 活动不跳出编辑器）', () => {
    render(<CopilotTaskRunTab taskId="task_x" />);
    expect(screen.getByTestId('task-run-tab')).toBeTruthy();
    expect(screen.getByTestId('event-feed')).toBeTruthy();
    expect(screen.getByTestId('toolbar')).toBeTruthy();
    const stageRows = screen.getByTestId('stage-rows');
    expect(stageRows.textContent).toContain('material');
    expect(stageRows.textContent).toContain('候选 0 条');
  });

  it('没有 taskId 时给出引导而不是空白', () => {
    render(<CopilotTaskRunTab taskId="" />);
    expect(screen.getByText(/还没有运行中的任务/)).toBeTruthy();
  });
});
