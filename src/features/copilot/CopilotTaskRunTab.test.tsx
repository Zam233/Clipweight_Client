// @vitest-environment jsdom
/** 任务运行标签 + 思考折叠条 + B9 的三张卡片（PRD §19.3/§19.4 / closeout B9）。 */
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
  { seq: 5, type: 'step_end', ts: '', message: '结束', detail: { stage: 'material', status: 'ok', summary: '候选 20 条', cost_usd: 0.01 } },
  // B9：统一 AgentRun 事件（子 agent 筹码的数据源从轮询改成这些事件）
  { seq: 6, type: 'agent_run_start', ts: '', message: '派出 stage/material', detail: { run_id: 'run_1', kind: 'stage', stage: 'material' } },
  { seq: 7, type: 'agent_run_update', ts: '', message: '等待人工审核', detail: { run_id: 'run_1', status: 'needs_review', risk: 'high' } },
  // B2：主 agent 动手前的叙述（narration + detail.kind=preamble）先于 tool_call 到达
  { seq: 7.5, type: 'narration', ts: '', message: '我先派 material 找素材，因为时间线要靠它',
    detail: { kind: 'preamble', round: 1, before_tool: ['delegate_agent'], tool_count: 1 } },
  // 工具调用与结果要能配对（状态 + 耗时 + 错误）
  { seq: 8, type: 'tool_call', ts: '', message: 'delegate_agent', detail: { tool: 'delegate_agent', args: {} } },
  { seq: 9, type: 'tool_result', ts: '', message: 'delegate_agent → ok', detail: { tool: 'delegate_agent', status: 'ok', duration_ms: 120, brief: '候选 20 条' } },
  { seq: 10, type: 'tool_call', ts: '', message: 'frame_check', detail: { tool: 'frame_check', args: {} } },
  { seq: 11, type: 'tool_result', ts: '', message: 'frame_check → error', detail: { tool: 'frame_check', status: 'error', error: '缺输入' } },
  // 等授权不是失败，必须单独可见
  { seq: 12, type: 'approval_request', ts: '', message: '工具 run_shell 等待授权', detail: { risk: 'high', approval_id: 'ap_1' } },
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
    expect(stageRows.textContent).toContain('候选 20 条');
  });

  it('没有 taskId 时给出引导而不是空白', () => {
    render(<CopilotTaskRunTab taskId="" />);
    expect(screen.getByText(/还没有运行中的任务/)).toBeTruthy();
  });

  it('模型轮次卡片显示 intent / thinking', () => {
    render(<CopilotTaskRunTab taskId="task_x" />);
    const rows = screen.getByTestId('model-turn-rows');
    expect(rows.textContent).toContain('准备调用 material');
  });

  it('B2：动手前的叙述标成「动手前」，并排在对应工具调用之前', () => {
    render(<CopilotTaskRunTab taskId="task_x" />);
    const rows = screen.getByTestId('model-turn-rows');
    expect(rows.textContent).toContain('我先派 material 找素材');
    const preamble = rows.querySelector('[data-preamble="true"]');
    expect(preamble).toBeTruthy();
    expect(preamble?.textContent).toContain('动手前');
    // 工具调用卡片在模型轮次之后（DOM 顺序 = 先说要做什么，再看到调用）
    const toolRows = screen.getByTestId('tool-call-rows');
    expect(rows.compareDocumentPosition(toolRows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('B6：真实进展区独立成块，并声明 Plan 只是初始假设', () => {
    render(<CopilotTaskRunTab taskId="task_x" />);
    const heading = screen.getByTestId('real-progress-heading');
    expect(heading.textContent).toContain('真实进展（来自事件）');
    expect(heading.textContent).toContain('初始假设');
    // 阶段行属于真实进展区（在标题之后）
    const stageRows = screen.getByTestId('stage-rows');
    expect(heading.compareDocumentPosition(stageRows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('工具调用卡片把 call 与 result 配对（状态 + 耗时 + 错误）', () => {
    render(<CopilotTaskRunTab taskId="task_x" />);
    const rows = screen.getByTestId('tool-call-rows');
    expect(rows.textContent).toContain('delegate_agent');
    expect(rows.textContent).toContain('120ms');
    expect(rows.textContent).toContain('缺输入');
  });

  it('授权卡片把"待授权"单独显示（不是失败）', () => {
    render(<CopilotTaskRunTab taskId="task_x" />);
    const rows = screen.getByTestId('approval-rows');
    expect(rows.textContent).toContain('待授权');
    expect(rows.textContent).toContain('risk=high');
  });

  it('底部子 agent 筹码来自事件而不是轮询', () => {
    render(<CopilotTaskRunTab taskId="task_x" />);
    const chips = screen.getByTestId('running-subagents');
    expect(chips.textContent).toContain('material');
    // needs_review 属于"需要关注"，活动任务下也要显示
    expect(chips.textContent).toContain('needs_review');
  });
});
