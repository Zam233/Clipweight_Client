// @vitest-environment jsdom
/** F05：capped 单列显示；试运行列表显示 capped 数。 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { EvalPanel } from './EvalPanel';

const { mocks } = vi.hoisted(() => ({
  mocks: { latest: vi.fn(), listReports: vi.fn(), getReport: vi.fn() },
}));

vi.mock('@/services/api', () => ({
  evalApi: {
    latest: mocks.latest,
    listReports: mocks.listReports,
    getReport: mocks.getReport,
  },
}));

const payload = {
  ok: true,
  runs: 5,
  capped_count: 2,
  eligible_runs: 3,
  topic: { id: 'g04', topic: '梗图快剪' },
  metrics: {
    success_rate: { n: 3, mean: 0.6667, min: 0, max: 1, spread: 1 },
    avg_turns: { n: 3, mean: 12, min: 8, max: 16, spread: 8 },
  },
  warnings: ['2 次运行 capped：已从成功率统计中排除（单列 capped_count）'],
  raw_runs: [],
};

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('EvalPanel · capped 单列（F05）', () => {
  it('显示 capped 横幅与有效样本数', async () => {
    mocks.latest.mockResolvedValue({ name: 'g04.json', payload });
    mocks.listReports.mockResolvedValue({ items: [] });
    render(<EvalPanel />);
    const banner = await screen.findByTestId('eval-capped-banner');
    expect(banner.textContent).toContain('2 次');
    expect(banner.textContent).toContain('有效样本 3 次');
  });

  it('列表项同时显示 capped 计数', async () => {
    mocks.latest.mockResolvedValue({ name: 'g04.json', payload });
    mocks.listReports.mockResolvedValue({
      items: [{
        name: 'g04.json', topic: '梗图快剪', runs: 5,
        success_rate_mean: 0.6667, success_rate_spread: 1,
        capped_count: 2,
      }],
    });
    render(<EvalPanel />);
    await waitFor(() => expect(document.body.textContent).toContain('capped 2'));
  });
});
