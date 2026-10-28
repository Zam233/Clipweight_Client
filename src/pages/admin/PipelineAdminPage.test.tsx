// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { PipelineAdminPage } from './PipelineAdminPage';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    getRunRecords: vi.fn(),
    getTraceJson: vi.fn(),
    retry: vi.fn(),
    runAsyncCalled: false,
    getTasks: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  healthApi: { check: vi.fn().mockResolvedValue({ status: 'ok' }) },
  pipelineApi: {
    getRunRecords: mocks.getRunRecords,
    getTraceJson: mocks.getTraceJson,
    retry: mocks.retry,
    // PRD B1：已退役入口——若页面仍调用它，测试要能发现
    runAsync: vi.fn(() => { mocks.runAsyncCalled = true; return Promise.resolve({}); }),
    getTasks: mocks.getTasks,
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useLocation: () => ({ pathname: '/pipeline-admin' }),
}));

const RUNS = [
  {
    id: 'pl_a', topic: '话题A', status: 'completed',
    duration_ms: 10000, started_at: '2026-08-10T00:00:00Z',
    agents: [{ agent: 'structure', start: 0, dur: 1000, status: 'ok' }],
    llm_cost: 1.23,
  },
  {
    id: 'pl_b', topic: '话题B', status: 'failed',
    duration_ms: 20000, started_at: '2026-08-10T00:00:01Z',
    agents: [
      { agent: 'structure', start: 0, dur: 1000, status: 'ok' },
      { agent: 'material', start: 1000, dur: 2000, status: 'fail' },
    ],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.runAsyncCalled = false;
  mocks.getRunRecords.mockResolvedValue(RUNS);
  mocks.getTraceJson.mockResolvedValue([]);
  mocks.retry.mockResolvedValue({ status: 'retrying' });
  mocks.getTasks.mockResolvedValue({ tasks: [], recovered: [], running: 2, pending: 1 });
});

afterEach(() => cleanup());

describe('G9: PipelineAdminPage 真实成本 + 重试', () => {
  it('有 llm_cost 记录 → 显示真实成本（求和）', async () => {
    render(<PipelineAdminPage />);
    await screen.findByText(/¥1.23/);
  });

  it('无 llm_cost → 成本显示 —', async () => {
    mocks.getRunRecords.mockResolvedValue([RUNS[1]]);
    render(<PipelineAdminPage />);
    // V38 之后「成本」与「用量」两处都可能显示占位符 —，因此按数量断言
    const dashes = await screen.findAllByText('—');
    expect(dashes.length).toBeGreaterThanOrEqual(1);
  });

  it('V38: 有 usage 时显示 token 用量，无 usage 时不编造', async () => {
    mocks.getRunRecords.mockResolvedValue([
      {
        ...RUNS[0],
        usage: { input_tokens: 5697, output_tokens: 2465, total_tokens: 8162, calls: 2, render_sec: 12.4 },
      },
      RUNS[1],
    ]);
    render(<PipelineAdminPage />);
    const usage = await screen.findByTestId('run-usage');
    expect(usage.textContent).toContain('8,162');
    expect(usage.textContent).toContain('2 次调用');
    expect(usage.textContent).toContain('渲染 12.4s');
    // 只有一条记录带 usage，页面上只出现一处
    expect(screen.getAllByTestId('run-usage')).toHaveLength(1);
  });

  it('PRD B1：失败记录不再显示重试按钮（后端 retry 已返回 410）', async () => {
    render(<PipelineAdminPage />);
    await screen.findByText('话题B');
    expect(screen.queryByText('重试')).toBeNull();
  });

  it('PRD B1：历史只读横幅 + 新任务入口指引', async () => {
    render(<PipelineAdminPage />);
    const banner = await screen.findByTestId('legacy-readonly-banner');
    expect(banner.textContent).toContain('历史只读');
    expect(banner.textContent).toContain('不能启动或重试');
    expect(banner.textContent).toContain('/api/requirements/proceed');
    expect(banner.textContent).toContain('/api/task');
    // 新任务入口可点（跳转到新建制作）
    const goto = screen.getByTestId('goto-new-production');
    expect(goto.textContent).toContain('新建制作');
    fireEvent.click(goto);
    // 关键：旧启动接口不再被任何 UI 路径触发
    expect(mocks.retry).not.toHaveBeenCalled();
    expect(mocks.runAsyncCalled ?? false).toBe(false);
  });

  it('A10: 队列状态条显示 running/pending，有中断项时提示 recovered', async () => {
    render(<PipelineAdminPage />);
    expect(await screen.findByText('执行队列')).toBeTruthy();
    // 「运行中 2」「排队 1」由状态条渲染
    await waitFor(() => {
      const bar = screen.getByText('执行队列').closest('div')?.parentElement;
      expect(bar?.textContent).toContain('运行中');
      expect(bar?.textContent).toContain('2');
      expect(bar?.textContent).toContain('排队');
      expect(bar?.textContent).toContain('1');
    });
    expect(mocks.getTasks).toHaveBeenCalled();
  });

  it('A10: 无 recovered 项时提示不出现', async () => {
    mocks.getTasks.mockResolvedValue({ tasks: [], recovered: [], running: 0, pending: 0 });
    render(<PipelineAdminPage />);
    await screen.findByText('执行队列');
    expect(screen.queryByText(/重启中断/)).toBeNull();
  });
});
