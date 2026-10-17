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
    requestExec: vi.fn(),
    approveExec: vi.fn(async () => {}),
    rejectExec: vi.fn(async () => {}),
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

  it('改派工单：理由为空时不能提交，填好后按参数提交并如实显示「已开始重做」', async () => {
    api.dispatch.mockResolvedValue({
      pipeline_id: 'pl_1',
      order: { id: 'ord_1', target_stage: 'audio', reason: '配音串味', source: 'manual' },
      accepted: true,
      requires_retry: false,
      retry: { retried: true, status: 'retrying' },
    });
    render(<SupervisorDrawer />);

    fireEvent.click(screen.getByRole('tab', { name: '改派' }));
    const submit = screen.getByRole('button', { name: '提交并重做' }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);

    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'audio' } });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '第 2 段配音串味' } });
    expect(submit.disabled).toBe(false);

    fireEvent.click(submit);

    expect(api.dispatch).toHaveBeenCalledWith('pl_1', {
      target_stage: 'audio',
      reason: '第 2 段配音串味',
    });
    expect(await screen.findByText(/已开始重做/)).toBeTruthy();
  });

  it('改派跑不起来时显示原因（不能让用户以为活已经派下去了）', async () => {
    api.dispatch.mockResolvedValue({
      pipeline_id: 'pl_1',
      order: { id: 'ord_2', target_stage: 'edit', reason: '卡顿', source: 'manual' },
      accepted: true,
      requires_retry: true,
      retry: { retried: false, reason: '管线结果不在内存中' },
    });
    render(<SupervisorDrawer />);

    fireEvent.click(screen.getByRole('tab', { name: '改派' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '卡顿' } });
    fireEvent.click(screen.getByRole('button', { name: '提交并重做' }));

    expect(await screen.findByText(/没能开始重做/)).toBeTruthy();
    expect(screen.getByText(/管线结果不在内存中/)).toBeTruthy();
  });

  it('无管线时改派不提交（避免打到空管线）', () => {
    useSupervisorStore.setState({ pipelineId: null });
    render(<SupervisorDrawer />);

    fireEvent.click(screen.getByRole('tab', { name: '改派' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '想改一下' } });
    fireEvent.click(screen.getByRole('button', { name: '提交并重做' }));

    expect(api.dispatch).not.toHaveBeenCalled();
  });

  it('执行页：提交命令后如实显示结局（已执行 / 等授权）', async () => {
    api.requestExec.mockResolvedValue({
      pipeline_id: 'pl_1',
      status: 'done',
      exitCode: 0,
      outputTail: 'ok',
    });
    render(<SupervisorDrawer />);

    fireEvent.click(screen.getByRole('tab', { name: '执行' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'npm run lint' } });
    fireEvent.click(screen.getByRole('button', { name: '提交执行' }));

    expect(api.requestExec).toHaveBeenCalledWith('pl_1', {
      kind: 'shell',
      command: 'npm run lint',
    });
    expect(await screen.findByText(/已执行/)).toBeTruthy();
  });

  it('执行页：高风险命令直接弹授权框，且批准要带二次确认', async () => {
    api.requestExec.mockResolvedValue({
      pipeline_id: 'pl_1',
      status: 'pending_approval',
      approval: {
        id: 'ap_1',
        command: 'npm run deploy',
        riskLevel: 'high',
        riskReasons: ['会改动线上产物'],
        dangerExplanation: '会覆盖 dist 目录',
        requestedBy: 'supervisor',
        expiresAt: '',
      },
    });
    render(<SupervisorDrawer />);

    fireEvent.click(screen.getByRole('tab', { name: '执行' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'npm run deploy' } });
    fireEvent.click(screen.getByRole('button', { name: '提交执行' }));

    const dialog = await screen.findByRole('dialog', { name: '命令授权' });
    expect(dialog).toBeTruthy();
    expect(screen.getByText(/会覆盖 dist 目录/)).toBeTruthy();

    // high 未勾确认时「允许执行」不可点
    const allow = screen.getByRole('button', { name: '允许执行' }) as HTMLButtonElement;
    expect(allow.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));
    expect(allow.disabled).toBe(false);
    fireEvent.click(allow);
    expect(api.approveExec).toHaveBeenCalledWith('pl_1', 'ap_1', true);
  });
});
