// @vitest-environment jsdom
/**
 * B12（2026-10-28 PRD / 缺口 N5–N8）：事件呈现收口。
 *
 * - N6：tool_call ↔ tool_result 按 `causation_id` 配对（同名并发不串台），
 *   老数据回落按名配对时行上标明；
 * - N7：EventFeed 不再二次截断（store 400 → 页面全量渲染），达到上限时明说；
 * - N8：doc_write/report/context_loaded 的 detail 可展开，产物路径可复制。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { pairToolCalls } from './CopilotTaskRunTab';
import { EventFeed } from '@/features/task/EventFeed';
import { toTaskEvent } from '@/features/task/useTaskEvents';
import { MAX_TASK_EVENTS } from '@/stores/taskStore';
import type { TaskEvent } from '@/types/task';

afterEach(cleanup);

const ev = (
  seq: number,
  type: TaskEvent['type'],
  detail: Record<string, unknown> = {},
  extra: Partial<TaskEvent> = {},
): TaskEvent => ({ seq, type, ts: '', message: '', detail, ...extra });

describe('B12 / N6：工具调用按 causation_id 配对', () => {
  it('同名并发调用各配各的结果（不串台）', () => {
    const events: TaskEvent[] = [
      ev(1, 'tool_call', { tool: 'local_probe', args: { n: 1 } }),
      ev(2, 'tool_call', { tool: 'local_probe', args: { n: 2 } }),
      // 后发先回：seq2 的结果先到
      ev(3, 'tool_result', { tool: 'local_probe', status: 'error', error: '二号失败', duration_ms: 20 },
        { causation_id: 'seq:2' }),
      ev(4, 'tool_result', { tool: 'local_probe', status: 'ok', duration_ms: 10 },
        { causation_id: 'seq:1' }),
    ];
    const rows = pairToolCalls(events);
    expect(rows).toHaveLength(2);
    const first = rows.find((r) => r.seq === 1)!;
    const second = rows.find((r) => r.seq === 2)!;
    expect(first.status).toBe('ok');
    expect(first.ms).toBe(10);
    expect(second.status).toBe('error');
    expect(second.error).toBe('二号失败');
    expect(rows.every((r) => r.paired === 'causation')).toBe(true);
  });

  it('老事件没有 causation_id → 按名 FIFO 回落，并标 paired=name', () => {
    const events: TaskEvent[] = [
      ev(1, 'tool_call', { tool: 'frame_check' }),
      ev(2, 'tool_result', { tool: 'frame_check', status: 'ok', duration_ms: 5 }),
    ];
    const rows = pairToolCalls(events);
    expect(rows).toHaveLength(1);
    expect(rows[0].paired).toBe('name');
  });
});

describe('B12 / N7：EventFeed 不再二次截断', () => {
  it('200 条事件全量渲染（旧实现只显示最后 120 条）', () => {
    const events: TaskEvent[] = Array.from({ length: 200 }, (_, i) =>
      ev(i + 1, 'tool_result', { tool: 'x', status: 'ok' }, { message: `第 ${i + 1} 条` }));
    render(<EventFeed events={events} />);
    const items = screen.getByRole('list', { name: '调用记录' }).querySelectorAll('li');
    expect(items).toHaveLength(200);
    expect(screen.getByText('第 1 条')).toBeTruthy();
    expect(screen.queryByTestId('event-feed-cap')).toBeNull();
  });

  it('达到 store 上限时明说被丢弃（不假装完整）', () => {
    const events: TaskEvent[] = Array.from({ length: MAX_TASK_EVENTS }, (_, i) =>
      ev(i + 1, 'tool_result', { tool: 'x', status: 'ok' }, { message: `m${i + 1}` }));
    render(<EventFeed events={events} />);
    expect(screen.getByTestId('event-feed-cap').textContent).toContain(String(MAX_TASK_EVENTS));
  });

  it('checkpoint 内容默认折叠（不算"隐藏"，行还在）', () => {
    render(<EventFeed events={[ev(1, 'checkpoint', { a: 1 }, { message: 'ckpt' }),
      ev(2, 'tool_result', { tool: 'x', status: 'ok' }, { message: '真实记录' })]} />);
    expect(screen.queryByText('ckpt')).toBeNull();
    expect(screen.getByText('真实记录')).toBeTruthy();
  });

  it('PRD B5：checkpoint 不再被丢弃，改为默认折叠（行在、内容点开才看）', () => {
    render(<EventFeed events={[ev(1, 'checkpoint', { stage: 'checksum', bytes: 12 },
      { message: '检查点已保存' })]} />);
    // 行存在（不再整行过滤）
    const row = document.querySelector('[data-event-type="checkpoint"]');
    expect(row).toBeTruthy();
    // 内容默认折叠
    expect(screen.queryByText('检查点已保存')).toBeNull();
    // 点开可见，且 detail 也能展开
    fireEvent.click(screen.getByRole('button', { name: /详情/ }));
    expect(screen.getByText('检查点已保存')).toBeTruthy();
  });
});

describe('B12 / N8：结构化详情与产物路径', () => {
  it('doc_write 可展开 detail 并显示产物路径', () => {
    const events: TaskEvent[] = [ev(7, 'doc_write', {
      path: 'J:/ws/proj/docs/script.md', chars: 8400,
    }, { message: '写入 docs/script.md' })];
    render(<EventFeed events={events} />);

    const pathBtn = screen.getByTitle('复制路径');
    expect(pathBtn.getAttribute('data-event-path')).toBe('J:/ws/proj/docs/script.md');

    fireEvent.click(screen.getByRole('button', { name: /详情/ }));
    const detail = document.querySelector('[data-event-detail]') as HTMLElement;
    expect(detail.textContent).toContain('"chars": 8400');
  });

  it('report / context_loaded 也能展开（trimmed 是数组）', () => {
    render(<EventFeed events={[ev(9, 'context_loaded', {
      sources: [{ name: 'script', chars: 8400 }],
      trimmed: ['reports'],
    }, { message: '上下文已装载' })]} />);
    fireEvent.click(screen.getByRole('button', { name: /详情/ }));
    const detail = document.querySelector('[data-event-detail]') as HTMLElement;
    expect(detail.textContent).toContain('"trimmed"');
    expect(detail.textContent).toContain('reports');
  });

  it('没有 detail 的事件不显示「详情」按钮', () => {
    render(<EventFeed events={[ev(1, 'tool_result', {}, { message: '空 detail' })]} />);
    expect(screen.queryByRole('button', { name: /详情/ })).toBeNull();
  });
});

describe('B12：toTaskEvent 保留 trace 信封字段', () => {
  it('causation_id / run_id 不被丢掉（否则配对与 run 视图都瞎）', () => {
    const parsed = toTaskEvent({
      seq: 3, type: 'tool_result', message: 'm', detail: {},
      causation_id: 'seq:2', run_id: 'run_1', span: 'tool',
    });
    expect(parsed?.causation_id).toBe('seq:2');
    expect(parsed?.run_id).toBe('run_1');
    expect(parsed?.span).toBe('tool');
  });

  it('缺字段时不硬塞空串（保持旧形状）', () => {
    const parsed = toTaskEvent({ seq: 1, type: 'task_start', message: 'm', detail: {} });
    expect(parsed === null || parsed.causation_id === undefined).toBe(true);
    expect(vi.isMockFunction(parsed ?? (() => {}))).toBe(false);
  });
});
