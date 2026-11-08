// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { applyProceedResult, storedTaskId, storedWorkspaceRoot } from './proceedResult';

vi.mock('@/services/storage/pipelineSession', () => ({
  savePipelineId: vi.fn(),
}));

describe('proceedResult（双轨返回处理）', () => {
  beforeEach(() => {
    sessionStorage.clear();
    vi.clearAllMocks();
  });

  it('task_id 优先：返回 task 模式并记住 workspace_root', () => {
    const target = applyProceedResult({
      task_id: 'task_1', pipeline_id: 'task_1', workspace_root: 'J:/ws/x',
    });
    expect(target).toEqual({ mode: 'task', id: 'task_1' });
    expect(storedTaskId()).toBe('task_1');
    expect(storedWorkspaceRoot()).toBe('J:/ws/x');
  });

  it('只有 pipeline_id：走老管线模式', async () => {
    const { savePipelineId } = await import('@/services/storage/pipelineSession');
    const target = applyProceedResult({ pipeline_id: 'pl_abc' });
    expect(target).toEqual({ mode: 'pipeline', id: 'pl_abc' });
    expect(savePipelineId).toHaveBeenCalledWith('pl_abc');
    expect(storedTaskId()).toBe('');
  });

  it('两者都没有：返回 null', () => {
    expect(applyProceedResult({})).toBeNull();
    expect(applyProceedResult(null)).toBeNull();
  });
});
