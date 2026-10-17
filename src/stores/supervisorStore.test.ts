/**
 * F1：调度中枢 store（hydrate / SSE 增量 / 跨管线隔离）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { api } = vi.hoisted(() => ({
  api: {
    getLedger: vi.fn(),
    getAttribution: vi.fn(),
    getDiagnosis: vi.fn(),
    getDecisions: vi.fn(),
    getBudget: vi.fn(),
  },
}));

vi.mock('@/services/api/supervisor', () => ({ supervisorApi: api }));

import {
  MAX_DECISIONS,
  MAX_LEDGER_ENTRIES,
  useSupervisorStore,
} from './supervisorStore';
import type { LedgerEntry } from '@/types/supervisor';

function entry(stage: string, attempt: number): LedgerEntry {
  return {
    id: `le_${stage}${attempt}`,
    stage,
    attempt,
    decision: 'pass',
    degradations: [],
    warnings: [],
    duration_ms: 10,
    ts: '2026-10-17T10:00:00Z',
  };
}

const EMPTY_LEDGER = {
  pipeline_id: 'pl_1',
  found: false,
  count: 0,
  attempts: {},
  entries: [] as LedgerEntry[],
};

beforeEach(() => {
  vi.clearAllMocks();
  useSupervisorStore.getState().reset();
  api.getLedger.mockResolvedValue(EMPTY_LEDGER);
  api.getAttribution.mockResolvedValue({ found: false, pipeline_id: 'pl_1' });
  api.getDiagnosis.mockResolvedValue({ found: false, pipeline_id: 'pl_1' });
  api.getBudget.mockResolvedValue({
    spent_usd: 0,
    budgetEnabled: false,
    level: 'unlimited',
  });
  api.getDecisions.mockResolvedValue({
    pipeline_id: 'pl_1',
    found: false,
    count: 0,
    accepted_degraded: false,
    decisions: [],
  });
});

describe('setPipeline 跨管线隔离', () => {
  it('切换管线会清空旧数据', () => {
    useSupervisorStore.setState({
      pipelineId: 'pl_a',
      ledger: [entry('edit', 1)],
      diagnosis: { conclusion: 'x' } as never,
    });

    useSupervisorStore.getState().setPipeline('pl_b');

    const s = useSupervisorStore.getState();
    expect(s.pipelineId).toBe('pl_b');
    expect(s.ledger).toEqual([]);
    expect(s.diagnosis).toBeNull();
    expect(s.attempts).toEqual({});
  });

  it('同一管线重复设置不影响已有数据', () => {
    useSupervisorStore.setState({ pipelineId: 'pl_a', ledger: [entry('edit', 1)] });
    useSupervisorStore.getState().setPipeline('pl_a');
    expect(useSupervisorStore.getState().ledger).toHaveLength(1);
  });
});

describe('hydrate', () => {
  it('并行拉取账本/归因/诊断书/决策并落状态', async () => {
    api.getLedger.mockResolvedValue({
      pipeline_id: 'pl_1',
      found: true,
      count: 2,
      attempts: { edit: 2 },
      entries: [entry('edit', 1), entry('edit', 2)],
    });
    api.getAttribution.mockResolvedValue({
      found: true,
      pipeline_id: 'pl_1',
      primary_stage: 'material',
      upstream_chain: [],
      evidence_refs: [],
      confidence: 'high',
      unrepairable: true,
      reason: '资源缺失',
      source: 'rule',
    });
    api.getDiagnosis.mockResolvedValue({
      found: true,
      pipeline_id: 'pl_1',
      conclusion: '素材缺失',
      problems: [],
      evidence: [],
      attempted: [],
      suggestions: [],
      cost: { tokens: 10, spent_usd: null, budget_usd: null, subagent_tokens: 0 },
      mode: 'shadow',
    });
    api.getBudget.mockResolvedValue({
    spent_usd: 0,
    budgetEnabled: false,
    level: 'unlimited',
  });
  api.getDecisions.mockResolvedValue({
      pipeline_id: 'pl_1',
      found: true,
      count: 1,
      accepted_degraded: true,
      decisions: [
        {
          id: 'd1',
          strategy: 'S4_accept_degraded',
          target_stage: '',
          reason: '资源缺失',
          allow_degrade: true,
          aborted: false,
          stage_attempts: {},
          mode: 'on',
        },
      ],
    });

    await useSupervisorStore.getState().hydrate('pl_1');

    const s = useSupervisorStore.getState();
    expect(s.ledger).toHaveLength(2);
    expect(s.attempts).toEqual({ edit: 2 });
    expect(s.attribution?.primary_stage).toBe('material');
    expect(s.diagnosis?.conclusion).toBe('素材缺失');
    expect(s.decisions).toHaveLength(1);
    expect(s.acceptedDegraded).toBe(true);
    expect(s.loading).toBe(false);
    expect(s.error).toBe('');
  });

  it('拉取失败时保留旧数据并记录错误', async () => {
    useSupervisorStore.setState({ ledger: [entry('edit', 1)] });
    api.getLedger.mockRejectedValue(new Error('network down'));

    await useSupervisorStore.getState().hydrate('pl_1');

    const s = useSupervisorStore.getState();
    expect(s.ledger).toHaveLength(1);
    expect(s.error).toContain('network down');
    expect(s.loading).toBe(false);
  });
});

describe('applyEvent（SSE 增量）', () => {
  it('ledger_entry 追加并更新 attempts', () => {
    useSupervisorStore.getState().applyEvent({ type: 'ledger_entry', data: entry('material', 1) });
    useSupervisorStore.getState().applyEvent({ type: 'ledger_entry', data: entry('material', 2) });

    const s = useSupervisorStore.getState();
    expect(s.ledger).toHaveLength(2);
    expect(s.attempts).toEqual({ material: 2 });
  });

  it('ledger_entry 受上限保护', () => {
    for (let i = 0; i < MAX_LEDGER_ENTRIES + 5; i++) {
      useSupervisorStore.getState().applyEvent({ type: 'ledger_entry', data: entry('edit', i + 1) });
    }
    expect(useSupervisorStore.getState().ledger).toHaveLength(MAX_LEDGER_ENTRIES);
  });

  it('dispatch 追加决策，S4 时标记接受降级，并受上限保护', () => {
    for (let i = 0; i < MAX_DECISIONS + 3; i++) {
      useSupervisorStore.getState().applyEvent({
        type: 'dispatch',
        data: {
          id: `d${i}`,
          strategy: i === 0 ? 'S4_accept_degraded' : 'S1_same',
          target_stage: 'edit',
          reason: '',
          allow_degrade: false,
          aborted: false,
          stage_attempts: {},
          mode: 'on',
        },
      });
    }
    const s = useSupervisorStore.getState();
    expect(s.decisions).toHaveLength(MAX_DECISIONS);
    expect(s.acceptedDegraded).toBe(true);
  });

  it('attribution / diag_report 直接替换', () => {
    useSupervisorStore.getState().applyEvent({
      type: 'attribution',
      data: { primary_stage: 'audio', reason: 'x' },
    });
    useSupervisorStore.getState().applyEvent({
      type: 'diag_report',
      data: { conclusion: 'y' },
    });
    const s = useSupervisorStore.getState();
    expect(s.attribution?.primary_stage).toBe('audio');
    expect(s.diagnosis?.conclusion).toBe('y');
  });

  it('未知类型与脏数据被忽略且不抛错', () => {
    useSupervisorStore.getState().applyEvent({ type: 'unknown', data: { a: 1 } });
    useSupervisorStore.getState().applyEvent({ type: 'ledger_entry', data: null });
    useSupervisorStore.getState().applyEvent({ type: 'ledger_entry', data: { bogus: true } });
    useSupervisorStore.getState().applyEvent({});
    const s = useSupervisorStore.getState();
    expect(s.ledger).toEqual([]);
    expect(s.decisions).toEqual([]);
  });
});
