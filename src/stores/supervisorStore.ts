/**
 * 调度中枢 store（前端 F1）。
 *
 * 职责：把「账本 / 归因 / 诊断书 / 决策序列」收在一处，供调度面板、诊断书卡片与
 * 成本条消费。刻意**不塞进 agentStore**——那个 store 已经承载管线日志与阶段状态。
 *
 * 两条纪律：
 * 1. 切换管线必须清空（防跨管线串数据，与 agentStore.setPipelineId 同源考虑）；
 * 2. SSE 增量与首屏全量拉取走同一套状态，重连后先 hydrate 再追事件。
 */

import { create } from 'zustand';

import { supervisorApi } from '@/services/api/supervisor';
import type {
  Attribution,
  BudgetSnapshot,
  DiagnosisReport,
  DispatchResponse,
  ExecRecord,
  ExecRequest,
  ExecResponse,
  LedgerEntry,
  PendingExecApproval,
  PendingWorkerReview,
  SubagentNode,
  SuggestionResponse,
  SupervisorDecision,
} from '@/types/supervisor';

/** 账本在内存里保留的上限（长管线可能上千条，全量渲染会卡） */
export const MAX_LEDGER_ENTRIES = 500;
/** 决策序列上限 */
export const MAX_DECISIONS = 100;

export type SupervisorTab =
  | 'decisions'
  | 'diagnosis'
  | 'cost'
  | 'subagents'
  | 'exec'
  | 'review'
  | 'dispatch';

export interface SupervisorState {
  pipelineId: string | null;
  ledger: LedgerEntry[];
  attempts: Record<string, number>;
  attribution: Attribution | null;
  diagnosis: DiagnosisReport | null;
  decisions: SupervisorDecision[];
  acceptedDegraded: boolean;
  budget: BudgetSnapshot | null;
  subagents: SubagentNode[];
  execRecords: ExecRecord[];
  pendingApprovals: PendingExecApproval[];
  pendingReviews: PendingWorkerReview[];
  autoMode: boolean;
  drawerOpen: boolean;
  activeTab: SupervisorTab;
  loading: boolean;
  error: string;

  setPipeline: (id: string | null) => void;
  hydrate: (pipelineId: string) => Promise<void>;
  hydrateExecution: (pipelineId: string) => Promise<void>;
  hydrateReviews: () => Promise<void>;
  setAutoMode: (pipelineId: string, enabled: boolean) => Promise<void>;
  cancelSubagent: (pipelineId: string, subagentId: string) => Promise<void>;
  reviewWorker: (workerId: string, approve: boolean, confirmHighRisk?: boolean) => Promise<void>;
  dispatchOrder: (
    pipelineId: string,
    body: { target_stage: string; reason?: string; issues?: unknown[]; auto_retry?: boolean },
  ) => Promise<DispatchResponse | null>;
  runSuggestion: (
    pipelineId: string,
    body: { suggestion_id?: string; action?: string; target_stage?: string },
  ) => Promise<SuggestionResponse | null>;
  requestExec: (pipelineId: string, body: ExecRequest) => Promise<ExecResponse | null>;
  approveExec: (
    pipelineId: string,
    approvalId: string,
    confirmHighRisk?: boolean,
  ) => Promise<void>;
  rejectExec: (pipelineId: string, approvalId: string) => Promise<void>;
  applyEvent: (event: { type?: string; data?: unknown }) => void;
  setDrawerOpen: (open: boolean) => void;
  setActiveTab: (tab: SupervisorTab) => void;
  reset: () => void;
}

const EMPTY = {
  ledger: [] as LedgerEntry[],
  attempts: {} as Record<string, number>,
  attribution: null as Attribution | null,
  diagnosis: null as DiagnosisReport | null,
  decisions: [] as SupervisorDecision[],
  acceptedDegraded: false,
  budget: null as BudgetSnapshot | null,
  subagents: [] as SubagentNode[],
  execRecords: [] as ExecRecord[],
  pendingApprovals: [] as PendingExecApproval[],
  pendingReviews: [] as PendingWorkerReview[],
  autoMode: false,
  loading: false,
  error: '',
};

function _attemptsOf(entries: LedgerEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of entries) {
    const stage = String(e.stage || '');
    if (!stage) continue;
    out[stage] = Math.max(out[stage] ?? 0, Number(e.attempt ?? 0));
  }
  return out;
}

