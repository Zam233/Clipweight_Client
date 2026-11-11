// @vitest-environment jsdom
/**
 * E-01（PRD §5A P1）：从首页进入编辑器后，需求 Agent 自动启动会「自我取消」，
 * 表现为会话 id 未写入、requirementsBusy 永远为 true、界面永久转圈。
 *
 * 根因：effect 依赖 requirementsTopic，内部又同步 setRequirementsTopic('')，
 * 依赖变化立刻跑 cleanup 把 cancelled 置 true，异步流程在每个 await 后提前返回，
 * finally 在 cancelled 时不清 busy。
 *
 * 修复后断言：消费 topic 不会取消自身 → session 写入、busy 最终为 false。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, waitFor, cleanup } from '@testing-library/react';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    init: vi.fn(),
    streamChat: vi.fn(),
    chat: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  requirementsApi: {
    init: mocks.init,
    streamChat: mocks.streamChat,
    chat: mocks.chat,
  },
}));

// 后端不可达时不要落进 demo 分支，否则测的就不是正常路径
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (sel: (s: unknown) => unknown) => sel({ allowDemoFallback: false }),
    { getState: () => ({ allowDemoFallback: false }) },
  ),
}));

import { useProjectStore } from '@/stores/projectStore';
import { useAgentStore } from '@/stores/agentStore';
import { useRequirementsAutoStart } from './useRequirementsAutoStart';

beforeEach(() => {
  vi.clearAllMocks();
  useAgentStore.getState().resetRequirements?.();
  useAgentStore.setState({
    requirementsSessionId: null,
    requirementsBusy: false,
    requirementsStatus: 'idle',
    requirementsMessages: [],
  });
  useProjectStore.getState().resetProject();
  useProjectStore.setState({
    projectId: 'proj_e01',
    requirementsTopic: '做一期数码评测',
    requirementsScript: '',
    requirementsAudioDuration: 30,
  });
  mocks.init.mockResolvedValue({ session_id: 'sess_e01' });
  mocks.streamChat.mockResolvedValue({
    reply: '好的，先确认三点',
    status: 'brief_ready',
    creative_brief: { title: '简报' },
  });
});

afterEach(() => { cleanup(); });

describe('E-01 自动启动不再自我取消', () => {
  it('消费 topic 后 busy 最终为 false，且 session 已写入', async () => {
    renderHook(() => useRequirementsAutoStart(true));

    await waitFor(() => expect(mocks.init).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(useAgentStore.getState().requirementsBusy).toBe(false));
    expect(useAgentStore.getState().requirementsSessionId).toBe('sess_e01');
    // topic 被消费掉，不会重复触发
    expect(useProjectStore.getState().requirementsTopic).toBe('');
    expect(mocks.init).toHaveBeenCalledTimes(1);
  });

  it('init 失败也会收尾：busy 复位、状态回到 idle（不永久转圈）', async () => {
    mocks.init.mockRejectedValue(new Error('后端 500'));
    renderHook(() => useRequirementsAutoStart(true));

    await waitFor(() => expect(mocks.init).toHaveBeenCalled());
    await waitFor(() => expect(useAgentStore.getState().requirementsBusy).toBe(false));
    expect(useAgentStore.getState().requirementsSessionId).toBe(null);
  });

  it('没有 topic 时不自动启动', async () => {
    useProjectStore.setState({ requirementsTopic: '' });
    renderHook(() => useRequirementsAutoStart(true));
    await new Promise((r) => setTimeout(r, 30));
    expect(mocks.init).not.toHaveBeenCalled();
  });
});
