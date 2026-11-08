/**
 * 终态摘要（PRD §5 P1-3）。锁定：reason 文案映射、unfinished 逐项、未知 reason 不冒充失败。
 */

// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import { TaskFinishSummary } from './TaskFinishSummary';

beforeEach(() => { cleanup(); });

describe('TaskFinishSummary', () => {
  it('已知 reason 显示中文，并列出未完成项', () => {
    render(
      <TaskFinishSummary
        status="failed"
        finish={{
          conclusion: '触闸收尾：回合数达到上限 160', reason: 'gate:回合数达到上限 160',
          completed: ['生成时间线'], unfinished: ['degraded:text_motion_weak'],
        }}
      />,
    );
    expect(screen.getByTestId('finish-reason').textContent)
      .toBe('达到运行限制：回合数达到上限 160');
    expect(screen.getByTestId('finish-conclusion').textContent).toContain('触闸收尾');
    expect(screen.getByTestId('finish-completed').textContent).toContain('生成时间线');
    expect(screen.getByTestId('finish-unfinished').textContent).toContain('text_motion_weak');
  });

  it('degradation_unresolved 映射为"仍有降级未处置"', () => {
    render(<TaskFinishSummary status="failed" finish={{
      conclusion: '', reason: 'degradation_unresolved', completed: [], unfinished: ['x'],
    }} />);
    expect(screen.getByTestId('finish-reason').textContent).toBe('仍有降级未处置');
  });

  it('未知 reason 原样标注待适配，不重分类为失败', () => {
    render(<TaskFinishSummary status="done" finish={{
      conclusion: '做完了', reason: 'brand_new_reason', completed: [], unfinished: [],
    }} />);
    expect(screen.getByTestId('task-finish-summary').getAttribute('data-reason'))
      .toBe('brand_new_reason');
    expect(screen.getByTestId('task-finish-summary').textContent).toContain('新终态（待适配）');
    expect(screen.getByTestId('finish-unfinished-empty').textContent).toContain('没有记录未完成事项');
  });

  it('老任务没有 finish 时明说没有收尾详情', () => {
    render(<TaskFinishSummary status="done" finish={null} />);
    expect(screen.getByTestId('task-finish-summary').textContent).toContain('没有保存收尾详情');
  });

  it('运行中不渲染终态块', () => {
    const { container } = render(<TaskFinishSummary status="running" finish={null} />);
    expect(container.querySelector('[data-testid="task-finish-summary"]')).toBeNull();
  });
});
