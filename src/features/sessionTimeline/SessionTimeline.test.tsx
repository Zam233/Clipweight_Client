// @vitest-environment jsdom
/**
 * 会话时间线 UI（PRD docs/ux-and-bug-audit-prd-2026-11-09.md §5，T-01～T-08）。
 *
 * 只钉用户可见行为，不钉实现：滚动事件 → 请求次数 / 锚点位置 / 是否跟随、
 * 按钮锁定、枚举文案、对象字段不炸、空态文案、加载更早文案、思考折叠。
 *
 * 仓库 vitest 不自动 cleanup，所以 beforeEach / afterEach 都显式 cleanup。
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { SessionTimeline } from './SessionTimeline';
import type { SessionTimelineItem } from './types';

const SESSION = 's1';

const h = vi.hoisted(() => {
  const state: {
    bySession: Record<string, Record<number, unknown>>;
    link: Record<string, string>;
    lastError: Record<string, string>;
    backfilled: Record<string, number>;
    hasMore: Record<string, boolean>;
    latestSeq: Record<string, number>;
  } = {
    bySession: {}, link: {}, lastError: {}, backfilled: {}, hasMore: {}, latestSeq: {},
  };
  const listeners = new Set<() => void>();
  return {
    state,
    subscribe: (cb: () => void) => {
      listeners.add(cb);
      return () => { listeners.delete(cb); };
    },
    emit: () => { for (const l of Array.from(listeners)) l(); },
    loadEarlier: vi.fn(() => Promise.resolve(true)),
    useSessionTimeline: vi.fn(() => undefined),
    useRetrySessionTimeline: vi.fn(() => () => undefined),
  };
});

// 用 useSyncExternalStore 做最小 store 替身：改 state + emit 就能驱动真实重渲染。
vi.mock('@/stores/sessionTimelineStore', async () => {
  const { useSyncExternalStore } = await import('react');
  function useStore<T>(selector: (s: unknown) => T): T {
    return useSyncExternalStore(h.subscribe, () => selector(h.state), () => selector(h.state));
  }
  (useStore as unknown as { getState: () => unknown }).getState = () => h.state;
  return {
    EMPTY_BUCKET: Object.freeze({}),
    itemsOf: (bucket?: Record<number, unknown>): unknown[] =>
      bucket
        ? Object.keys(bucket).map(Number).sort((a, b) => a - b).map((seq) => bucket[seq])
        : [],
    useSessionTimelineStore: useStore,
  };
});

vi.mock('@/features/sessionTimeline/useSessionTimeline', () => ({
  loadEarlier: h.loadEarlier,
  useSessionTimeline: h.useSessionTimeline,
  useRetrySessionTimeline: h.useRetrySessionTimeline,
}));

vi.mock('@/features/copilot/artifactOpen', () => ({ handleArtifactClick: vi.fn() }));

const { supervisorApi } = vi.hoisted(() => ({
  supervisorApi: { approveExec: vi.fn(() => Promise.resolve()), rejectExec: vi.fn(() => Promise.resolve()) },
}));
vi.mock('@/services/api', () => ({ supervisorApi }));

type ItemOver = Partial<SessionTimelineItem>;

function item(seq: number, over: ItemOver = {}): SessionTimelineItem {
  return {
    seq, type: 'content', time: '', turn: null, state: 'done',
    source: 'requirements', ref: null, content_ref: null, content_inline: null,
    meta: {}, content: '',
    ...over,
  };
}

function configure(over: {
  items?: SessionTimelineItem[];
  link?: string;
  error?: string;
  backfilled?: number;
  hasMore?: boolean;
} = {}): void {
  for (const k of Object.keys(h.state.bySession)) delete h.state.bySession[k];
  for (const k of Object.keys(h.state.link)) delete h.state.link[k];
  for (const k of Object.keys(h.state.lastError)) delete h.state.lastError[k];
  for (const k of Object.keys(h.state.backfilled)) delete h.state.backfilled[k];
  for (const k of Object.keys(h.state.hasMore)) delete h.state.hasMore[k];
  for (const k of Object.keys(h.state.latestSeq)) delete h.state.latestSeq[k];

  const bucket: Record<number, unknown> = {};
  for (const it of over.items ?? []) bucket[it.seq] = it;
  h.state.bySession[SESSION] = bucket;
  h.state.link[SESSION] = over.link ?? 'live';
  h.state.lastError[SESSION] = over.error ?? '';
  h.state.backfilled[SESSION] = over.backfilled ?? 0;
  h.state.hasMore[SESSION] = over.hasMore ?? false;
  h.state.latestSeq[SESSION] = 0;
}

function renderTimeline(props: Partial<React.ComponentProps<typeof SessionTimeline>> = {}) {
  return render(<SessionTimeline sessionId={SESSION} {...props} />);
}

type Geom = { top: number; height: number; client: number };

/** jsdom 不做布局：把三个滚动量变成可控的读写属性。 */
function installGeometry(el: HTMLElement, init: Partial<Geom> = {}): Geom {
  const g: Geom = {
    top: init.top ?? 0, height: init.height ?? 1000, client: init.client ?? 400,
  };
  Object.defineProperty(el, 'scrollTop', {
    configurable: true, get: () => g.top, set: (v: number) => { g.top = v; },
  });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => g.height });
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => g.client });
  return g;
}

