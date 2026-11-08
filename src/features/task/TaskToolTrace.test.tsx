/**
 * 全量工具轨迹（PRD modern-agent-review M3）。
 *
 * 锁四件事：
 * 1. 默认折叠，只给统计（共 N 次 / 失败 M / 内部 K），点开才摊开整份；
 * 2. `source=internal` 的行要标「内部」——内部动作以前是黑区；
 * 3. 分页「加载更多」把 offset 往下推，不清掉已加载的行；
 * 4. 没有轨迹文件时整块不占版面（任务正常跑完也可能没有）。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({ api: { toolCalls: vi.fn() } }));
vi.mock('@/services/api', () => ({ taskApi: api }));

import { TaskToolTrace } from './TaskToolTrace';

function page(over: Record<string, unknown> = {}) {
  return {
    task_id: 'task_1',
    stage: 'edit',
    attempt: 2,
    path: 'J:/Clipwright/_cache/ws/task_1/reports/tool_calls/edit-2.json',
    total: 2,
    offset: 0,
    limit: 200,
    count: 2,
    internal: 1,
    failed: 1,
    items: [
      { tool: 'video_trim', status: 'error', duration_ms: 120, error: 'timeout' },
      { tool: 'mg_generate:title', status: 'ok', source: 'internal' },
    ],
    available: ['edit-1', 'edit-2'],
    ...over,
  };
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('TaskToolTrace', () => {
  it('折叠时只显示统计，点开才列出全部调用', async () => {
    api.toolCalls.mockResolvedValue(page());
    render(<TaskToolTrace taskId="task_1" />);

    const stats = await screen.findByTestId('tool-trace-stats');
    expect(stats.textContent).toContain('共 2 次');
    expect(stats.textContent).toContain('失败 1');
    expect(stats.textContent).toContain('内部 1');
    expect(stats.textContent).toContain('第 2 次尝试');
    expect(screen.queryByText('video_trim')).toBeNull();

    fireEvent.click(screen.getByTestId('tool-trace-toggle'));
    expect(screen.getByText('video_trim')).toBeTruthy();
    const rows = document.querySelectorAll('[data-tool-call]');
    expect(rows.length).toBe(2);
    expect(
      document.querySelector('[data-tool-call="mg_generate:title"]')?.getAttribute('data-internal'),
    ).toBe('1');
    expect(
      document.querySelector('[data-tool-call="video_trim"]')?.getAttribute('data-internal'),
    ).toBe('0');
  });

  it('加载更多带上 offset，并把新页追加在后面', async () => {
    api.toolCalls.mockResolvedValueOnce(page({ total: 3 }));
    api.toolCalls.mockResolvedValueOnce(
      page({
        total: 3,
        offset: 2,
        count: 1,
        items: [{ tool: 'video_concat', status: 'success', duration_ms: 40 }],
      }),
    );
    render(<TaskToolTrace taskId="task_1" pageSize={2} />);
    fireEvent.click(await screen.findByTestId('tool-trace-toggle'));
    fireEvent.click(screen.getByTestId('tool-trace-more'));

    await waitFor(() => expect(api.toolCalls).toHaveBeenCalledTimes(2));
    expect(api.toolCalls.mock.calls[1][1]).toMatchObject({ offset: 2, limit: 2 });
    expect(await screen.findByText('video_concat')).toBeTruthy();
    // 第一页的行还在
    expect(screen.getByText('video_trim')).toBeTruthy();
  });

  it('切阶段/尝试时重新拉第一页', async () => {
    api.toolCalls.mockResolvedValue(page({ available: ['edit-1', 'audio-1'] }));
    render(<TaskToolTrace taskId="task_1" />);
    fireEvent.click(await screen.findByTestId('tool-trace-toggle'));
    fireEvent.click(document.querySelector('[data-stage-pick="edit-1"]')!,);

    await waitFor(() =>
      expect(api.toolCalls).toHaveBeenLastCalledWith('task_1', {
        stage: 'edit',
        attempt: 1,
        limit: 200,
        offset: 0,
      }),
    );
  });

  it('没有轨迹文件时整块不渲染', async () => {
    api.toolCalls.mockResolvedValue(
      page({ total: 0, count: 0, internal: 0, failed: 0, items: [], available: [], path: '' }),
    );
    const { container } = render(<TaskToolTrace taskId="task_1" />);
    await waitFor(() => expect(api.toolCalls).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="tool-trace"]')).toBeNull();
  });

  it('接口失败时如实显示错误，不假装没轨迹', async () => {
    api.toolCalls.mockRejectedValue(new Error('RPC 500'));
    render(<TaskToolTrace taskId="task_1" />);
    expect(await screen.findByTestId('tool-trace-error')).toBeTruthy();
    expect(screen.getByTestId('tool-trace-error').textContent).toContain('RPC 500');
  });
});
