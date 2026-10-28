// @vitest-environment jsdom
/**
 * PRD B9（2026-10-29 / G12、G13）：评估 latest 与产物回链。
 *
 * 证伪点：
 * 1. `/api/eval/latest` 的 **404 是正常空态**（"还没跑过评估"），不是错误、不白屏；
 * 2. 有报告时首屏直接渲染最近一份；
 * 3. 其它错误（500/网络）仍按错误显示并可重试。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { EvalPanel } from './EvalPanel';
import { TaskArtifacts } from '@/features/task/TaskArtifacts';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    latest: vi.fn(),
    listReports: vi.fn(),
    getReport: vi.fn(),
    result: vi.fn(),
    toProject: vi.fn(),
    navigate: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  evalApi: {
    latest: mocks.latest,
    listReports: mocks.listReports,
    getReport: mocks.getReport,
  },
  taskApi: { result: mocks.result, toProject: mocks.toProject },
}));

vi.mock('@/services/api/task', () => ({
  taskApi: { result: mocks.result, toProject: mocks.toProject },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({ pathname: '/pipeline-admin' }),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const PAYLOAD = {
  runs: 3,
  topic: { id: 'g04', topic: '鬼畜快剪' },
  // 面板按 n（样本数）决定是否展示该指标，所以 fixture 必须带 n
  metrics: { success_rate: { n: 3, mean: 0.67, min: 0.5, max: 0.9, spread: 0.1 } },
  raw_runs: [{ task_id: 't1', status: 'done' }, { task_id: 't2', status: 'failed' }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.latest.mockResolvedValue({ name: 'latest', payload: PAYLOAD });
  mocks.listReports.mockResolvedValue({ count: 1, items: [{ name: 'r1', topic: '鬼畜快剪', runs: 3 }] });
  mocks.getReport.mockResolvedValue({ name: 'r1', payload: PAYLOAD });
  mocks.result.mockResolvedValue({
    has_timeline: true, tracks: 2, clips: 5, duration_sec: 30,
    output_path: 'J:/renders/out.mp4',
  });
});
afterEach(cleanup);

describe('B9 评估 latest', () => {
  it('有报告：首屏渲染最近一份', async () => {
    render(<EvalPanel />);
    await waitFor(() => expect(mocks.latest).toHaveBeenCalled());
    expect(await screen.findByTestId('eval-report-list')).toBeTruthy();
    // 指标来自 latest payload（不是列表摘要）
    expect(screen.getByTestId('eval-panel').textContent).toContain('67%');
  });

  it('404（没有报告）→ 正常空态文案，不当成错误', async () => {
    mocks.latest.mockResolvedValue(null);
    mocks.listReports.mockResolvedValue({ count: 0, items: [] });
    render(<EvalPanel />);

    const empty = await screen.findByTestId('eval-empty');
    expect(empty.textContent).toContain('还没有跑过评估');
    expect(empty.textContent).toContain('正常空态');
    // 没有错误横幅
    expect(screen.queryByText(/加载失败|失败/)).toBeNull();
  });

  it('接口真错（非 404）→ 错误提示', async () => {
    mocks.latest.mockRejectedValue(new Error('后端离线'));
    render(<EvalPanel />);
    await waitFor(() => expect(screen.getByTestId('eval-panel').textContent).toContain('后端离线'));
  });
});

describe('B9 产物回链', () => {
  it('产物路径可见且可复制（复制的是后端返回的路径，不拼接）', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText }, configurable: true,
    });
    render(<TaskArtifacts taskId="task_1" />);

    const path = await screen.findByTestId('artifact-path');
    expect(path.textContent).toBe('J:/renders/out.mp4');
    screen.getByTestId('artifact-path-copy').click();
    expect(writeText).toHaveBeenCalledWith('J:/renders/out.mp4');
  });
});
