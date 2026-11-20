// @vitest-environment jsdom
/**
 * F03：v2 事件字段必须被 parser 保留（不是只有 raw 里有）。
 * - subagent_round：run_id/round/visible_calls
 * - step_end：report_state/run_id/input_revision
 * - doc_write：bytes/run_id/seq
 * - agent_run_end：terminal_reason/tool_calls_total/trace_state/handoff_summary
 */
import { describe, expect, it } from 'vitest';
import { parseTaskEvent } from './eventSchema';
import type { TaskEvent } from '@/types/task';

function ev(type: string, detail: Record<string, unknown>): TaskEvent {
  return { seq: 1, ts: '2026-11-20T00:00:00Z', type, message: '', detail } as TaskEvent;
}

describe('event schema v2 字段', () => {
  it('解析 subagent_round', () => {
    const parsed = parseTaskEvent(ev('subagent_round', {
      run_id: 'run_1', round: 3, visible_calls: ['describe_mg', 'media_probe'],
    }));
    expect(parsed.kind).toBe('subagent_round');
    if (parsed.kind === 'subagent_round') {
      expect(parsed.round.run_id).toBe('run_1');
      expect(parsed.round.round).toBe(3);
      expect(parsed.round.visible_calls).toEqual(['describe_mg', 'media_probe']);
    }
  });

  it('解析 step_end 的报告与输入版本', () => {
    const parsed = parseTaskEvent(ev('step_end', {
      stage: 'structure', status: 'ok', report_state: 'written',
      report_path: 'reports/01-structure-1.md', report_seq: 1,
      run_id: 'run_1', input_revision: 4,
    }));
    expect(parsed.kind).toBe('step_end');
    if (parsed.kind === 'step_end') {
      expect(parsed.stage.report_state).toBe('written');
      expect(parsed.stage.run_id).toBe('run_1');
      expect(parsed.stage.input_revision).toBe(4);
      expect(parsed.stage.report_seq).toBe(1);
    }
  });

  it('解析 doc_write 的真实字节与 run 身份', () => {
    const parsed = parseTaskEvent(ev('doc_write', {
      path: 'reports/01-edit-1.md', bytes: 1234, seq: 1, run_id: 'run_1', status: 'ok',
    }));
    expect(parsed.kind).toBe('doc_write');
    if (parsed.kind === 'doc_write') {
      expect(parsed.doc.bytes).toBe(1234);
      expect(parsed.doc.run_id).toBe('run_1');
      expect(parsed.doc.seq).toBe(1);
    }
  });

  it('解析 agent_run_end 的 v2 字段', () => {
    const parsed = parseTaskEvent(ev('agent_run_end', {
      run_id: 'run_1', status: 'degraded', terminal_reason: 'scenes_fallback',
      tool_calls_total: 9, trace_state: 'complete', handoff_summary: '模板兜底',
      report_state: 'written', cost_unknown: false, attempt: 2,
    }));
    expect(parsed.kind).toBe('agent_run_end');
    if (parsed.kind === 'agent_run_end') {
      expect(parsed.run.terminal_reason).toBe('scenes_fallback');
      expect(parsed.run.tool_calls_total).toBe(9);
      expect(parsed.run.trace_state).toBe('complete');
      expect(parsed.run.handoff_summary).toBe('模板兜底');
      expect(parsed.run.cost_unknown).toBe(false);
      expect(parsed.run.attempt).toBe(2);
    }
  });

  it('未知事件仍不抛异常', () => {
    expect(parseTaskEvent(ev('brand_new_event', { a: 1 })).kind).toBe('unknown');
  });
});
