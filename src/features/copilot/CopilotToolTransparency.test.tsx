// @vitest-environment jsdom
/**
 * M4：思考流与工具调用「全部可见」（PRD §19.3 / §19.4）。
 *
 * 验收点：
 * 1. 主 agent 工具 / 子 agent 工具 / Skill 三路合并到同一张卡片，不再 `slice(-8)`；
 * 2. 超过首屏窗口的调用不丢，用「加载更早的」翻页，且翻到底能看到第一行；
 * 3. 运行时补派 / 复用上次结果 / 剩余回合要标注出来（不能装成模型自己调的）；
 * 4. 思考增量累积：多帧 delta 拼成完整文本，事件重置时整体重建。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { mergeCallRows, CopilotTaskRunTab } from './CopilotTaskRunTab';
import { ThinkingDisclosure } from './ThinkingDisclosure';
import { useCopilotStore, REQUIREMENTS_TAB } from '@/stores/copilotStore';
import type { TaskEvent } from '@/types/task';

const store: { task: Record<string, unknown> | null; events: TaskEvent[] } = { task: null, events: [] };

vi.mock('@/features/task/useTaskEvents', () => ({ useTaskEvents: () => undefined }));
vi.mock('@/stores/taskStore', () => ({
  useTaskStore: (sel: (s: Record<string, unknown>) => unknown) => sel({
    task: store.task, events: store.events, runEvents: store.events, loading: false,
    pause: vi.fn(), resume: vi.fn(), cancel: vi.fn(), inject: vi.fn(),
  }),
}));
vi.mock('@/features/task/EventFeed', () => ({ EventFeed: () => <div data-testid="event-feed" /> }));
vi.mock('@/features/task/PlanPanel', () => ({ PlanPanel: () => <div data-testid="plan-panel" /> }));
vi.mock('@/features/task/TaskArtifacts', () => ({ TaskArtifacts: () => <div data-testid="artifacts" /> }));
vi.mock('@/features/task/TaskToolbar', () => ({ TaskToolbar: () => <div data-testid="toolbar" /> }));

/** 造 n 次主 agent 调用（call + result 成对） */
function mainCalls(n: number, startSeq = 100): TaskEvent[] {
  const out: TaskEvent[] = [];
  for (let i = 0; i < n; i += 1) {
    const seq = startSeq + i * 2;
    out.push({ seq, type: 'tool_call', ts: '', message: `tool_${i}`, detail: { tool: `tool_${i}`, args: {} } });
    out.push({
      seq: seq + 1, type: 'tool_result', ts: '', message: `tool_${i} → ok`,
      causation_id: `seq:${seq}`,
      detail: { tool: `tool_${i}`, status: 'ok', duration_ms: 10 + i },
    });
  }
  return out;
}

const subagentAndSkill: TaskEvent[] = [
  {
    seq: 500, type: 'subagent_tool', ts: '', message: 'material → search_material',
    detail: { tool: 'search_material', agent: 'material', stage: 'material', run_id: 'run_1',
      seq_in_run: 2, kind: 'tool', status: 'ok', duration_ms: 80 },
  },
  {
    seq: 501, type: 'subagent_tool', ts: '', message: 'material → storyboard_skill',
    detail: { tool: 'storyboard_skill', agent: 'material', stage: 'material', run_id: 'run_1',
      seq_in_run: 3, kind: 'skill', status: 'ok', duration_ms: 120 },
  },
  {
    seq: 502, type: 'tool_call', ts: '', message: 'local_probe',
    detail: { tool: 'local_probe', args: {}, source: 'kernel', remaining_turns: 7 },
  },
  {
    seq: 503, type: 'tool_result', ts: '', message: 'local_probe → ok', causation_id: 'seq:502',
    detail: { tool: 'local_probe', status: 'ok', duration_ms: 5, deduped: true },
  },
];

describe('mergeCallRows：三路合并', () => {
  it('主 agent 调用不截断，子 agent 与技能各成一行', () => {
    const events = [...mainCalls(20), ...subagentAndSkill];
    const rows = mergeCallRows(events);
    expect(rows.filter((r) => r.origin === 'main')).toHaveLength(21);   // 20 + local_probe
    expect(rows.filter((r) => r.origin === 'subagent')).toHaveLength(1);
    expect(rows.filter((r) => r.origin === 'skill')).toHaveLength(1);
    // 按 seq 升序（渲染时再倒序）
    expect(rows.map((r) => r.seq)).toEqual([...rows.map((r) => r.seq)].sort((a, b) => a - b));
    const sub = rows.find((r) => r.origin === 'subagent');
    expect(sub?.agent).toBe('material');
    expect(sub?.seq_in_run).toBe(2);
    expect(sub?.run_id).toBe('run_1');
  });

  it('运行时补派与去重标记随行带出（不是模型自己调的）', () => {
    const rows = mergeCallRows(subagentAndSkill);
    const probe = rows.find((r) => r.tool === 'local_probe');
    expect(probe?.source).toBe('kernel');
    expect(probe?.deduped).toBe(true);
    expect(probe?.remaining_turns).toBe(7);
  });
});

