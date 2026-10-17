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
    dispatch: vi.fn(),
    getSubagents: vi.fn(async () => ({ tree: [] })),
    getExecLog: vi.fn(async (): Promise<{ records: ExecRecord[] }> => ({ records: [] })),
    getPendingApprovals: vi.fn(
      async (): Promise<{ items: PendingExecApproval[] }> => ({ items: [] }),
    ),
    getAutoMode: vi.fn(async () => ({ enabled: false })),
    getPendingWorkerReviews: vi.fn(async () => ({ items: [] })),
    requestExec: vi.fn(),
    approveExec: vi.fn(async () => {}),
    rejectExec: vi.fn(async () => {}),
    acceptSuggestion: vi.fn(),
  },
}));

vi.mock('@/services/api/supervisor', () => ({ supervisorApi: api }));

import {
  MAX_DECISIONS,
  MAX_LEDGER_ENTRIES,
  useSupervisorStore,
} from './supervisorStore';
import type { ExecRecord, LedgerEntry, PendingExecApproval } from '@/types/supervisor';

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

  it('dispatch 收人工改派单（无 strategy）时补成决策口径', () => {
    useSupervisorStore.getState().applyEvent({
      type: 'dispatch',
      data: {
        id: 'ord_1',
        target_stage: 'edit',
        reason: '第 3 段卡顿',
        issues: [],
        source: 'manual',
      },
    });
    const [d] = useSupervisorStore.getState().decisions;
    expect(d.id).toBe('ord_1');
    expect(d.strategy).toBe('manual');
    expect(d.target_stage).toBe('edit');
    expect(d.mode).toBe('manual');
  });

  it('subagent_start 新建节点，progress/end 只更新状态', () => {
    const apply = useSupervisorStore.getState().applyEvent;
    apply({ type: 'subagent_start', data: { subagent_id: 'sa_1', role: '素材搜索', status: 'pending' } });
    expect(useSupervisorStore.getState().subagents).toHaveLength(1);

    apply({ type: 'subagent_progress', data: { subagent_id: 'sa_1', status: 'running' } });
    apply({ type: 'subagent_end', data: { subagent_id: 'sa_1', status: 'done' } });

    const nodes = useSupervisorStore.getState().subagents;
    expect(nodes).toHaveLength(1);
    expect(nodes[0].status).toBe('done');
    expect(nodes[0].role).toBe('素材搜索');
  });

  it('exec 事件按 id 去重后追加', () => {
    const apply = useSupervisorStore.getState().applyEvent;
    const rec = {
      id: 'ex_1',
      ts: '2026-10-17T10:00:00Z',
      kind: 'shell' as const,
      command: 'npm run lint',
      cwd: '.',
      riskLevel: 'low' as const,
      riskReasons: [],
      autoMode: false,
      exitCode: null,
      durationMs: 0,
    };
    apply({ type: 'exec', data: rec });
    apply({ type: 'exec', data: { ...rec, exitCode: 0, durationMs: 120 } });

    const recs = useSupervisorStore.getState().execRecords;
    expect(recs).toHaveLength(1);
    expect(recs[0].exitCode).toBe(0);
  });
});

describe('dispatchOrder（人工改派工单）', () => {
  it('成功时原样返回后端结果', async () => {
    api.dispatch.mockResolvedValue({ order: { id: 'ord_1' }, accepted: true, requires_retry: true });
    const res = await useSupervisorStore
      .getState()
      .dispatchOrder('pl_1', { target_stage: 'edit', reason: '卡顿' });
    expect(res?.requires_retry).toBe(true);
    expect(useSupervisorStore.getState().error).toBe('');
  });

  it('失败时落 error 并返回 null（不抛给组件）', async () => {
    api.dispatch.mockRejectedValue(new Error('预算已耗尽'));
    const res = await useSupervisorStore
      .getState()
      .dispatchOrder('pl_1', { target_stage: 'edit', reason: '卡顿' });
    expect(res).toBeNull();
    expect(useSupervisorStore.getState().error).toContain('预算已耗尽');
  });
});

