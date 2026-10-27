// @vitest-environment jsdom
/**
 * B1（2026-10-28 PRD）：副驾驶只有一排标签。
 *
 * - 需求对话 / 执行日志 / 任务运行同级，全部由 CopilotTabBar 渲染；
 * - 切到 logs 只切换渲染内容，不清空需求会话 store；
 * - 页面里「执行日志」只出现一次（不再有 AgentPanel 的内部标签行）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { CopilotDock } from './CopilotDock';
import { FIXED_TABS, LOGS_TAB, REQUIREMENTS_TAB, useCopilotStore } from '@/stores/copilotStore';
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

  it('默认渲染需求对话，且页面只有一排标签', () => {
    render(<CopilotDock />);
    expect(screen.getByTestId('req-pane')).toBeTruthy();
    expect(screen.getAllByRole('tab')).toHaveLength(FIXED_TABS.length);
    // 旧实现会出现两个「执行日志」（AgentPanel 内部 + 标签栏）
    expect(screen.getAllByText('执行日志')).toHaveLength(1);
    expect(screen.getAllByText('需求对话')).toHaveLength(1);
  });

  it('切到执行日志：渲染日志面板，需求会话 store 不被清空', () => {
    const before = useAgentStore.getState();
    const sessionId = before.requirementsSessionId;
    const msgs = before.requirementsMessages;

    render(<CopilotDock />);
    fireEvent.click(screen.getByRole('tab', { name: /执行日志/ }));

    expect(screen.getByTestId('log-pane')).toBeTruthy();
    expect(screen.queryByTestId('req-pane')).toBeNull();
    expect(useCopilotStore.getState().activeId).toBe(LOGS_TAB.id);

    // 需求会话的 store 状态原样保留（切换标签=卸载视图，不等于重置会话）
    const after = useAgentStore.getState();
    expect(after.requirementsSessionId).toBe(sessionId);
    expect(after.requirementsMessages).toBe(msgs);
    expect(screen.getAllByText('执行日志')).toHaveLength(1);

    // 切回需求对话 → 视图重建，store 仍一致
    fireEvent.click(screen.getByRole('tab', { name: /需求对话/ }));
    expect(screen.getByTestId('req-pane')).toBeTruthy();
    expect(useAgentStore.getState().requirementsSessionId).toBe(sessionId);
  });
});
