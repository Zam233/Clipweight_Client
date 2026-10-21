/**
 * F0 契约测试：类型 fixture 自洽性 + supervisorApi 的 URL/参数约定。
 *
 * 目的：后端字段改名或路由变动时，这里先红，而不是等联调才发现。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

import {
  sampleAttribution,
  sampleDiagnosis,
  sampleExecRecords,
  sampleLedgerEntries,
  sampleSubagents,
} from './fixtures';

const { getMock } = vi.hoisted(() => ({ getMock: vi.fn() }));

vi.mock('@/services/api/client', () => ({
  getApiClient: () => ({
    get: getMock,
    post: vi.fn(async () => ({ data: {} })),
    put: vi.fn(async () => ({ data: {} })),
  }),
}));

import { supervisorApi } from '@/services/api/supervisor';

beforeEach(() => {
  getMock.mockReset();
  getMock.mockResolvedValue({ data: {} });
});

describe('fixtures 自洽性', () => {
  it('账本条目字段与尝试序号自洽', () => {
    expect(sampleLedgerEntries.length).toBeGreaterThan(0);
    for (const e of sampleLedgerEntries) {
      expect(e.id).toMatch(/^le_/);
      expect(e.attempt).toBeGreaterThanOrEqual(1);
      expect(Array.isArray(e.degradations)).toBe(true);
      expect(typeof e.duration_ms).toBe('number');
    }
    const editAttempts = sampleLedgerEntries
      .filter((e) => e.stage === 'edit')
      .map((e) => e.attempt);
    expect(editAttempts).toEqual([1, 2]);
  });

  it('归因与诊断书引用能对上（证据 ref 存在于账本）', () => {
    const ids = new Set(sampleLedgerEntries.map((e) => e.id));
    for (const ref of sampleAttribution.evidence_refs) {
      expect(ids.has(ref)).toBe(true);
    }
    for (const ev of sampleDiagnosis.evidence) {
      if (ev.ref) expect(ids.has(ev.ref)).toBe(true);
    }
  });

  it('诊断书 suggestion action 在约定集合内', () => {
    const allowed = new Set(['retry_with_model', 'redo_stage', 'accept_degraded', 'manual']);
    for (const s of sampleDiagnosis.suggestions) {
      expect(allowed.has(s.action)).toBe(true);
      expect(s.label.length).toBeGreaterThan(0);
    }
  });

  it('执行记录的风险等级与拒绝原因自洽', () => {
    for (const r of sampleExecRecords) {
      expect(['low', 'med', 'high', 'critical']).toContain(r.riskLevel);
      if (r.riskLevel !== 'low') {
        expect(r.dangerExplanation ?? r.rejected?.reason).toBeTruthy();
      }
    }
  });

  it('子代理节点有可取消与状态字段', () => {
    for (const n of sampleSubagents) {
      expect(typeof n.cancellable).toBe('boolean');
      expect(['pending', 'running', 'done', 'failed', 'cancelled']).toContain(n.status);
    }
  });
});

describe('supervisorApi 路由与参数', () => {
  it('账本：默认不带 stage，带 stage 时作为 query', async () => {
    await supervisorApi.getLedger('pl_1');
    expect(getMock).toHaveBeenLastCalledWith('/api/pipeline/pl_1/ledger', { params: undefined });

    await supervisorApi.getLedger('pl_1', 'edit');
    expect(getMock).toHaveBeenLastCalledWith('/api/pipeline/pl_1/ledger', {
      params: { stage: 'edit' },
    });
  });

  it('归因：默认规则态，llm=true 才带参数', async () => {
    await supervisorApi.getAttribution('pl_1');
    expect(getMock).toHaveBeenLastCalledWith('/api/pipeline/pl_1/attribution', {
      params: undefined,
    });

    await supervisorApi.getAttribution('pl_1', true);
    expect(getMock).toHaveBeenLastCalledWith('/api/pipeline/pl_1/attribution', {
      params: { llm: true },
    });
  });

  it('诊断书：走 /diagnosis', async () => {
    await supervisorApi.getDiagnosis('pl_1');
    expect(getMock).toHaveBeenLastCalledWith('/api/pipeline/pl_1/diagnosis');
  });
});
