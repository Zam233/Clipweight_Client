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
  // B7：后端 note_degradation 会如实记录"参数被忽略"
  { seq: 13, type: 'degradation', ts: '', message: '已忽略 reasoning_effort',
    detail: { scope: 'reasoning_effort', detail: '模型 openai/m1 不支持 reasoning_effort，已忽略 high。', impact: '使用 provider 默认推理强度' } },
];

vi.mock('@/features/task/useTaskEvents', () => ({ useTaskEvents: () => undefined }));
// B7：用量区块需要 task 非空——用可变引用，默认 null 保持既有用例行为
const store = { task: null as Record<string, unknown> | null };
vi.mock('@/stores/taskStore', () => ({
  useTaskStore: (sel: (s: Record<string, unknown>) => unknown) => sel({
    task: store.task, events, runEvents: events, loading: false,
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
    store.task = null;
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

  it('B7：用量区块显示未知成本次数（不能当成 0）', () => {
    store.task = {
      status: 'running', finish: null,
      usage: { turns: 4, tool_calls: 6, tokens: 1234, cost_usd: 0, wall_sec: 12, unknown_cost_calls: 2 },
    };
    render(<CopilotTaskRunTab taskId="task_x" />);

    const usage = screen.getByTestId('usage-rows');
    expect(usage.textContent).toContain('1,234');
    expect(usage.textContent).toContain('—');           // 没有已知成本时显示占位而不是 $0
    const unknown = screen.getByTestId('unknown-cost');
    expect(unknown.textContent).toContain('未知成本 2 次');
    expect(unknown.textContent).toContain('不能当 0');
  });

  it('B7：降级与忽略单独成块（配置值≠生效值的证据）', () => {
    render(<CopilotTaskRunTab taskId="task_x" />);
    const rows = screen.getByTestId('degradation-rows');
    expect(rows.textContent).toContain('reasoning_effort');
    expect(rows.textContent).toContain('已忽略 high');
    expect(rows.textContent).toContain('使用 provider 默认推理强度');
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

describe('M1：预算剩余与终态摘要', () => {
  afterEach(cleanup);

  it('UsageRows 显示 已用/上限/剩余（四道闸）', () => {
    store.task = {
      id: 'task_x', status: 'running', plan: null, finish: null,
      limits: { max_turns: 30, max_tool_calls: 80, max_wall_sec: 3600, budget_usd: 1.0 },
      usage: { turns: 12, tool_calls: 41, tokens: 100, cost_usd: 0.32, wall_sec: 750,
        unknown_cost_calls: 0 },
      context_digest: [], created_at: '', updated_at: '',
    };
    render(<CopilotTaskRunTab taskId="task_x" />);
    const rows = screen.getByTestId('usage-rows');
    expect(rows.textContent).toContain('模型往返 12 / 30');
    expect(rows.textContent).toContain('剩余 18');
    expect(rows.textContent).toContain('工具调用 41 / 80');
    expect(rows.textContent).toContain('剩余 39');
    expect(rows.textContent).toContain('运行时长 12:30 / 1:00:00');
    expect(rows.textContent).toContain('/ $1.00');
  });

  it('没有金额上限时明说未设置', () => {
    store.task = {
      id: 'task_x', status: 'running', plan: null, finish: null,
      limits: { max_turns: 30, max_tool_calls: 80, max_wall_sec: 0, budget_usd: null },
      usage: { turns: 1, tool_calls: 1, tokens: 0, cost_usd: 0, wall_sec: 10,
        unknown_cost_calls: 0 },
      context_digest: [], created_at: '', updated_at: '',
    };
    render(<CopilotTaskRunTab taskId="task_x" />);
    const rows = screen.getByTestId('usage-rows');
    expect(rows.textContent).toContain('未设置金额上限');
    expect(rows.textContent).toContain('（无上限）');
  });

  it('终态用 TaskFinishSummary 解释 reason（不再只显示 conclusion）', () => {
    store.task = {
      id: 'task_x', status: 'failed', plan: null,
      finish: { conclusion: '触闸收尾', reason: 'gate:回合数达到上限 160',
        completed: [], unfinished: ['回合数达到上限 160'] },
      limits: { max_turns: 160, max_tool_calls: 800, max_wall_sec: 0, budget_usd: null },
      usage: { turns: 170, tool_calls: 163, tokens: 0, cost_usd: 0, wall_sec: 1200,
        unknown_cost_calls: 0 },
      context_digest: [], created_at: '', updated_at: '',
    };
    render(<CopilotTaskRunTab taskId="task_x" />);
    const box = screen.getByTestId('task-finish-summary');
    expect(box.textContent).toContain('达到运行限制：回合数达到上限 160');
    expect(box.textContent).toContain('回合数达到上限 160');
  });
});
describe('轨迹面板（专业视图）：不跟随单流开关', () => {
  beforeEach(() => {
    localStorage.clear();
    store.task = null;
    useCopilotStore.setState({ projectId: 'p1', tabs: [REQUIREMENTS_TAB], activeId: REQUIREMENTS_TAB.id });
    window.localStorage.setItem('cw.unifiedTimeline', '1');
  });
  afterEach(() => {
    window.localStorage.clear();
    cleanup();
  });

  it('即使单流开关开启，轨迹面板仍是分区详细视图（给排查用）', () => {
    render(<CopilotTaskRunTab taskId="task_x" />);
    expect(screen.getByTestId('task-trace-heading').textContent).toContain('轨迹');
    expect(screen.getByTestId('task-trace-stats').textContent).toContain('事件');
    // 分区聚合仍在（专业人士要看工具配对/阶段/降级明细）
    expect(screen.getByTestId('model-turn-rows')).toBeTruthy();
    expect(screen.getByTestId('tool-call-rows')).toBeTruthy();
    // 追问/重放与产物入口也在
    expect(screen.getByTestId('artifacts')).toBeTruthy();
  });
});
