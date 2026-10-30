/**
 * Run 详情（PRD §5 P1-1）。锁定：字段摊开、空态明说、404 可重试、不伪造字段。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { runDetail: vi.fn() } }));
vi.mock('@/services/api', () => ({ taskApi: api }));

import { TaskRunDetail } from './TaskRunDetail';

const RUN = {
  run_id: 'run_a', kind: 'stage', stage: 'animation', status: 'degraded', attempt: 2,
  summary: '动画已编排（弱动效）',
  brief: '把文字动效做强，别压字幕',
  outputs: { report_path: 'reports/07-animation-2.md', generated_mg_count: 6 },
  needs: [{ key: 'timeline', reason: '缺上一版时间线' }],
  failure: { category: 'quality_gate', retryable: 'retryable', evidence: ['覆盖 12%'] },
  degradations: [{ kind: 'text_motion_weak', scope: 'animation', detail: '位移不足 24px' }],
  tool_calls_path: 'reports/tool_calls/animation-2.json',
};

beforeEach(() => { cleanup(); vi.clearAllMocks(); });

describe('TaskRunDetail', () => {
  it('展开后摊开 brief / 产出 / 待补 / 失败 / 降级 / 轨迹路径', async () => {
    api.runDetail.mockResolvedValue({ task_id: 't1', run: RUN });
    render(<TaskRunDetail taskId="t1" runId="run_a" />);

    await waitFor(() => expect(api.runDetail).toHaveBeenCalledWith('t1', 'run_a'));
    expect(await screen.findByText('把文字动效做强，别压字幕')).toBeTruthy();
    expect(screen.getByText(/report_path/)).toBeTruthy();
    expect(screen.getByText(/缺上一版时间线/)).toBeTruthy();
    expect(screen.getByText(/quality_gate/)).toBeTruthy();
    const deg = screen.getByTestId('run-detail-degradations');
    expect(deg.textContent).toContain('text_motion_weak');
    expect(deg.textContent).toContain('位移不足 24px');
    expect(document.querySelector('[data-run-path]')?.getAttribute('data-run-path'))
      .toBe('reports/tool_calls/animation-2.json');
  });

  it('空字段给明确空态，不显示假内容', async () => {
    api.runDetail.mockResolvedValue({
      task_id: 't1',
      run: { run_id: 'run_b', stage: 'audio', status: 'ok', outputs: {}, needs: [],
        degradations: [], failure: null, brief: '', tool_calls_path: '' },
    });
    render(<TaskRunDetail taskId="t1" runId="run_b" />);
    expect(await screen.findByText('这次派发没有记录 brief')).toBeTruthy();
    expect(screen.getByText('此运行没有记录产出')).toBeTruthy();
    expect(screen.getByText('这次没有失败')).toBeTruthy();
    expect(screen.getByText('这次没有降级')).toBeTruthy();
    expect(screen.getByText('这次运行没有落盘轨迹')).toBeTruthy();
  });

  it('404 显示可重试错误，且不清空已加载内容', async () => {
    api.runDetail.mockRejectedValueOnce({
      response: { status: 404, data: { detail: { reason: 'run_not_found' } } },
    });
    render(<TaskRunDetail taskId="t1" runId="run_x" />);
    const err = await screen.findByTestId('run-detail-error');
    expect(err.textContent).toContain('该次运行记录已不可用');

    api.runDetail.mockResolvedValue({ task_id: 't1', run: { ...RUN, run_id: 'run_x' } });
    fireEvent.click(screen.getByTestId('run-detail-retry'));
    await waitFor(() => expect(api.runDetail).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('把文字动效做强，别压字幕')).toBeTruthy();
  });

  it('折叠只收起内容，不丢数据', async () => {
    api.runDetail.mockResolvedValue({ task_id: 't1', run: RUN });
    render(<TaskRunDetail taskId="t1" runId="run_a" />);
    await screen.findByText('把文字动效做强，别压字幕');
    fireEvent.click(screen.getByTestId('run-detail-toggle'));
    expect(screen.queryByText('把文字动效做强，别压字幕')).toBeNull();
    fireEvent.click(screen.getByTestId('run-detail-toggle'));
    expect(screen.getByText('把文字动效做强，别压字幕')).toBeTruthy();
  });
});
