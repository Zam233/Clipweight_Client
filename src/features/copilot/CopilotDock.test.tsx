// @vitest-environment jsdom
/**
 * 副驾驶只有一排标签（B1 / 2026-10-31 用户定稿）。
 *
 * - 需求对话 / 轨迹同级（轨迹在需求对话**右侧**），全部由 CopilotTabBar 渲染；
 * - 切到轨迹只切换渲染内容，不清空需求会话 store；
 * - 「执行日志」标签已撤删，页面上不再出现（日志内容并入轨迹的「日志」视图）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CopilotDock } from './CopilotDock';
import { FIXED_TABS, REQUIREMENTS_TAB, TRACE_TAB, useCopilotStore } from '@/stores/copilotStore';
import { useAgentStore } from '@/stores/agentStore';

vi.mock('@/features/agent/AgentPanel', () => ({
  AgentPanel: () => <div data-testid="req-pane">req</div>,
  RequirementsPane: () => <div data-testid="req-pane">req</div>,
  LogPanel: () => <div data-testid="log-pane">logs</div>,
}));
vi.mock('@/features/workspace/WorkspaceMaterialsPanel', () => ({
  WorkspaceMaterialsPanel: () => <div data-testid="ws-pane">ws</div>,
}));
vi.mock('./CopilotTaskRunTab', () => ({
  CopilotTaskRunTab: () => <div data-testid="run-pane">run</div>,
}));
vi.mock('./CopilotDocsTab', () => ({
  CopilotDocsTab: () => <div data-testid="docs-pane">docs</div>,
}));
vi.mock('./CopilotStageTab', () => ({
  CopilotStageTab: () => <div data-testid="stage-pane">stage</div>,
}));
vi.mock('./CopilotSubagentTab', () => ({
  CopilotSubagentTab: () => <div data-testid="subagent-pane">subagent</div>,
}));

describe('CopilotDock 单层标签（B1）', () => {
  beforeEach(() => {
    localStorage.clear();
    useCopilotStore.setState({
      projectId: 'p1',
      tabs: [...FIXED_TABS],
      activeId: REQUIREMENTS_TAB.id,
    });
  });
  afterEach(cleanup);

  it('默认渲染需求对话，且页面只有一排标签（需求对话 + 轨迹）', () => {
    render(<CopilotDock />);
    expect(screen.getByTestId('req-pane')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(FIXED_TABS.length);
    expect(screen.getAllByText('需求对话')).toHaveLength(1);
    expect(screen.getAllByText('轨迹')).toHaveLength(1);
    // 2026-10-31：执行日志标签已撤删，能力并入轨迹
    expect(screen.queryByText('执行日志')).toBeNull();
  });

  it('切到轨迹：渲染轨迹面板，需求会话 store 不被清空', () => {
    const before = useAgentStore.getState();
    const sessionId = before.requirementsSessionId;
    const msgs = before.requirementsMessages;

    render(<CopilotDock />);
    fireEvent.click(screen.getByRole('tab', { name: /轨迹/ }));

    expect(screen.getByTestId('run-pane')).toBeTruthy();
    expect(screen.queryByTestId('req-pane')).toBeNull();
    expect(useCopilotStore.getState().activeId).toBe(TRACE_TAB.id);

    // 需求会话的 store 状态原样保留（切换标签=卸载视图，不等于重置会话）
    const after = useAgentStore.getState();
    expect(after.requirementsSessionId).toBe(sessionId);
    expect(after.requirementsMessages).toBe(msgs);

    // 切回需求对话 → 视图重建，store 仍一致
    fireEvent.click(screen.getByRole('tab', { name: /需求对话/ }));
    expect(screen.getByTestId('req-pane')).toBeTruthy();
    expect(useAgentStore.getState().requirementsSessionId).toBe(sessionId);
  });
});
