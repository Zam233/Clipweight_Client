// @vitest-environment jsdom
/**
 * 统一时间线 normalizer + store（unified-stream PRD §4 / M2 验收）。
 *
 * 钉住的四件事：
 * 1. 29 种事件**全部**有归属（要么具体 kind，要么 log 兜底，绝不消失）；
 * 2. 乱序 hydrate 后顺序正确（同任务按 seq，不用时间戳）；
 * 3. 重复 hydrate / 重复 apply 幂等（dedupeKey 相同就 patch，不新增行）；
 * 4. tool_result 合并进 tool_call 那一行；question→answer 只留一条。
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { EVENT_TYPE_KEYS } from '@/features/task/eventSchema';
import {
  compareTimeline,
  normalizeRequirementMessage,
  normalizeTaskEvent,
} from '@/features/unifiedTimeline/normalize';
import type { TimelineItem } from '@/features/unifiedTimeline/types';
import { selectOrderedItems, useUnifiedTimelineStore } from '@/stores/unifiedTimelineStore';
import type { TaskEvent } from '@/types/task';

function ev(seq: number, type: string, detail: Record<string, unknown> = {},
            message = '', extra: Partial<TaskEvent> = {}): TaskEvent {
  return { seq, type: type as TaskEvent['type'], ts: `2026-10-30T19:00:${String(seq).padStart(2, '0')}Z`,
    message, detail, ...extra };
}

const store = () => useUnifiedTimelineStore.getState();

beforeEach(() => {
  store().resetAll();
});

describe('normalizeTaskEvent：29 种事件全覆盖', () => {
  it('每个 EVENT_TYPE_KEYS 都能映射出条目（null 一律不允许）', () => {
    const missing: string[] = [];
    EVENT_TYPE_KEYS.forEach((type, i) => {
      const item = normalizeTaskEvent(ev(i + 1, type), 'task_x');
      if (!item) missing.push(type);
      expect(item?.kind).toBeTruthy();
    });
    expect(missing).toEqual([]);
    expect(EVENT_TYPE_KEYS).toHaveLength(29);
  });

  it('具体 kind 映射正确（抽样）', () => {
    expect(normalizeTaskEvent(ev(1, 'tool_call', { tool: 'read_artifact' }), 't')?.kind).toBe('tool');
    expect(normalizeTaskEvent(ev(2, 'thinking', { delta: '想一想' }), 't')?.kind).toBe('reasoning');
    expect(normalizeTaskEvent(ev(3, 'step_start', { stage: 'material' }), 't')?.kind).toBe('stage');
    expect(normalizeTaskEvent(ev(4, 'question', { question_id: 'q1', question: '选哪个' }), 't')?.kind)
      .toBe('question');
    expect(normalizeTaskEvent(ev(5, 'approval_request', { approval_id: 'a1' }), 't')?.kind)
      .toBe('approval');
    expect(normalizeTaskEvent(ev(6, 'degradation', { scope: 'reasoning_effort' }), 't')?.kind)
      .toBe('degradation');
    expect(normalizeTaskEvent(ev(7, 'task_end', { status: 'done' }), 't')?.kind).toBe('task-end');
    // 未归类事件仍然可见（log 兜底）
    expect(normalizeTaskEvent(ev(8, 'context_loaded', { bytes: 10 }), 't')?.kind).toBe('log');
  });

  it('排序比较器同任务按 seq，跨源按派发序号，绝不用 ts', () => {
    const a = normalizeTaskEvent(ev(10, 'narration', {}, '第二句'), 't1')!;
    const b = normalizeTaskEvent(ev(2, 'narration', {}, '第一句'), 't1')!;
    // 故意把 ts 弄反，验证排序不受影响
    a.ts = '2026-10-30T00:00:00Z';
    b.ts = '2026-10-30T23:59:59Z';
    expect([a, b].sort(compareTimeline).map((x) => x.order.seq)).toEqual([2, 10]);
  });
});

describe('store：合并与去重', () => {
  it('tool_result 合并进 tool_call 那一行（不新增）', () => {
    store().applyTaskEvent('t1', ev(1, 'tool_call', { tool: 'read_artifact' }));
    store().applyTaskEvent('t1', ev(2, 'tool_result',
      { tool: 'read_artifact', status: 'ok', duration_ms: 42 }, '', { causation_id: 'seq:1' }));
    const items = selectOrderedItems(store(), { taskId: 't1' });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('tool');
    expect((items[0] as Extract<TimelineItem, { kind: 'tool' }>).status).toBe('ok');
    expect((items[0] as Extract<TimelineItem, { kind: 'tool' }>).ms).toBe(42);
  });

  it('重复 hydrate 幂等（同 dedupeKey 不新增行）', () => {
    const events = [
      ev(1, 'tool_call', { tool: 'a' }),
      ev(2, 'narration', {}, '说一句'),
      ev(3, 'step_end', { stage: 'material', status: 'ok' }),
    ];
    store().hydrateTaskEvents('t1', events);
    const first = selectOrderedItems(store(), { taskId: 't1' }).length;
    store().hydrateTaskEvents('t1', events);
    expect(selectOrderedItems(store(), { taskId: 't1' }).length).toBe(first);
  });

  it('乱序 hydrate 后顺序仍按 seq（不按到达）', () => {
    const events = [
      ev(5, 'narration', {}, '第五'),
      ev(1, 'narration', {}, '第一'),
      ev(3, 'narration', {}, '第三'),
    ];
    store().hydrateTaskEvents('t1', events);
    const seqs = selectOrderedItems(store(), { taskId: 't1' }).map((i) => i.order.seq);
    expect(seqs).toEqual([1, 3, 5]);
  });

  it('question → answer 合并成一条并标记已回答', () => {
    store().applyTaskEvent('t1', ev(1, 'question',
      { question_id: 'q1', question: '风格？', options: [{ id: 'a', label: 'A' }] }));
    store().applyTaskEvent('t1', ev(2, 'answer',
      { question_id: 'q1', option_id: 'a', source: 'user_option' }));
    const items = selectOrderedItems(store(), { taskId: 't1' });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('question');
    expect((items[0] as unknown as { status: string }).status).toBe('answered');
  });

  it('思考按轮聚合：同 round 追加文本，不新增行', () => {
    store().applyTaskEvent('t1', ev(1, 'thinking', { round: 1, delta: '先看' }));
    store().applyTaskEvent('t1', ev(2, 'thinking', { round: 1, delta: '素材' }));
    const items = selectOrderedItems(store(), { taskId: 't1' });
    expect(items).toHaveLength(1);
    expect((items[0] as Extract<TimelineItem, { kind: 'reasoning' }>).text).toBe('先看素材');
  });

  it('seq 缺口落成 gap 条目（显式告知，不静默拼接）', () => {
    store().applyTaskEvent('t1', ev(1, 'narration', {}, '一'));
    store().applyTaskEvent('t1', ev(5, 'narration', {}, '五'));
    const kinds = selectOrderedItems(store(), { taskId: 't1' }).map((i) => i.kind);
    expect(kinds).toContain('gap');
    expect(store().tasks.t1.seqGap).toEqual({ from: 2, to: 4 });
  });

  it('需求消息与任务事件可以并存，各自 source 独立', () => {
    store().applyRequirementMessages('s1', [
      { id: 'm1', role: 'user', content: '做一期' },
      { id: 'm2', role: 'assistant', content: '好的' },
    ]);
    store().applyTaskEvent('t1', ev(1, 'narration', {}, '开始干活'));
    const items = selectOrderedItems(store());
    expect(items.filter((i) => i.source === 'requirements')).toHaveLength(2);
    expect(items.filter((i) => i.source === 'task')).toHaveLength(1);
  });

  it('需求思考增量累积（同一条 reasoning 追加，不新建行）', () => {
    store().applyRequirementReasoning('s1', '先确认');
    store().applyRequirementReasoning('s1', '选题边界');
    const items = selectOrderedItems(store(), { sessionId: 's1' });
    expect(items).toHaveLength(1);
    expect((items[0] as Extract<TimelineItem, { kind: 'reasoning' }>).text).toBe('先确认选题边界');
  });

  it('比较器稳定：同 ordinal 不同 key 时顺序确定', () => {
    const a: TimelineItem = normalizeRequirementMessage(
      { id: 'b', role: 'user', content: 'x' }, 's1', 1);
    const b: TimelineItem = normalizeRequirementMessage(
      { id: 'a', role: 'user', content: 'y' }, 's1', 1);
    expect([a, b].sort(compareTimeline).map((i) => i.key))
      .toEqual([b.key, a.key].sort());
  });
});

describe('性能：窗口化前提', () => {
  it('1200 条事件进 store 后有序取用正确（renderer 只渲染窗口）', () => {
    const events: TaskEvent[] = [];
    for (let i = 1; i <= 1200; i += 1) {
      events.push(ev(i, i % 3 === 0 ? 'thinking' : 'narration',
        i % 3 === 0 ? { round: i, delta: `想 ${i}` } : {}, `第 ${i} 条`));
    }
    store().hydrateTaskEvents('t1', events);
    const items = selectOrderedItems(store(), { taskId: 't1' });
    expect(items.length).toBeGreaterThan(700);
    expect(items[0].order.seq).toBe(1);
    expect(items[items.length - 1].order.seq).toBe(1200);
  });
});