export const useSupervisorStore = create<SupervisorState>((set, get) => ({
  pipelineId: null,
  drawerOpen: false,
  activeTab: 'decisions',
  ...EMPTY,

  setPipeline: (id) => {
    const prev = get().pipelineId;
    if (prev === id) return;
    // 换管线一律清空：避免上一轮的诊断书出现在新管线的面板里
    set({ pipelineId: id, drawerOpen: false, activeTab: 'decisions', ...EMPTY });
  },

  hydrateExecution: async (pipelineId) => {
    try {
      const [subagents, exec, approvals, auto] = await Promise.all([
        supervisorApi.getSubagents(pipelineId).catch(() => null),
        supervisorApi.getExecLog(pipelineId).catch(() => null),
        supervisorApi.getPendingApprovals(pipelineId).catch(() => null),
        supervisorApi.getAutoMode(pipelineId).catch(() => null),
      ]);
      set({
        subagents: subagents?.tree ?? [],
        execRecords: exec?.records ?? [],
        pendingApprovals: approvals?.items ?? [],
        autoMode: Boolean(auto?.enabled),
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  hydrateReviews: async () => {
    try {
      const res = await supervisorApi.getPendingWorkerReviews().catch(() => null);
      set({ pendingReviews: res?.items ?? [] });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  setAutoMode: async (pipelineId, enabled) => {
    set({ autoMode: enabled });
    try {
      await supervisorApi.setAutoMode(pipelineId, enabled);
    } catch (e) {
      set({ autoMode: !enabled, error: e instanceof Error ? e.message : String(e) });
    }
  },

  cancelSubagent: async (pipelineId, subagentId) => {
    const mark = (nodes: SubagentNode[]): SubagentNode[] =>
      nodes.map((n) => ({
        ...n,
        status: n.id === subagentId ? ('cancelled' as const) : n.status,
        children: n.children ? mark(n.children) : n.children,
      }));
    set({ subagents: mark(get().subagents) });
    try {
      await supervisorApi.cancelSubagent(pipelineId, subagentId);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  reviewWorker: async (workerId, approve, confirmHighRisk = false) => {
    try {
      await supervisorApi.reviewWorker(workerId, approve, confirmHighRisk);
      set({ pendingReviews: get().pendingReviews.filter((w) => w.id !== workerId) });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  dispatchOrder: async (pipelineId, body) => {
    try {
      const res = await supervisorApi.dispatch(pipelineId, body);
      // 重跑是后台任务：立刻 hydrate 一次，让决策时间线与账本马上看到新条目
      if (res?.retry?.retried) void get().hydrate(pipelineId);
      return res;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  runSuggestion: async (pipelineId, body) => {
    try {
      const res = await supervisorApi.acceptSuggestion(pipelineId, body);
      if (res?.retry?.retried || res?.accepted_degraded) void get().hydrate(pipelineId);
      return res;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  requestExec: async (pipelineId, body) => {
    try {
      const res = await supervisorApi.requestExec(pipelineId, body);
      // 结局可能是「已执行」「等授权」「被拒」——三种都要让列表立刻看到，
      // 所以统一重拉一次执行态（比本地猜测后端落账口径更可靠）。
      await get().hydrateExecution(pipelineId);
      return res;
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return null;
    }
  },

  approveExec: async (pipelineId, approvalId, confirmHighRisk = false) => {
    try {
      await supervisorApi.approveExec(pipelineId, approvalId, confirmHighRisk);
      await get().hydrateExecution(pipelineId);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  rejectExec: async (pipelineId, approvalId) => {
    try {
      await supervisorApi.rejectExec(pipelineId, approvalId);
      await get().hydrateExecution(pipelineId);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  reset: () => set({ pipelineId: null, drawerOpen: false, activeTab: 'decisions', ...EMPTY }),

  hydrate: async (pipelineId) => {
    set({ pipelineId, loading: true, error: '' });
    try {
      const [ledger, attribution, diagnosis, decisions, budget] = await Promise.all([
        supervisorApi.getLedger(pipelineId),
        supervisorApi.getAttribution(pipelineId),
        supervisorApi.getDiagnosis(pipelineId),
        supervisorApi.getDecisions(pipelineId),
        supervisorApi.getBudget(pipelineId).catch(() => null),
      ]);
      set({
        ledger: (ledger?.entries ?? []).slice(-MAX_LEDGER_ENTRIES),
        attempts: ledger?.attempts ?? _attemptsOf(ledger?.entries ?? []),
        attribution: attribution?.found ? attribution : null,
        diagnosis: diagnosis?.found ? diagnosis : null,
        decisions: (decisions?.decisions ?? []).slice(-MAX_DECISIONS),
        acceptedDegraded: Boolean(decisions?.accepted_degraded),
        budget: budget ?? null,
        loading: false,
      });
    } catch (e) {
      // 失败不清空已有数据：断网重连时保留上一帧可见内容，只标错误
      set({ loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  },

  applyEvent: (event) => {
    const type = String(event?.type ?? '');
    if (!type) return;
    const data = event?.data;
    if (type === 'ledger_entry') {
      if (!data || typeof data !== 'object') return;
      const entry = data as LedgerEntry;
      if (!entry.id || !entry.stage) return;
      const ledger = [...get().ledger, entry].slice(-MAX_LEDGER_ENTRIES);
      set({ ledger, attempts: _attemptsOf(ledger) });
      return;
    }
    if (type === 'attribution') {
      if (!data || typeof data !== 'object') return;
      set({ attribution: data as Attribution });
      return;
    }
    if (type === 'diag_report') {
      if (!data || typeof data !== 'object') return;
      set({ diagnosis: data as DiagnosisReport });
      return;
    }
    if (type === 'dispatch') {
      if (!data || typeof data !== 'object') return;
      // 后端有两个来源：调度决策（record_decision，含 strategy）与人工改派单
      // （POST /dispatch 返回的 order，只含 target_stage/source）。后者若直接丢弃，
      // 用户手工派的工就不会出现在调度时间线上——所以补成决策口径再入列。
      const raw = data as Partial<SupervisorDecision> & { source?: string };
      if (!raw.id) return;
      const isManual = !raw.strategy && (Boolean(raw.target_stage) || raw.source === 'manual');
      if (!raw.strategy && !isManual) return;
      const decision: SupervisorDecision = {
        id: String(raw.id),
        strategy: String(raw.strategy ?? 'manual'),
        target_stage: String(raw.target_stage ?? ''),
        reason: String(raw.reason ?? ''),
        allow_degrade: Boolean(raw.allow_degrade),
        aborted: Boolean(raw.aborted),
        stage_attempts: raw.stage_attempts ?? {},
        previous_strategy: raw.previous_strategy,
        mode: String(raw.mode ?? (isManual ? 'manual' : '')),
        ts: raw.ts,
      };
      const decisions = [...get().decisions, decision].slice(-MAX_DECISIONS);
      set({
        decisions,
        acceptedDegraded:
          get().acceptedDegraded || decision.strategy === 'S4_accept_degraded',
      });
      return;
    }
    if (type === 'subagent_start' || type === 'subagent_progress' || type === 'subagent_end') {
      if (!data || typeof data !== 'object') return;
      const payload = data as { subagent_id?: string; role?: string; status?: string };
      const id = String(payload.subagent_id ?? '');
      if (!id) return;
      const existing = get().subagents.find((n) => n.id === id);
      if (!existing) {
        set({
          subagents: [
            ...get().subagents,
            {
              id,
              role: String(payload.role ?? ''),
              kind: 'ephemeral',
              status: (payload.status as SubagentNode['status']) ?? 'pending',
              cancellable: true,
            },
          ],
        });
        return;
      }
      set({
        subagents: get().subagents.map((n) =>
          n.id === id
            ? { ...n, status: (payload.status as SubagentNode['status']) ?? n.status }
            : n,
        ),
      });
      return;
    }
    if (type === 'exec') {
      if (!data || typeof data !== 'object') return;
      const rec = data as ExecRecord & { requestedBy?: string; needsConfirm?: boolean };
      if (!rec.id || !rec.command) return;
      // 待授权条目和执行记录走同一个 `exec` 事件：靠 `requestedBy`/`needsConfirm`
      // 判别（执行记录没有这两个字段，被硬底线拒绝的记录也没有）。
      // 只看执行日志会漏掉「后台有人在高危操作、正等你点授权」。
      const isApproval = rec.requestedBy !== undefined || rec.needsConfirm !== undefined;
      if (isApproval) {
        const approval: PendingExecApproval = {
          id: rec.id,
          command: rec.command,
          riskLevel: (rec.riskLevel as PendingExecApproval['riskLevel']) ?? 'high',
          riskReasons: rec.riskReasons ?? [],
          dangerExplanation: rec.dangerExplanation ?? (rec.riskReasons ?? []).join('；'),
          requestedBy: rec.requestedBy ?? 'supervisor',
          expiresAt: '',
        };
        const others = get().pendingApprovals.filter((a) => a.id !== approval.id);
        set({ pendingApprovals: [...others, approval] });
        return;
      }
      const rest = get().execRecords.filter((r) => r.id !== rec.id);
      const approvals = get().pendingApprovals.filter((a) => a.id !== rec.id);
      set({
        execRecords: [...rest, rec].slice(-MAX_LEDGER_ENTRIES),
        pendingApprovals: approvals,
      });
    }
  },

  setDrawerOpen: (open) => set({ drawerOpen: open }),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