/** 同一批连续 scroll 事件：一个 act 内派发，React 不会在中途重渲染。 */
function scrollBurst(el: HTMLElement, times: number): void {
  act(() => {
    for (let i = 0; i < times; i += 1) el.dispatchEvent(new Event('scroll'));
  });
}

function thinkingRow(seq: number): HTMLElement {
  return screen.getByTestId('session-timeline').querySelector(`[data-seq="${seq}"]`) as HTMLElement;
}

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  h.loadEarlier.mockReset();
  h.loadEarlier.mockResolvedValue(true);
  h.useSessionTimeline.mockReturnValue(undefined);
  h.useRetrySessionTimeline.mockReturnValue(() => undefined);
  supervisorApi.approveExec.mockReset();
  supervisorApi.approveExec.mockResolvedValue(undefined);
  supervisorApi.rejectExec.mockReset();
  supervisorApi.rejectExec.mockResolvedValue(undefined);
  configure();
});

afterEach(() => { cleanup(); });

describe('SessionTimeline · T-01 顶部加载历史', () => {
  it('连续 3 次顶部 scroll 只触发一次 loadEarlier', () => {
    configure({ items: [item(1), item(2), item(3)], hasMore: true });
    h.loadEarlier.mockImplementation(() => new Promise<boolean>(() => {}));
    renderTimeline();
    const scroller = screen.getByTestId('session-timeline');
    installGeometry(scroller, { top: 0, height: 1000, client: 400 });

    scrollBurst(scroller, 3);

    expect(h.loadEarlier).toHaveBeenCalledTimes(1);
  });

  it('prepend 后用 scrollHeight 差值补偿 scrollTop（锚点稳定）', async () => {
    const base = [item(4), item(5), item(6)];
    configure({ items: base, hasMore: true });
    renderTimeline();
    const scroller = screen.getByTestId('session-timeline');
    const g = installGeometry(scroller, { top: 0, height: 1000, client: 400 });

    // 服务端翻页返回：顶部插入 3 条，内容整体长高 300px。
    h.loadEarlier.mockImplementation(() => {
      const bucket: Record<number, unknown> = { 1: item(1), 2: item(2), 3: item(3) };
      for (const it of base) bucket[it.seq] = it;
      h.state.bySession[SESSION] = bucket;
      g.height = 1300;
      return Promise.resolve(true);
    });

    await act(async () => {
      fireEvent.scroll(scroller);
      await Promise.resolve();
      h.emit();
      await Promise.resolve();
    });

    await waitFor(() => expect(h.loadEarlier).toHaveBeenCalledTimes(1));
    expect(g.top).toBe(300);
  });
});

