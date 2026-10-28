// @vitest-environment jsdom
/**
 * PRD B5（2026-10-29 / G10）：事件契约 parser。
 *
 * 证伪点：
 * 1. 24 类事件逐个 parse 都不抛异常，且 `kind` 就是事件类型；
 * 2. 缺键给默认值、未知键保留在 `raw`（不丢信息）；
 * 3. 未知事件类型 → `kind: 'unknown'`（不崩）；
 * 4. 与后端契约：`EVENT_TYPE_KEYS` 数量 24 且无重复（跨仓一致性由
 *    `tests/test_event_contract.py` 做严格集合比对）。
 */
import { describe, expect, it } from 'vitest';
import { EVENT_TYPE_KEYS, parseTaskEvent, selectEvents } from './eventSchema';
import type { TaskEvent, TaskEventType } from '@/types/task';

const ev = (type: TaskEventType, detail: Record<string, unknown> = {}, message = ''): TaskEvent =>
  ({ seq: 1, type, ts: '', message, detail });

describe('B5 事件契约', () => {
  it('EVENT_TYPE_KEYS 覆盖 24 类且无重复', () => {
    expect(EVENT_TYPE_KEYS).toHaveLength(24);
    expect(new Set(EVENT_TYPE_KEYS).size).toBe(24);
  });

  it('24 类事件逐个 parse 不抛异常，kind 与类型一致', () => {
    for (const type of EVENT_TYPE_KEYS) {
      const parsed = parseTaskEvent(ev(type));
      expect(parsed.kind, `type=${type}`).toBe(type);
      expect(parsed.type).toBe(type);
    }
  });

  it('tool_result 缺键给默认值，未知键保留在 raw', () => {
    const parsed = parseTaskEvent(ev('tool_result', {
      tool: 'frame_check', status: 'error', error: '缺输入', extra_new_field: 42,
    }));
    expect(parsed.kind).toBe('tool_result');
    if (parsed.kind !== 'tool_result') throw new Error('kind');
    expect(parsed.tool).toMatchObject({ tool: 'frame_check', status: 'error', error: '缺输入' });
    expect(parsed.tool.duration_ms).toBeUndefined();
    expect(parsed.raw.extra_new_field).toBe(42);
  });

  it('context_loaded.trimmed 必须按数组处理（B12 已把后端从 bool 改成 list）', () => {
    const parsed = parseTaskEvent(ev('context_loaded', {
      bytes: 900, budget: 6000, trimmed: ['reports', 'script'],
    }));
    if (parsed.kind !== 'context_loaded') throw new Error('kind');
    expect(parsed.context.trimmed).toEqual(['reports', 'script']);
    // 老数据把 trimmed 写成 bool 时不崩、也不当数组用
    const legacy = parseTaskEvent(ev('context_loaded', { trimmed: true }));
    if (legacy.kind !== 'context_loaded') throw new Error('kind');
    expect(legacy.context.trimmed).toBeUndefined();
  });

  it('agent_run_end 解析 failure / needs / report_path', () => {
    const parsed = parseTaskEvent(ev('agent_run_end', {
      run_id: 'r1', status: 'failed', summary: '缺时间线',
      failure: { blocking_point: 'timeline 为空', retryable: 'needs_upstream' },
      needs: [{ field: 'timeline' }], cost_usd: 0.02, duration_ms: 900,
    }));
    if (parsed.kind !== 'agent_run_end') throw new Error('kind');
    expect(parsed.run.run_id).toBe('r1');
    expect(parsed.run.failure?.blocking_point).toBe('timeline 为空');
    expect(parsed.run.needs?.[0].field).toBe('timeline');
    expect(parsed.run.cost_usd).toBe(0.02);
  });

  it('未知事件类型 → kind=unknown（不抛、保留 raw）', () => {
    const parsed = parseTaskEvent(ev('brand_new_event' as TaskEventType, { a: 1 }, '新事件'));
    expect(parsed.kind).toBe('unknown');
    expect(parsed.raw).toEqual({ a: 1 });
    expect(parsed.message).toBe('新事件');
  });

  it('selectEvents 只挑目标类型且顺序不变', () => {
    const events = [
      ev('tool_call', { tool: 'a' }, 'call'),
      ev('thinking', { delta: '想' }),
      ev('tool_result', { tool: 'a', status: 'ok' }),
    ];
    const calls = selectEvents(events, 'tool_call');
    expect(calls).toHaveLength(1);
    if (calls[0].kind !== 'tool_call') throw new Error('kind');
    expect(calls[0].tool.tool).toBe('a');
  });
});
