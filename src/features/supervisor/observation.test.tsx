// @vitest-environment jsdom
/**
 * F6–F8 组件测试：子代理树 / 执行日志 / 自动模式 / 授权弹窗 / 待审队列。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import type {
  ExecRecord,
  PendingExecApproval,
  PendingWorkerReview,
  SubagentNode,
} from '@/types/supervisor';

import { SubagentTree } from './SubagentTree';
import { ExecLogList } from './ExecLogList';
import { AutoModeSwitch } from './AutoModeSwitch';
import { ExecPermissionDialog } from './ExecPermissionDialog';
import { WorkerReviewQueue } from './WorkerReviewQueue';

beforeEach(() => cleanup());

const subagent: SubagentNode = {
  id: 'sa_1',
  role: '素材可用性核查员',
  kind: 'ephemeral',
  status: 'running',
  model: { provider: 'p', model: 'm1' },
  duration_ms: 1500,
  last_output: '正在检查第 3 段',
  cancellable: true,
};

describe('SubagentTree', () => {
  it('空态明确', () => {
    render(<SubagentTree nodes={[]} />);
    expect(screen.getByText(/没有派生子代理/)).toBeTruthy();
  });

  it('渲染角色与状态，并可取消（二次确认）', () => {
    const onCancel = vi.fn();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<SubagentTree nodes={[subagent]} onCancel={onCancel} />);

    expect(screen.getByText('素材可用性核查员')).toBeTruthy();
    expect(screen.getByText('运行中')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '取消 素材可用性核查员' }));
    expect(confirm).toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledWith(expect.objectContaining({ id: 'sa_1' }));
  });

  it('已结束的节点不提供取消', () => {
    render(<SubagentTree nodes={[{ ...subagent, status: 'done' }]} onCancel={vi.fn()} />);
    expect(screen.queryByRole('button', { name: /取消/ })).toBeNull();
  });
});

const execRecord: ExecRecord = {
  id: 'ex_1',
  ts: '2026-10-17T10:00:00Z',
  kind: 'shell',
  command: 'rm -rf tmp',
  cwd: 'workspace/pl',
  riskLevel: 'med',
  riskReasons: ['删除既有目录'],
  dangerExplanation: '会删除本次管线的临时目录',
  autoMode: false,
  exitCode: null,
  durationMs: 12,
  rejected: { reason: '用户拒绝授权' },
};

describe('ExecLogList', () => {
  it('空态明确', () => {
    render(<ExecLogList records={[]} />);
    expect(screen.getByText(/没有执行过命令/)).toBeTruthy();
  });

  it('被拒绝的行有独立标识，展开可见原因与输出', () => {
    render(<ExecLogList records={[execRecord]} />);
    expect(screen.getByText('已拒绝')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { expanded: false }));
    expect(screen.getByText(/用户拒绝授权/)).toBeTruthy();
    expect(screen.getByText(/删除既有目录/)).toBeTruthy();
    expect(screen.getByText(/会删除本次管线的临时目录/)).toBeTruthy();
  });
});

describe('AutoModeSwitch', () => {
  it('关时说明会逐条确认，点击回调', () => {
    const onChange = vi.fn();
    render(<AutoModeSwitch enabled={false} onChange={onChange} />);
    expect(screen.getByText(/逐条请你确认/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /自动模式/ }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('开时说明只减免中危', () => {
    render(<AutoModeSwitch enabled onChange={() => {}} />);
    expect(screen.getByText(/中危命令将直接执行，高危仍会询问/)).toBeTruthy();
  });
});

const approval: PendingExecApproval = {
  id: 'ap_1',
  command: 'del output.mp4',
  riskLevel: 'high',
  riskReasons: ['会覆盖既有文件'],
  dangerExplanation: '会删除成片目录里的 output.mp4',
  requestedBy: 'supervisor',
  expiresAt: '',
};

describe('ExecPermissionDialog', () => {
  it('无待授权时不渲染', () => {
    const { container } = render(<ExecPermissionDialog approval={null} />);
    expect(container.firstChild).toBeNull();
  });

  it('默认焦点在拒绝；high 风险需勾选后才能批准', () => {
    const onApprove = vi.fn();
    const onReject = vi.fn();
    render(<ExecPermissionDialog approval={approval} onApprove={onApprove} onReject={onReject} />);

    const reject = screen.getByRole('button', { name: '拒绝' });
    expect(document.activeElement).toBe(reject);

    const allow = screen.getByRole('button', { name: '允许执行' }) as HTMLButtonElement;
    expect(allow.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));
    expect(allow.disabled).toBe(false);
    fireEvent.click(allow);
    expect(onApprove).toHaveBeenCalledWith(true);
  });

  it('展示命令、理由与危险说明', () => {
    render(<ExecPermissionDialog approval={approval} />);
    expect(screen.getByText('del output.mp4')).toBeTruthy();
    expect(screen.getByText(/会覆盖既有文件/)).toBeTruthy();
    expect(screen.getByText(/会删除成片目录/)).toBeTruthy();
  });
});

const reviewItem: PendingWorkerReview = {
  id: 'w_1',
  role: '运维核查员',
  toolAllowlist: ['run_shell'],
  hasExecPermission: true,
  systemPrompt: '跑 ffprobe 查有没有音轨',
  risk: { level: 'high', reasons: ['可执行任意命令'], suggestedAction: '人工确认' },
  createdAt: '2026-10-17T10:00:00Z',
};

describe('WorkerReviewQueue', () => {
  it('空态明确', () => {
    render(<WorkerReviewQueue items={[]} />);
    expect(screen.getByText(/没有待审核的子代理/)).toBeTruthy();
  });

  it('high 风险批准默认禁用，勾选后可批准；拒绝始终可用', () => {
    const onReview = vi.fn();
    render(<WorkerReviewQueue items={[reviewItem]} onReview={onReview} />);

    expect(screen.getByText(/风险：高/)).toBeTruthy();
    expect(screen.getByText(/可执行任意命令/)).toBeTruthy();
    expect(screen.getByText(/该判定来自独立模型/)).toBeTruthy();

    const approve = screen.getByRole('button', { name: '批准' }) as HTMLButtonElement;
    expect(approve.disabled).toBe(true);

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(approve);
    expect(onReview).toHaveBeenCalledWith('w_1', true, true);

    fireEvent.click(screen.getByRole('button', { name: '拒绝' }));
    expect(onReview).toHaveBeenCalledWith('w_1', false, false);
  });

  it('可展开查看完整任务说明', () => {
    render(<WorkerReviewQueue items={[reviewItem]} />);
    fireEvent.click(screen.getByRole('button', { name: /查看完整任务说明/ }));
    expect(screen.getByText(/跑 ffprobe/)).toBeTruthy();
  });
});
