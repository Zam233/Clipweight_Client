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
  DiagnosisReport,
  LedgerEntry,
  SupervisorDecision,
} from '@/types/supervisor';

/** 账本在内存里保留的上限（长管线可能上千条，全量渲染会卡） */
export const MAX_LEDGER_ENTRIES = 500;
/** 决策序列上限 */
export const MAX_DECISIONS = 100;

export type SupervisorTab = 'decisions' | 'diagnosis' | 'cost';

export interface SupervisorState {
  pipelineId: string | null;
  ledger: LedgerEntry[];
  attempts: Record<string, number>;
  attribution: Attribution | null;
  diagnosis: DiagnosisReport | null;
  decisions: SupervisorDecision[];
  acceptedDegraded: boolean;
  drawerOpen: boolean;
  activeTab: SupervisorTab;
  loading: boolean;
  error: string;

  setPipeline: (id: string | null) => void;
  hydrate: (pipelineId: string) => Promise<void>;
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

  reset: () => set({ pipelineId: null, drawerOpen: false, activeTab: 'decisions', ...EMPTY }),

  hydrate: async (pipelineId) => {
    set({ pipelineId, loading: true, error: '' });
    try {
      const [ledger, attribution, diagnosis, decisions] = await Promise.all([
        supervisorApi.getLedger(pipelineId),
        supervisorApi.getAttribution(pipelineId),
        supervisorApi.getDiagnosis(pipelineId),
        supervisorApi.getDecisions(pipelineId),
      ]);
      set({
        ledger: (ledger?.entries ?? []).slice(-MAX_LEDGER_ENTRIES),
        attempts: ledger?.attempts ?? _attemptsOf(ledger?.entries ?? []),
        attribution: attribution?.found ? attribution : null,
        diagnosis: diagnosis?.found ? diagnosis : null,
        decisions: (decisions?.decisions ?? []).slice(-MAX_DECISIONS),
        acceptedDegraded: Boolean(decisions?.accepted_degraded),
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
      const decision = data as SupervisorDecision;
      if (!decision.id || !decision.strategy) return;
      const decisions = [...get().decisions, decision].slice(-MAX_DECISIONS);
      set({
        decisions,
        acceptedDegraded:
          get().acceptedDegraded || decision.strategy === 'S4_accept_degraded',
      });
    }
  },

  setDrawerOpen: (open) => set({ drawerOpen: open }),
  setActiveTab: (tab) => set({ activeTab: tab }),
}));
