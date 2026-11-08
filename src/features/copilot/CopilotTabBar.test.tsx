// @vitest-environment jsdom
/**
 * 副驾驶标签栏（PRD §19.2 / 需求 8；2026-10-31 用户定稿）。
 *
 * 固定标签只有两个且都不可关闭：需求对话（第一个）、轨迹（紧随其右）。
 * 「执行日志」标签已撤删；轨迹不再出现在「+」菜单里（它已经是固定标签）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CopilotTabBar } from './CopilotTabBar';
import { FIXED_TABS, REQUIREMENTS_TAB, TRACE_TAB, useCopilotStore } from '@/stores/copilotStore';

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

  it('轨迹紧挨需求对话（第二个标签），没有关闭按钮', () => {
    render(<CopilotTabBar />);
    const tabs = screen.getAllByRole('tab');
    expect(tabs[0].getAttribute('data-tab-id')).toBe(REQUIREMENTS_TAB.id);
    expect(tabs[1].getAttribute('data-tab-id')).toBe(TRACE_TAB.id);
    expect(tabs[1].textContent).toContain('轨迹');
    expect(tabs[1].getAttribute('data-closable')).toBe('false');
    expect(tabs[1].querySelector('[data-close-for]')).toBeNull();
    // 执行日志已撤删
    expect(screen.queryByText('执行日志')).toBeNull();
  });

  it('标签总数 = 固定标签 + 动态标签，且只有一排', () => {
    useCopilotStore.getState().openTab({
      id: 'workspace', kind: 'workspace', title: '工作区', closable: true,
    });
    render(<CopilotTabBar />);
    expect(screen.getAllByRole('tab')).toHaveLength(FIXED_TABS.length + 1);
    expect(screen.getAllByText('需求对话')).toHaveLength(1);
    expect(screen.getAllByText('轨迹')).toHaveLength(1);
  });

  it('新增的标签有关闭按钮，点击后可关闭并回到需求对话', () => {
    useCopilotStore.getState().openTab({
      id: 'workspace', kind: 'workspace', title: '工作区', closable: true,
    });
    render(<CopilotTabBar />);

    const closeBtn = screen.getByLabelText('关闭 工作区');
    fireEvent.click(closeBtn);

    const state = useCopilotStore.getState();
    expect(state.tabs.some((t) => t.id === 'workspace')).toBe(false);
    expect(state.activeId).toBe('requirements');
  });

  it('「+」菜单里不再提供轨迹（已是固定标签），但仍可开工作区', () => {
    render(<CopilotTabBar />);
    fireEvent.click(screen.getByLabelText('新增标签'));
    expect(screen.queryByRole('button', { name: '轨迹' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '工作区' }));
    expect(useCopilotStore.getState().tabs.some((t) => t.kind === 'workspace')).toBe(true);
  });

  it('点轨迹标签把 activeId 切到 trace（与需求对话同级）', () => {
    render(<CopilotTabBar />);
    fireEvent.click(screen.getByRole('tab', { name: /轨迹/ }));
    expect(useCopilotStore.getState().activeId).toBe(TRACE_TAB.id);
  });
});
