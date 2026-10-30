// @vitest-environment jsdom
/** 统一时间线视图 + 开关（unified-stream PRD §4.6 / §7 M2 验收）。 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const approvalMock = vi.hoisted(() => ({
  approveExec: vi.fn().mockResolvedValue(undefined),
  rejectExec: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/services/api', () => ({ supervisorApi: approvalMock }));
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { UnifiedTimeline } from './UnifiedTimeline';
import { isUnifiedTimelineEnabled, setUnifiedTimelineEnabled } from './flag';
import { useUnifiedTimelineStore } from '@/stores/unifiedTimelineStore';
import type { TaskEvent } from '@/types/task';

const store = () => useUnifiedTimelineStore.getState();

function ev(seq: number, type: string, detail: Record<string, unknown> = {},
            message = ''): TaskEvent {
  return { seq, type: type as TaskEvent['type'], ts: '', message, detail };
}

describe('UnifiedTimeline 渲染', () => {
  beforeEach(() => {
    store().resetAll();
    cleanup();
  });

  it('空时间线给出引导而不是空白', () => {
    render(<UnifiedTimeline taskId="t1" />);
    expect(screen.getByTestId('unified-timeline-empty').textContent).toContain('还没有');
  });

  it('各类条目都有对应 renderer（消息/思考/工具/阶段/结论）', () => {
    store().applyRequirementMessages('s1', [
      { id: 'm1', role: 'user', content: '做一期数码评测' },
    ]);
    store().applyTaskEvent('t1', ev(1, 'thinking', { round: 1, delta: '先看素材' }));
    store().applyTaskEvent('t1', ev(2, 'tool_call', { tool: 'read_artifact' }));
    store().applyTaskEvent('t1', ev(3, 'step_end', { stage: 'material', status: 'ok' }));
    store().applyTaskEvent('t1', ev(4, 'task_end', { status: 'done', conclusion: '已出片' }));

    render(<UnifiedTimeline taskId="t1" />);
    expect(screen.getByTestId('unified-item-tool').textContent).toContain('read_artifact');
    expect(screen.getByTestId('unified-item-stage').textContent).toContain('material');
    expect(screen.getByTestId('unified-item-task-end').textContent).toContain('done');
    // 思考默认折叠，点开才看到正文
    const thinking = screen.getByTestId('unified-item-reasoning');
    expect(thinking.textContent).toContain('思考（4 字）');
    fireEvent.click(thinking.querySelector('button')!);
    expect(thinking.textContent).toContain('先看素材');
  });

  it('同一事件只出现一次（tool_call + tool_result 合并成一行）', () => {
    store().applyTaskEvent('t1', ev(1, 'tool_call', { tool: 'frame_check' }));
    store().applyTaskEvent('t1', { ...ev(2, 'tool_result',
      { tool: 'frame_check', status: 'ok', duration_ms: 12 }), causation_id: 'seq:1' });
    render(<UnifiedTimeline taskId="t1" />);
    expect(screen.getAllByTestId('unified-item-tool')).toHaveLength(1);
  });

  it('窗口化：超过 100 条只渲染 100 条，可加载更早', () => {
    for (let i = 1; i <= 150; i += 1) {
      store().applyTaskEvent('t1', ev(i, 'narration', {}, `第 ${i} 条`));
    }
    render(<UnifiedTimeline taskId="t1" />);
    const timeline = screen.getByTestId('unified-timeline');
    expect(timeline.getAttribute('data-total')).toBe('150');
    expect(timeline.getAttribute('data-rendered')).toBe('100');
    expect(screen.getByTestId('unified-load-earlier').textContent).toContain('还有 50 条');
    fireEvent.click(screen.getByTestId('unified-load-earlier'));
    expect(screen.getByTestId('unified-timeline').getAttribute('data-rendered')).toBe('150');
  });

  it('scope 隔离：只渲染指定 taskId 的条目', () => {
    store().applyTaskEvent('t1', ev(1, 'narration', {}, '任务一'));
    store().applyTaskEvent('t2', ev(1, 'narration', {}, '任务二'));
    render(<UnifiedTimeline taskId="t1" />);
    expect(screen.getByTestId('unified-timeline').textContent).toContain('任务一');
    expect(screen.getByTestId('unified-timeline').textContent).not.toContain('任务二');
  });
});

describe('feature flag（可回退）', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState({}, '', '/');
  });

  it('默认关闭（旧分区视图）', () => {
    expect(isUnifiedTimelineEnabled()).toBe(false);
  });

  it('localStorage 打开', () => {
    setUnifiedTimelineEnabled(true);
    expect(isUnifiedTimelineEnabled()).toBe(true);
    setUnifiedTimelineEnabled(false);
    expect(isUnifiedTimelineEnabled()).toBe(false);
  });

  it('URL 参数优先于 localStorage（线上应急用）', () => {
    setUnifiedTimelineEnabled(true);
    window.history.replaceState({}, '', '/?unifiedTimeline=0');
    expect(isUnifiedTimelineEnabled()).toBe(false);
    window.history.replaceState({}, '', '/?unifiedTimeline=1');
    setUnifiedTimelineEnabled(false);
    expect(isUnifiedTimelineEnabled()).toBe(true);
  });
});
describe('M4：DOM 有界与滚动分页', () => {
  beforeEach(() => {
    store().resetAll();
    cleanup();
  });

  it('2000 条事件下 DOM 有界（≤ 窗口条数），滚动到顶自动增页', () => {
    for (let i = 1; i <= 2000; i += 1) {
      store().applyTaskEvent('t1', ev(i, 'narration', {}, `第 ${i} 条`));
    }
    render(<UnifiedTimeline taskId="t1" />);
    const timeline = () => screen.getByTestId('unified-timeline');
    expect(timeline().getAttribute('data-total')).toBe('2000');
    expect(Number(timeline().getAttribute('data-rendered'))).toBe(100);
    // DOM 节点数远小于总条数（这就是"不出长任务"的前提）
    expect(timeline().querySelectorAll('[data-testid^="unified-item-"]').length).toBe(100);

    // 滚到顶 → 自动 +100
    fireEvent.scroll(timeline(), { target: { scrollTop: 0 } });
    expect(Number(timeline().getAttribute('data-rendered'))).toBe(200);
  });

  it('40 万字思考不会一次性塞进 DOM（默认折叠，点开才渲染正文）', () => {
    const big = '思'.repeat(400_000);
    store().applyTaskEvent('t1', ev(1, 'thinking', { round: 1, delta: big }));
    render(<UnifiedTimeline taskId="t1" />);
    const row = screen.getByTestId('unified-item-reasoning');
    expect(row.textContent).toContain('400,000 字');
    expect(row.querySelector('pre')).toBeNull();     // 折叠状态不渲染正文
    fireEvent.click(row.querySelector('button')!);
    expect(row.querySelector('pre')?.textContent?.length).toBe(400_000);
  });
});
describe('M3 收尾：授权条目可操作', () => {
  beforeEach(() => {
    store().resetAll();
    cleanup();
    approvalMock.approveExec.mockClear();
    approvalMock.rejectExec.mockClear();
  });

  it('待授权条目给出「授权 / 拒绝」，点击调用对应接口并回显结果', async () => {
    store().applyTaskEvent('t1', ev(1, 'approval_request', {
      approval_id: 'ap1', risk: 'low', tool: 'run_shell',
    }));
    render(<UnifiedTimeline taskId="t1" />);
    const row = screen.getByTestId('unified-item-approval');
    expect(row.textContent).toContain('run_shell');

    fireEvent.click(row.querySelector('[data-approval-approve="ap1"]')!);
    await waitFor(() => expect(approvalMock.approveExec).toHaveBeenCalledTimes(1));
    await screen.findByTestId('unified-approval-note');

    const reject = row.querySelector('[data-approval-reject="ap1"]');
    if (reject) {
      fireEvent.click(reject);
      await waitFor(() => expect(approvalMock.rejectExec).toHaveBeenCalledTimes(1));
    }
  });

  it('已结算的授权不再给按钮（不重复提交）', () => {
    store().applyTaskEvent('t1', ev(1, 'approval_request', { approval_id: 'ap2', risk: 'low' }));
    store().applyTaskEvent('t1', ev(2, 'approval_result', { approval_id: 'ap2', status: 'approved' }));
    render(<UnifiedTimeline taskId="t1" />);
    const row = screen.getByTestId('unified-item-approval');
    expect(row.querySelector('[data-approval-approve="ap2"]')).toBeNull();
    expect(row.textContent).toContain('approved');
  });

  it('产物条目显示路径与字数（不再落 log）', () => {
    store().applyTaskEvent('t1', ev(1, 'artifact', {
      path: 'reports/03-edit-1.md', chars: 1234,
    }));
    render(<UnifiedTimeline taskId="t1" />);
    const row = screen.getByTestId('unified-item-artifact');
    expect(row.textContent).toContain('03-edit-1.md');
    expect(row.textContent).toContain('1234 字');
    expect(screen.queryByTestId('unified-item-log')).toBeNull();
  });
});