describe('CopilotTaskRunTab：工具调用全部可见', () => {
  beforeEach(() => {
    localStorage.clear();
    store.task = null;
    useCopilotStore.setState({ projectId: 'p1', tabs: [REQUIREMENTS_TAB], activeId: REQUIREMENTS_TAB.id });
  });
  afterEach(cleanup);

  it('子 agent 调用与技能调用都上屏，并标出 agent 与序号', () => {
    store.events = subagentAndSkill;
    render(<CopilotTaskRunTab taskId="task_x" />);
    const rows = screen.getByTestId('tool-call-rows');
    expect(rows.textContent).toContain('search_material');
    expect(rows.textContent).toContain('@material#2');
    expect(rows.textContent).toContain('storyboard_skill');
    expect(rows.textContent).toContain('运行时补派');
    expect(rows.textContent).toContain('复用上次结果');
    expect(rows.textContent).toContain('剩 7 回合');
    // 技能行单独标 origin
    expect(rows.querySelector('[data-origin="skill"]')).toBeTruthy();
  });

  it('筛选按钮按来源过滤（技能 / 子 agent / 主 agent）', () => {
    store.events = subagentAndSkill;
    render(<CopilotTaskRunTab taskId="task_x" />);
    const rows = () => screen.getByTestId('tool-call-rows');
    fireEvent.click(rows().querySelector('[data-origin-filter="skill"]') as HTMLElement);
    expect(rows().querySelectorAll('li')).toHaveLength(1);
    expect(rows().textContent).toContain('storyboard_skill');
    fireEvent.click(rows().querySelector('[data-origin-filter="subagent"]') as HTMLElement);
    expect(rows().textContent).toContain('search_material');
    expect(rows().textContent).not.toContain('storyboard_skill');
  });

  it('超过首屏窗口不截断：可逐段往回加载到第一条', () => {
    store.events = mainCalls(70);            // 70 次调用 > 首屏 60
    render(<CopilotTaskRunTab taskId="task_x" />);
    const rows = () => screen.getByTestId('tool-call-rows');
    expect(rows().textContent).toContain('工具调用（70 次）');
    expect(rows().querySelectorAll('li')).toHaveLength(60);
    const more = rows().querySelector('[data-testid="tool-calls-load-more"]') as HTMLElement;
    expect(more.textContent).toContain('还有 10 条');
    fireEvent.click(more);
    expect(rows().querySelectorAll('li')).toHaveLength(70);
    expect(rows().querySelector('[data-testid="tool-calls-load-more"]')).toBeNull();
    // 最早那次调用仍可达（不是被 slice 掉）
    expect(rows().textContent).toContain('tool_0');
  });

  it('渲染顺序最新在前（日志型界面不把人钉在顶上往下滚）', () => {
    store.events = mainCalls(3);
    render(<CopilotTaskRunTab taskId="task_x" />);
    const items = screen.getByTestId('tool-call-rows').querySelectorAll('li');
    expect(items[0].textContent).toContain('tool_2');
    expect(items[items.length - 1].textContent).toContain('tool_0');
  });
});

describe('ThinkingDisclosure：增量累积完整思考', () => {
  afterEach(cleanup);

  it('多帧 delta 拼成完整文本，不丢中间段', () => {
    const events: TaskEvent[] = [
      { seq: 1, type: 'thinking', ts: '', message: 'a', detail: { delta: '先看素材库，' } },
      { seq: 2, type: 'thinking', ts: '', message: 'b', detail: { delta: '再定剪辑点，' } },
      { seq: 3, type: 'thinking', ts: '', message: 'c', detail: { delta: '最后配音。' } },
    ];
    const { rerender } = render(<ThinkingDisclosure events={events.slice(0, 2)} />);
    rerender(<ThinkingDisclosure events={events} />);
    fireEvent.click(screen.getByRole('button'));
    const body = screen.getByTestId('thinking-body');
    expect(body.textContent).toBe('先看素材库，再定剪辑点，最后配音。');
    expect(screen.getByRole('button').textContent).toContain('思考了 3 段');
  });

  it('事件流重置（seq 回到开头）时整体重建，不残留上一轮思考', () => {
    const first: TaskEvent[] = [
      { seq: 1, type: 'thinking', ts: '', message: 'x', detail: { delta: '旧任务思考' } },
    ];
    const { rerender } = render(<ThinkingDisclosure events={first} />);
    const second: TaskEvent[] = [
      { seq: 1, type: 'thinking', ts: '', message: 'y', detail: { delta: '新任务思考' } },
    ];
    rerender(<ThinkingDisclosure events={second} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByTestId('thinking-body').textContent).toBe('新任务思考');
  });
});
