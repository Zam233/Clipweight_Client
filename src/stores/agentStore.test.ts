// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { useAgentStore, MAX_LOG_ENTRIES } from './agentStore';

beforeEach(() => {
  useAgentStore.setState({ logEntries: [] });
});

describe('G2: cancelling state', () => {
  it('cancelling 默认值为 false', () => {
    expect(useAgentStore.getState().cancelling).toBe(false);
  });

  it('setCancelling(true) 置为 true，setCancelling(false) 置回 false', () => {
    useAgentStore.getState().setCancelling(true);
    expect(useAgentStore.getState().cancelling).toBe(true);
    useAgentStore.getState().setCancelling(false);
    expect(useAgentStore.getState().cancelling).toBe(false);
  });

  it('先置 true 后 resetPipeline() 会重置为 false', () => {
    useAgentStore.getState().setCancelling(true);
    expect(useAgentStore.getState().cancelling).toBe(true);
    useAgentStore.getState().resetPipeline();
    expect(useAgentStore.getState().cancelling).toBe(false);
  });
});

/**
 * E-06 线索 1（复核确认，PRD §5A）：resetPipeline 只清内存不清持久化，
 * 刷新后旧项目的 pipelineId 会经 loadPipelineId() 复活并重连 SSE。
 */
describe('E-06 resetPipeline 清理管线持久化', () => {
  it('resetPipeline 后 loadPipelineId 返回 null（sessionStorage 与 localStorage 均清）', async () => {
    const { savePipelineId, loadPipelineId, clearPipelineId } = await import(
      '@/services/storage/pipelineSession');
    clearPipelineId();
    savePipelineId('pl_old_project');

    expect(loadPipelineId()).toBe('pl_old_project');
    useAgentStore.getState().resetPipeline();
    expect(loadPipelineId()).toBeNull();
    clearPipelineId(); // 测试自清理
  });
});

/**
 * E-06 线索 7（复核确认，PRD §5A）：恢复快照时残留 streaming:true → 打字光标常驻。
 */
describe('E-06 restoreAgentState 收敛 streaming 标记', () => {
  it('恢复的消息 streaming 一律置 false', () => {
    useAgentStore.getState().restoreAgentState({
      requirementsSessionId: 'sess_x',
      requirementsStatus: 'gathering',
      requirementsMessages: [
        { id: 'a', role: 'user', content: 'hi', timestamp: '' },
        { id: 'b', role: 'assistant', content: '生成中…', timestamp: '', streaming: true },
      ],
    } as never);
    const msgs = useAgentStore.getState().requirementsMessages;
    expect(msgs.find((m) => m.id === 'b')?.streaming).toBe(false);
    expect(msgs.find((m) => m.id === 'a')?.streaming).toBeFalsy();
  });
});

describe('E7: log entry cap', () => {
  it('601 条 addLogEntry 后仅保留最近 500 条', () => {
    const s = useAgentStore.getState();
    for (let i = 0; i < 601; i++) {
      s.addLogEntry({ timestamp: Date.now(), agent: 'system', type: 'info', summary: `e-${i}` });
    }
    const entries = useAgentStore.getState().logEntries;
    expect(entries.length).toBe(MAX_LOG_ENTRIES);
    expect(entries.length).toBe(500);
    expect(entries[0].summary).toBe('e-101'); // 最旧 101 条被丢弃
    expect(entries[entries.length - 1].summary).toBe('e-600');
  });

  it('addLogEntries 批量超限也被裁剪', () => {
    const entries = Array.from({ length: 600 }, (_, i) => ({
      timestamp: Date.now(), agent: 'system', type: 'info' as const, summary: `b-${i}`,
    }));
    useAgentStore.getState().addLogEntries(entries);
    const list = useAgentStore.getState().logEntries;
    expect(list.length).toBe(500);
    expect(list[0].summary).toBe('b-100');
  });

  it('低于上限不裁剪', () => {
    const s = useAgentStore.getState();
    for (let i = 0; i < 10; i++) {
      s.addLogEntry({ timestamp: Date.now(), agent: 'system', type: 'info', summary: `s-${i}` });
    }
    expect(useAgentStore.getState().logEntries.length).toBe(10);
  });

  it('clearLogs 清空', () => {
    const s = useAgentStore.getState();
    s.addLogEntry({ timestamp: Date.now(), agent: 'system', type: 'info', summary: 'x' });
    s.clearLogs();
    expect(useAgentStore.getState().logEntries.length).toBe(0);
  });
});

describe('需求会话持久化：sessionId / status 进本地草稿', () => {
  it('setRequirementsSession + setRequirementsStatus 写进草稿', async () => {
    const mod = await import('./agentStore');
    mod.clearRequirementsDraft();
    const s = useAgentStore.getState();
    s.setRequirementsSession('req_persist');
    useAgentStore.getState().setRequirementsStatus('plan_ready');
    const draft = mod.loadRequirementsDraft();
    expect(draft?.sessionId).toBe('req_persist');
    expect(draft?.status).toBe('plan_ready');
  });
});