describe('执行请求（requestExec / 授权 / 拒绝）', () => {
  it('提交后原样返回结局，并重拉一次执行态', async () => {
    api.requestExec.mockResolvedValue({ pipeline_id: 'pl_1', status: 'done', exitCode: 0 });
    api.getExecLog.mockResolvedValue({
      records: [
        {
          id: 'ex_9',
          ts: '2026-10-17T10:00:00Z',
          kind: 'shell',
          command: 'pytest',
          cwd: '',
          riskLevel: 'low',
          riskReasons: [],
          autoMode: false,
          exitCode: 0,
          durationMs: 10,
        },
      ],
    });

    const res = await useSupervisorStore
      .getState()
      .requestExec('pl_1', { kind: 'shell', command: 'pytest' });

    expect(res?.status).toBe('done');
    expect(api.getExecLog).toHaveBeenCalledWith('pl_1');
    expect(useSupervisorStore.getState().execRecords).toHaveLength(1);
  });

  it('等授权时把待授权项拉进 store', async () => {
    api.requestExec.mockResolvedValue({
      pipeline_id: 'pl_1',
      status: 'pending_approval',
      approval: { id: 'ap_1', command: 'deploy', riskLevel: 'high' },
    });
    api.getPendingApprovals.mockResolvedValue({
      items: [
        {
          id: 'ap_1',
          command: 'deploy',
          riskLevel: 'high',
          riskReasons: [],
          dangerExplanation: '会覆盖 dist',
          requestedBy: 'supervisor',
          expiresAt: '',
        },
      ],
    });

    await useSupervisorStore.getState().requestExec('pl_1', { kind: 'shell', command: 'deploy' });
    expect(useSupervisorStore.getState().pendingApprovals).toHaveLength(1);
  });

  it('请求失败时落 error 且不抛给组件', async () => {
    api.requestExec.mockRejectedValue(new Error('预算已耗尽'));
    const res = await useSupervisorStore
      .getState()
      .requestExec('pl_1', { kind: 'shell', command: 'x' });
    expect(res).toBeNull();
    expect(useSupervisorStore.getState().error).toContain('预算已耗尽');
  });

  it('授权与拒绝都透传参数并刷新执行态', async () => {
    await useSupervisorStore.getState().approveExec('pl_1', 'ap_1', true, true);
    expect(api.approveExec).toHaveBeenCalledWith('pl_1', 'ap_1', true, true);

    await useSupervisorStore.getState().rejectExec('pl_1', 'ap_2');
    expect(api.rejectExec).toHaveBeenCalledWith('pl_1', 'ap_2');
    expect(api.getPendingApprovals).toHaveBeenCalledTimes(2);
  });
});

describe('诊断建议（runSuggestion）', () => {
  it('重做建议带上行动与阶段，重跑起来就刷新首屏状态', async () => {
    api.acceptSuggestion.mockResolvedValue({
      pipeline_id: 'pl_1',
      accepted: true,
      accepted_degraded: false,
      action: 'retry_with_model',
      target_stage: 'material',
      retry: { retried: true },
    });
    const res = await useSupervisorStore.getState().runSuggestion('pl_1', {
      suggestion_id: 's1',
      action: 'retry_with_model',
      target_stage: 'material',
    });
    expect(api.acceptSuggestion).toHaveBeenCalledWith('pl_1', {
      suggestion_id: 's1',
      action: 'retry_with_model',
      target_stage: 'material',
    });
    expect(res?.retry?.retried).toBe(true);
    expect(api.getLedger).toHaveBeenCalledWith('pl_1');
  });

  it('跑不起来时如实返回结果，不抛给组件', async () => {
    api.acceptSuggestion.mockResolvedValue({
      pipeline_id: 'pl_1',
      accepted: false,
      accepted_degraded: false,
      action: 'redo_stage',
      retry: { retried: false, reason: '无可用前置成功结果' },
    });
    const res = await useSupervisorStore
      .getState()
      .runSuggestion('pl_1', { action: 'redo_stage', target_stage: 'edit' });
    expect(res?.accepted).toBe(false);
    expect(res?.retry?.reason).toContain('无可用前置成功结果');
    // 没有真的重跑，不该白白重拉一遍
    expect(api.getLedger).not.toHaveBeenCalled();
  });

  it('请求失败落 error 并返回 null', async () => {
    api.acceptSuggestion.mockRejectedValue(new Error('预算已耗尽'));
    const res = await useSupervisorStore.getState().runSuggestion('pl_1', { action: 'redo_stage' });
    expect(res).toBeNull();
    expect(useSupervisorStore.getState().error).toContain('预算已耗尽');
  });
});

describe('exec 事件：后台高危命令必须进待授权队列', () => {
  it('待授权条目（有 requestedBy）进 pendingApprovals，不进执行日志', () => {
    useSupervisorStore.getState().applyEvent({
      type: 'exec',
      data: {
        id: 'ap_1',
        command: 'rm -rf build',
        riskLevel: 'high',
        riskReasons: ['会删除目录'],
        requestedBy: 'supervisor',
        needsConfirm: true,
        expiresAt: '',
      },
    });
    const s = useSupervisorStore.getState();
    expect(s.pendingApprovals).toHaveLength(1);
    expect(s.pendingApprovals[0].riskLevel).toBe('high');
    expect(s.execRecords).toHaveLength(0);
  });

  it('执行完成条目进日志，并把同 id 的待授权项摘掉', () => {
    useSupervisorStore.setState({
      pendingApprovals: [
        {
          id: 'ex_1',
          command: 'del x',
          riskLevel: 'med',
          riskReasons: [],
          dangerExplanation: '',
          requestedBy: 'supervisor',
          expiresAt: '',
        },
      ],
    });
    useSupervisorStore.getState().applyEvent({
      type: 'exec',
      data: {
        id: 'ex_1',
        ts: '2026-10-17T10:00:00Z',
        kind: 'shell',
        command: 'del x',
        cwd: '',
        riskLevel: 'med',
        riskReasons: [],
        autoMode: false,
        exitCode: 0,
        durationMs: 12,
      },
    });
    const s = useSupervisorStore.getState();
    expect(s.execRecords).toHaveLength(1);
    expect(s.pendingApprovals).toHaveLength(0);
  });
});