describe('SessionTimeline · T-02 流式跟随', () => {
  it('用户停在底部时，最后一条文本增长仍滚到底', async () => {
    configure({ items: [item(1, { type: 'thinking', state: 'streaming', content: '思考中' })] });
    renderTimeline();
    const scroller = screen.getByTestId('session-timeline');
    const g = installGeometry(scroller, { top: 600, height: 1000, client: 400 });

    await act(async () => { fireEvent.scroll(scroller); });
    expect(g.top).toBe(600); // 1000 - 600 - 400 = 0 < 120 → 用户处于底部

    g.height = 1400;
    await act(async () => {
      h.state.bySession[SESSION] = {
        1: item(1, { type: 'thinking', state: 'streaming', content: '思考中'.repeat(50) }),
      };
      h.emit();
    });

    expect(g.top).toBe(1400);
  });

  it('用户上滑离底时，最后一条文本增长不抢滚动位置', async () => {
    configure({ items: [item(1, { type: 'thinking', state: 'streaming', content: '思考中' })] });
    renderTimeline();
    const scroller = screen.getByTestId('session-timeline');
    const g = installGeometry(scroller, { top: 300, height: 1000, client: 400 });

    await act(async () => { fireEvent.scroll(scroller); });
    expect(g.top).toBe(300); // 1000 - 300 - 400 = 300 ≥ 120 → 离底

    g.height = 1400;
    await act(async () => {
      h.state.bySession[SESSION] = {
        1: item(1, { type: 'thinking', state: 'streaming', content: '思考中'.repeat(50) }),
      };
      h.emit();
    });

    expect(g.top).toBe(300);
  });
});

describe('SessionTimeline · T-03 提交后锁定按钮', () => {
  it('提问提交成功后所有按钮消失，只保留结果，不能重复提交', async () => {
    const onAnswer = vi.fn(() => Promise.resolve());
    configure({
      items: [item(1, {
        type: 'question',
        meta: { question_id: 'q1' },
        content: {
          question: '选哪个？',
          options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }],
          allow_free_text: true,
        },
      })],
    });
    renderTimeline({ onAnswerQuestion: onAnswer });

    fireEvent.click(document.querySelector('[data-question-option="a"]')!);

    await waitFor(() => expect(onAnswer).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('session-question-actions').textContent).toContain('已提交'));
    expect(document.querySelector('[data-question-option="a"]')).toBeNull();
    expect(document.querySelector('[data-question-option="b"]')).toBeNull();
    expect(document.querySelector('[data-testid="session-question-submit"]')).toBeNull();
    fireEvent.click(screen.getByTestId('session-question-actions'));
    expect(onAnswer).toHaveBeenCalledTimes(1);
  });

  it('服务端 answer 条目到达后由 answeredQids 兜底，问题入口不再渲染', async () => {
    configure({
      items: [item(1, {
        type: 'question', meta: { question_id: 'q1' },
        content: { question: '选哪个？', options: [{ id: 'a', label: 'A' }] },
      })],
    });
    renderTimeline({ onAnswerQuestion: vi.fn(() => Promise.resolve()) });
    expect(screen.getByTestId('session-question-actions')).toBeTruthy();

    await act(async () => {
      h.state.bySession[SESSION] = {
        1: item(1, {
          type: 'question', meta: { question_id: 'q1' },
          content: { question: '选哪个？', options: [{ id: 'a', label: 'A' }] },
        }),
        2: item(2, { type: 'answer', meta: { question_id: 'q1' }, content: 'A' }),
      };
      h.emit();
    });

    expect(screen.queryByTestId('session-question-actions')).toBeNull();
    expect(screen.getByTestId('session-item-question').getAttribute('data-answered')).toBe('1');
  });

  it('授权提交成功后锁定该条目所有按钮，只留结果', async () => {
    configure({
      items: [item(1, {
        type: 'approval',
        meta: { task_id: 't1', approval_id: 'a1', tool: 'run_cmd', status: 'pending', risk: 'low' },
      })],
    });
    renderTimeline();

    fireEvent.click(document.querySelector('[data-approval-approve="a1"]')!);

    await waitFor(() => expect(supervisorApi.approveExec).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(screen.getByTestId('session-item-approval').textContent).toContain('已授权'));
    expect(document.querySelector('[data-approval-approve="a1"]')).toBeNull();
    expect(document.querySelector('[data-approval-reject="a1"]')).toBeNull();
    expect(supervisorApi.rejectExec).not.toHaveBeenCalled();
  });
});

