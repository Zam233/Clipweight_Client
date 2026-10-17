// @vitest-environment jsdom
/**
 * 调度抽屉（F1/F4）：七段 tab 切换 + 改派工单提交。
 *
 * 只测抽屉自己的职责：切 tab 拉对应数据、工单提交把参数交对、结果文案如实反映
 * 「已登记但需要重试」。请求是否成功由 store 测试覆盖。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: {
    getLedger: vi.fn(async () => ({ entries: [], attempts: {}, found: true })),
    getAttribution: vi.fn(async () => ({ found: false })),
    getDiagnosis: vi.fn(async () => ({ found: false })),
    getDecisions: vi.fn(async () => ({ decisions: [], accepted_degraded: false })),
    getBudget: vi.fn(async () => ({ spent_usd: 0, budgetEnabled: false, level: 'unlimited' })),
    getSubagents: vi.fn(async () => ({ tree: [] })),
    getExecLog: vi.fn(async () => ({ records: [] })),
    getPendingApprovals: vi.fn(async () => ({ items: [] })),
    getAutoMode: vi.fn(async () => ({ enabled: false })),
    getPendingWorkerReviews: vi.fn(async () => ({ items: [] })),
    dispatch: vi.fn(),
  },
}));

vi.mock('@/services/api/supervisor', () => ({ supervisorApi: api }));

import { useSupervisorStore } from '@/stores/supervisorStore';

import { SupervisorDrawer } from './SupervisorDrawer';

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useSupervisorStore.getState().reset();
  useSupervisorStore.setState({ pipelineId: 'pl_1' });
});

describe('SupervisorDrawer', () => {
  it('切到子代理 / 执行 / 待审时各自拉一次数据', () => {
    render(<SupervisorDrawer />);

    fireEvent.click(screen.getByRole('tab', { name: '子代理' }));
    expect(api.getSubagents).toHaveBeenCalledWith('pl_1');

    fireEvent.click(screen.getByRole('tab', { name: '执行' }));
    expect(api.getExecLog).toHaveBeenCalledWith('pl_1');
    expect(api.getAutoMode).toHaveBeenCalledWith('pl_1');

    fireEvent.click(screen.getByRole('tab', { name: '待审' }));
    expect(api.getPendingWorkerReviews).toHaveBeenCalled();
  });

  it('改派工单：理由为空时不能提交，填好后按参数提交并提示需要重试', async () => {
    api.dispatch.mockResolvedValue({ order: { id: 'ord_1' }, accepted: true, requires_retry: true });
    render(<SupervisorDrawer />);

    fireEvent.click(screen.getByRole('tab', { name: '改派' }));
    const submit = screen.getByRole('button', { name: '提交改派' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'audio' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '第 2 段配音串味' } });
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);

    expect(api.dispatch).toHaveBeenCalledWith('pl_1', {
      target_stage: 'audio',
      reason: '第 2 段配音串味',
    });
    expect(await screen.findByText(/已登记，重试该环节后生效/)).toBeTruthy();
  });

  it('无管线时改派不提交（避免打到空管线）', () => {
    useSupervisorStore.setState({ pipelineId: null });
    render(<SupervisorDrawer />);

    fireEvent.click(screen.getByRole('tab', { name: '改派' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '想改一下' } });
    fireEvent.click(screen.getByRole('button', { name: '提交改派' }));

    expect(api.dispatch).not.toHaveBeenCalled();
  });
});
