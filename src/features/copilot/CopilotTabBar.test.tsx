// @vitest-environment jsdom
/** 副驾驶标签栏（PRD §19.2 / 需求 8；B1 单层标签）：需求对话与执行日志都没有关闭按钮。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CopilotTabBar } from './CopilotTabBar';
import { FIXED_TABS, LOGS_TAB, REQUIREMENTS_TAB, useCopilotStore } from '@/stores/copilotStore';

vi.mock('@/features/agent/AgentPanel', () => ({
  AgentPanel: () => <div data-testid="fake-agent-panel">agent</div>,
  RequirementsPane: () => <div data-testid="fake-agent-panel">agent</div>,
  LogPanel: () => <div data-testid="fake-log-panel">logs</div>,
}));
vi.mock('@/features/workspace/WorkspaceMaterialsPanel', () => ({
  WorkspaceMaterialsPanel: () => <div data-testid="fake-workspace-panel">ws</div>,
}));

describe('CopilotTabBar', () => {
  beforeEach(() => {
    localStorage.clear();
    useCopilotStore.setState({
      projectId: 'p1',
      tabs: [...FIXED_TABS],
      activeId: REQUIREMENTS_TAB.id,
    });
  });
  afterEach(cleanup);

  it('需求对话没有关闭按钮', () => {
    render(<CopilotTabBar />);
    const tab = screen.getByRole('tab', { name: /需求对话/ });
    expect(tab).toBeTruthy();
    expect(tab.getAttribute('data-closable')).toBe('false');
    expect(tab.querySelector('[data-close-for]')).toBeNull();
  });

  it('B1：执行日志是同级标签，没有关闭按钮', () => {
    render(<CopilotTabBar />);
    const logs = screen.getByRole('tab', { name: /执行日志/ });
    expect(logs).toBeTruthy();
    expect(logs.getAttribute('data-closable')).toBe('false');
    expect(logs.querySelector('[data-close-for]')).toBeNull();
  });

  it('B1：标签总数 = 固定标签 + 动态标签，且只有一排（执行日志不重复出现）', () => {
    useCopilotStore.getState().openTab({
      id: 'task-run:current', kind: 'task-run', title: '任务运行', closable: true,
    });
    render(<CopilotTabBar />);
    expect(screen.getAllByRole('tab')).toHaveLength(FIXED_TABS.length + 1);
    expect(screen.getAllByText('执行日志')).toHaveLength(1);
    expect(screen.getAllByText('需求对话')).toHaveLength(1);
  });

  it('新增的标签有关闭按钮，点击后可关闭并回到需求对话', () => {
    useCopilotStore.getState().openTab({
      id: 'task-run:current', kind: 'task-run', title: '任务运行', closable: true,
    });
    render(<CopilotTabBar />);

    const closeBtn = screen.getByLabelText('关闭 任务运行');
    fireEvent.click(closeBtn);

    const state = useCopilotStore.getState();
    expect(state.tabs.some((t) => t.id === 'task-run:current')).toBe(false);
    expect(state.activeId).toBe('requirements');
  });

  it('+ 菜单可以新增任务运行标签', () => {
    render(<CopilotTabBar />);
    fireEvent.click(screen.getByLabelText('新增标签'));
    fireEvent.click(screen.getByText('任务运行'));

    expect(useCopilotStore.getState().tabs.some((t) => t.kind === 'task-run')).toBe(true);
  });

  it('B1：点 logs 标签把 activeId 切到 logs（与需求对话同级）', () => {
    render(<CopilotTabBar />);
    fireEvent.click(screen.getByRole('tab', { name: /执行日志/ }));
    expect(useCopilotStore.getState().activeId).toBe(LOGS_TAB.id);
  });
});
