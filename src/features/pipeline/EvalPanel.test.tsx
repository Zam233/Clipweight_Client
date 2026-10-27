// @vitest-environment jsdom
/** 评估面板（closeout B10）：只读报告，口径由后端定。 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { EvalPanel } from './EvalPanel';

const listPayload = {
  count: 1,
  items: [{
    name: 'golden-g04-1.json',
    topic_id: 'g04_meme_burst',
    topic: '老板说再来一份',
    runs: 3,
    success_rate_mean: 0,
    success_rate_spread: 0,
    cost_avg_usd: null,
  }],
};

const reportPayload = {
  ok: true,
  runs: 3,
  topic: { id: 'g04_meme_burst', topic: '老板说再来一份' },
  metrics: {
    success_rate: { n: 3, mean: 0, min: 0, max: 0, spread: 0 },
    avg_turns: { n: 3, mean: 8, min: 7, max: 9, spread: 2 },
    cost_avg_usd: { n: 0 },
  },
  warnings: ['成功率在 3 次运行间波动 0.000：门禁阈值要考虑方差'],
  raw_runs: [
    { task_id: 't1', status: 'failed', finish_reason: '缺少可渲染时间线', turns: 8, tool_calls: 7, cost_usd: null, wall_sec: 35.8 },
    { task_id: 't2', status: 'failed', finish_reason: '缺少可渲染时间线', turns: 9, tool_calls: 8, cost_usd: null, wall_sec: 16.3 },
    { task_id: 't3', status: 'failed', finish_reason: '缺少可渲染时间线', turns: 7, tool_calls: 6, cost_usd: null, wall_sec: 36.4 },
  ],
};

vi.mock('@/services/api', () => ({
  evalApi: {
    listReports: vi.fn(async () => listPayload),
    getReport: vi.fn(async () => ({ name: listPayload.items[0].name, payload: reportPayload })),
  },
}));

describe('EvalPanel', () => {
  afterEach(cleanup);

  it('列出报告并在选中后显示指标与每次运行', async () => {
    render(<EvalPanel />);
    await waitFor(() => expect(screen.getByTestId('eval-report-list')).toBeTruthy());
    expect(screen.getByTestId('eval-report-list').textContent).toContain('老板说再来一份');

    await waitFor(() => expect(screen.getByTestId('eval-report-detail').textContent).toContain('平均回合'));
    const rows = screen.getByTestId('eval-run-rows');
    expect(rows.textContent).toContain('failed');
    expect(rows.textContent).toContain('缺少可渲染时间线');
    expect(rows.textContent).toContain('35.8');
  });

  it('成功率波动会显示告警（门禁不该建在不稳指标上）', async () => {
    render(<EvalPanel />);
    await waitFor(() =>
      expect(screen.getByTestId('eval-report-detail').textContent).toContain('波动'),
    );
  });

  it('没有报告时给出生成命令而不是空白', async () => {
    const api = await import('@/services/api');
    vi.mocked(api.evalApi.listReports).mockResolvedValueOnce({ count: 0, items: [] });
    render(<EvalPanel />);
    await waitFor(() => expect(screen.getByText(/还没有评估报告/)).toBeTruthy());
    expect(screen.getByText(/golden_eval --topic/)).toBeTruthy();
  });
});
