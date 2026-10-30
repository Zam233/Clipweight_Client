/**
 * 问题卡（PRD §15.7）。锁定：从事件重建、选项/自由文本、倒计时、错误按码分流、
 * 已回答剔除、失效禁用、无障碍标记。
 */

// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { api } = vi.hoisted(() => ({
  api: { answer: vi.fn(), questions: vi.fn() },
}));
vi.mock('@/services/api', () => ({ taskApi: api }));

import { TaskQuestionCard } from './TaskQuestionCard';
import type { TaskEvent } from '@/types/task';

const deadline = Math.floor(Date.now() / 1000) + 600;

const questionEvent = (qid: string, extra: Record<string, unknown> = {}): TaskEvent => ({
  seq: 1, type: 'question', ts: '', message: '选哪个？',
  detail: {
    question_id: qid, question: '这段动画采用哪种视觉风格？',
    options: [{ id: 'S3', label: 'S3 极简几何' }, { id: 'S4', label: 'S4 图表生长' }],
    allow_free_text: true, default_option_id: 'S3', timeout_sec: 1800, deadline_at: deadline,
    context_refs: ['reports/07-animation-2.md'],
    ...extra,
  },
});

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  api.questions.mockResolvedValue({ task_id: 't1', status: 'pending', count: 0, items: [] });
});

describe('TaskQuestionCard', () => {
  it('从 question 事件重建问题卡，显示选项/倒计时/依据', async () => {
    render(<TaskQuestionCard taskId="t1" events={[questionEvent('q1')]} />);
    expect(await screen.findByTestId('task-question-card')).toBeTruthy();
    expect(screen.getByTestId('task-question-prompt').textContent)
      .toContain('这段动画采用哪种视觉风格');
    expect(document.querySelector('[data-question-option="S3"]')).toBeTruthy();
    expect(document.querySelector('[data-question-option="S4"]')).toBeTruthy();
    expect(screen.getByTestId('task-question-card').textContent).toContain('（超时默认）');
    expect(document.querySelector('[data-question-countdown="q1"]')?.textContent)
      .toContain('剩余');
    expect(screen.getByTestId('task-question-card').textContent).toContain('依据 1 项');
  });

  it('点选项即提交，成功后显示回执并禁用交互', async () => {
    api.answer.mockResolvedValue({
      task_id: 't1', question_id: 'q1', status: 'accepted', task_status: 'running',
      option_id: 'S4',
    });
    render(<TaskQuestionCard taskId="t1" events={[questionEvent('q1')]} />);
    await screen.findByTestId('task-question-card');

    fireEvent.click(document.querySelector('[data-question-option="S4"]')!);
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith('t1', {
      questionId: 'q1', optionId: 'S4', text: null,
    }));
    await waitFor(() =>
      expect(document.querySelector('[data-question-receipt="q1"]')?.textContent)
        .toContain('S4'));
    // 回执留在原位；但不能再点（避免重复提交）
    const opt = document.querySelector('[data-question-option="S3"]') as HTMLButtonElement;
    expect(opt.disabled).toBe(true);
    expect(document.querySelector('[data-question-status="answered"]')).toBeTruthy();
  });

  it('自由文本走 text，空提交在本地被拦', async () => {
    api.answer.mockResolvedValue({ task_id: 't1', question_id: 'q1', status: 'accepted',
      task_status: 'running' });
    render(<TaskQuestionCard taskId="t1" events={[questionEvent('q1')]} />);
    await screen.findByTestId('task-question-card');

    fireEvent.click(document.querySelector('[data-question-submit="q1"]')!);
    expect(screen.getByTestId('task-question-card').textContent).toContain('请选择一项');
    expect(api.answer).not.toHaveBeenCalled();

    fireEvent.change(document.querySelector('[data-question-free-text="q1"]')!,
      { target: { value: '用 S10 水墨' } });
    fireEvent.click(document.querySelector('[data-question-submit="q1"]')!);
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith('t1', {
      questionId: 'q1', optionId: null, text: '用 S10 水墨',
    }));
  });

  it('键盘 1/2/3 选中前三个选项', async () => {
    api.answer.mockResolvedValue({ task_id: 't1', question_id: 'q1', status: 'accepted',
      task_status: 'running' });
    render(<TaskQuestionCard taskId="t1" events={[questionEvent('q1')]} />);
    await screen.findByTestId('task-question-card');
    const group = document.querySelector('[data-question-id="q1"]')!;
    fireEvent.keyDown(group, { key: '2' });
    await waitFor(() => expect(api.answer).toHaveBeenCalledWith('t1', {
      questionId: 'q1', optionId: 'S4', text: null,
    }));
  });

  it('409 已回答 → 直接标记已回答，不报错', async () => {
    api.answer.mockRejectedValue({
      response: { status: 409, data: { detail: { reason: 'already_answered' } } },
    });
    render(<TaskQuestionCard taskId="t1" events={[questionEvent('q2')]} />);
    await screen.findByTestId('task-question-card');
    fireEvent.click(document.querySelector('[data-question-option="S3"]')!);
    await waitFor(() =>
      expect(document.querySelector('[data-question-receipt="q2"]')?.textContent)
        .toContain('已回答'));
  });

  it('410 失效 → 显示失效原因并保留卡片', async () => {
    api.answer.mockRejectedValue({
      response: { status: 410, data: { detail: { reason: 'question_expired' } } },
    });
    render(<TaskQuestionCard taskId="t1" events={[questionEvent('q3')]} />);
    await screen.findByTestId('task-question-card');
    fireEvent.click(document.querySelector('[data-question-option="S3"]')!);
    const err = await screen.findByTestId('task-question-error');
    expect(err.textContent).toContain('该问题已失效');
    expect(screen.getByTestId('task-question-card')).toBeTruthy();
  });

  it('已有 answer 事件的问题不再显示', async () => {
    const answered: TaskEvent = {
      seq: 2, type: 'answer', ts: '', message: '已回答',
      detail: { question_id: 'q4', option_id: 'S3', source: 'user_option' },
    };
    const { container } = render(
      <TaskQuestionCard taskId="t1" events={[questionEvent('q4'), answered]} />,
    );
    await waitFor(() => expect(api.questions).toHaveBeenCalled());
    expect(container.querySelector('[data-testid="task-question-card"]')).toBeNull();
  });

  it('合并 /questions 返回的待答项（刷新后恢复）', async () => {
    api.questions.mockResolvedValue({
      task_id: 't1', status: 'pending', count: 1,
      items: [{ question_id: 'q5', question: '重启后仍在等的问题', options: [
        { id: 'a', label: 'A' }, { id: 'b', label: 'B' }], allow_free_text: false }],
    });
    render(<TaskQuestionCard taskId="t1" events={[]} />);
    expect(await screen.findByTestId('task-question-prompt')).toBeTruthy();
    expect(screen.getByTestId('task-question-prompt').textContent).toContain('重启后仍在等的问题');
  });
});
