// @vitest-environment jsdom
/**
 * F02：报告视图（v2 DTO）。
 * - 无摘要/正文不可读/协议错误必须**可见区分**；
 * - 自由正文按 offset 续读，追加而不是覆盖；
 * - 读取失败显式报错，不显示成空正文。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ reports: vi.fn(), report: vi.fn(), docs: vi.fn() }));

vi.mock('@/services/api', () => ({
  workspaceApi: {
    docs: mocks.docs,
    reports: mocks.reports,
    report: mocks.report,
  },
}));

import { CopilotDocsTab } from './CopilotDocsTab';

function reportItem(over: Record<string, unknown>) {
  return {
    schema_version: 2,
    seq: 1,
    run_id: 'run_1',
    task_id: 'task_1',
    stage: 'edit',
    status: 'ok',
    attempt: 1,
    path: 'reports/01-edit-1.md',
    summary: '剪辑完成',
    handoff_summary: '',
    report_state: 'written',
    cost_usd: 0,
    cost_unknown: false,
    created_at: '',
    ...over,
  };
}

const body = {
  project_id: 'p1',
  schema_version: 2,
  seq: 1,
  run_id: 'run_1',
  stage: 'edit',
  path: 'reports/01-edit-1.md',
  total_chars: 6,
  offset: 0,
  next_offset: 3,
  truncated: true,
  report_state: 'written',
  content: '第一段',
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('CopilotDocsTab 报告视图（F02）', () => {
  it('区分 正文不可读 / 协议错误 / 摘要', async () => {
    mocks.docs.mockResolvedValue({ docs: [] });
    mocks.reports.mockResolvedValue({
      reports: [
        reportItem({ seq: 1 }),
        reportItem({ seq: 2, summary: '', report_state: 'unavailable' }),
        reportItem({ seq: 3, schema_version: 1 }),
      ],
    });
    render(<CopilotDocsTab projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/#1/)).toBeTruthy());
    expect(screen.getByText(/#2.*正文不可读/)).toBeTruthy();
    expect(screen.getByText(/#3.*协议错误/)).toBeTruthy();
  });

  it('自由正文按 offset 续读并追加', async () => {
    mocks.docs.mockResolvedValue({ docs: [] });
    mocks.reports.mockResolvedValue({ reports: [reportItem({ seq: 1 })] });
    mocks.report
      .mockResolvedValueOnce(body)
      .mockResolvedValueOnce({ ...body, offset: 3, next_offset: null, truncated: false, content: '第二段' });

    render(<CopilotDocsTab projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/#1/)).toBeTruthy());
    fireEvent.click(screen.getByText(/#1/));
    await waitFor(() => expect(screen.getByText('第一段')).toBeTruthy());

    fireEvent.click(screen.getByTestId('docs-report-more'));
    await waitFor(() => expect(screen.getByText('第一段第二段')).toBeTruthy());
    expect(mocks.report).toHaveBeenLastCalledWith('p1', 1, { offset: 3 });
  });

  it('读取失败显示可见错误而不是空正文', async () => {
    mocks.docs.mockResolvedValue({ docs: [] });
    mocks.reports.mockResolvedValue({ reports: [reportItem({ seq: 1 })] });
    mocks.report.mockRejectedValue(new Error('boom'));

    render(<CopilotDocsTab projectId="p1" />);
    await waitFor(() => expect(screen.getByText(/#1/)).toBeTruthy());
    fireEvent.click(screen.getByText(/#1/));
    await waitFor(() => {
      expect(screen.getByTestId('docs-report-error').textContent).toContain('读取失败');
    });
  });
});