describe('SessionTimeline · T-04 / T-05 文案与渲染边界', () => {
  it('原始枚举映射中文，未知值显示「其他」且 title 保留原值', () => {
    configure({
      items: [
        item(1, {
          type: 'approval',
          meta: { status: 'pending', risk: 'high', tool: 'run_cmd', task_id: 't1', approval_id: 'a1' },
        }),
        item(2, { type: 'tool', meta: { status: 'ok' } }),
        item(3, { type: 'stage', meta: { status: 'weird_status', stage: 'edit' } }),
        item(4, { type: 'mystery' as SessionTimelineItem['type'], content: 'x' }),
      ],
    });
    renderTimeline();

    const text = screen.getByTestId('session-timeline').textContent ?? '';
    expect(text).toContain('待处理');
    expect(text).toContain('高风险');
    expect(text).toContain('成功');
    expect(text).toContain('其他');
    expect(text).not.toContain('pending');
    expect(text).not.toContain('risk=');
    expect(text).not.toContain('weird_status');
    expect(screen.getByTitle('weird_status')).toBeTruthy();
    expect(screen.getByTitle('mystery')).toBeTruthy();
  });

  it('模型/接口字段是对象时不抛 React child 错误，也不显示 [object Object]', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    configure({
      items: [
        item(1, {
          type: 'question',
          meta: { question_id: 'q1', question: { name: '模型问题' } } as unknown as
            SessionTimelineItem['meta'],
          content: {
            question: { name: '模型问题' },
            options: [{ id: { name: 'opt' }, label: { name: '选项' } }],
          },
        }),
        item(2, {
          type: 'tool',
          meta: { tool: { name: 'wrench' }, status: { code: 'ok' } } as unknown as
            SessionTimelineItem['meta'],
        }),
      ],
    });

    expect(() => renderTimeline()).not.toThrow();
    const text = screen.getByTestId('session-timeline').textContent ?? '';
    expect(text).toContain('name');
    expect(text).not.toContain('[object Object]');
    expect(err.mock.calls.flat().join(' ')).not.toContain('Objects are not valid as a React child');
    err.mockRestore();
  });
});

describe('SessionTimeline · T-06 重连空态', () => {
  it("link==='retry' 显示「正在重连…」，不落到「还没有记录」", () => {
    configure({ items: [], link: 'retry' });
    renderTimeline();

    const empty = screen.getByTestId('session-timeline-empty');
    expect(empty.textContent).toContain('正在重连…');
    expect(empty.textContent).not.toContain('还没有记录');
    expect(empty.querySelector('[data-empty="retry"]')).toBeTruthy();
  });
});

describe('SessionTimeline · T-07 加载更早文案', () => {
  it('hidden=0 但 hasMore 为真时只显示「加载更早记录」', () => {
    configure({ items: [item(1), item(2), item(3)], hasMore: true });
    renderTimeline();

    const btn = screen.getByTestId('session-load-earlier');
    expect(btn.textContent).toBe('加载更早记录');
    expect(btn.textContent).not.toContain('0 条');
  });
});

describe('SessionTimeline · T-08 思考折叠', () => {
  it('历史思考默认折叠、流式思考默认展开，手动展开后不被状态变化抢走', async () => {
    const streaming = item(2, { type: 'thinking', state: 'streaming', content: '当前思考' });
    configure({
      items: [item(1, { type: 'thinking', state: 'done', content: '历史思考' }), streaming],
    });
    renderTimeline();

    expect(thinkingRow(1).querySelector('pre')).toBeNull();
    expect(thinkingRow(2).querySelector('pre')).toBeTruthy();

    fireEvent.click(thinkingRow(1).querySelector('button')!);
    expect(thinkingRow(1).querySelector('pre')).toBeTruthy();

    await act(async () => {
      h.state.bySession[SESSION] = {
        1: item(1, { type: 'thinking', state: 'done', content: '历史思考补充' }),
        2: streaming,
      };
      h.emit();
    });

    expect(thinkingRow(1).querySelector('pre')).toBeTruthy();
  });
});
