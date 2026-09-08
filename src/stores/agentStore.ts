import { create } from 'zustand';
import { uid } from '@/lib/utils';
import type { Timeline } from '@/types/timeline';
import type {
  PipelinePhase,
  AgentSuggestion,
  LogEntry,
  AgentStat,
  PipelineSummary,
} from '@/types/pipeline';
import type {
  RequirementsStatus,
  RequirementMessage,
  CreativeBrief,
  ProductionPlan,
} from '@/types/persona';

/** 各管线相位对应的进度百分比（未显式给定进度时按此推导）。 */
// E7: 日志上限——防止长管线日志无界增长导致 DOM 卡顿
export const MAX_LOG_ENTRIES = 500;

const PHASE_PROGRESS: Record<string, number> = {
  idle: 0,
  structure: 15,
  material: 35,
  edit: 55,
  animation: 70,
  audio: 85,
  quality: 95,
  self_heal: 90,
  completed: 100,
  failed: 100,
};

interface Annotation {
  id: string;
  type: 'comment' | 'dislike' | 'like';
  text: string;
  note?: string;
}

interface AgentState {
  // Pipeline state
  pipelineId: string | null;
  phase: PipelinePhase;
  progress: number;
  agentTimeline: Timeline | null;
  suggestions: AgentSuggestion[];
  error: string | null;
  cancelling: boolean;
  /** 轮72：本轮管线启动时刻（epoch ms）——运行中显示耗时；无管线为 null */
  pipelineStartedAt: number | null;

  // Log entries
  logEntries: LogEntry[];
  agentStats: AgentStat[];
  pipelineSummary: PipelineSummary | null;

  // MG 动画进度（动画阶段逐片段生成）
  mgTotal: number;
  mgDone: number;

  // Requirements Agent state
  requirementsSessionId: string | null;
  requirementsStatus: RequirementsStatus;
  requirementsMessages: RequirementMessage[];
  requirementsBusy: boolean;
  creativeBrief: CreativeBrief | null;
  productionPlan: ProductionPlan | null;

  // Annotations for review mode
  annotations: Annotation[];

  // Full-screen review mode
  reviewMode: 'brief' | 'plan' | null;

  // Pipeline actions
  setPipelineId: (id: string | null) => void;
  updatePhase: (phase: PipelinePhase, progress?: number) => void;
  setAgentTimeline: (timeline: Timeline | null) => void;
  addSuggestion: (suggestion: AgentSuggestion) => void;
  removeSuggestion: (id: string) => void;
  clearSuggestions: () => void;
  setError: (error: string | null) => void;
  setCancelling: (busy: boolean) => void;
  resetPipeline: () => void;

  // Log actions
  addLogEntry: (entry: Omit<LogEntry, 'id'>) => void;
  addLogEntries: (entries: Omit<LogEntry, 'id'>[]) => void;
  clearLogs: () => void;
  toggleLogExpand: (id: string) => void;
  setAgentStats: (stats: AgentStat[]) => void;
  setPipelineSummary: (summary: PipelineSummary | null) => void;

  // MG 进度 actions
  mgStarted: () => void;
  mgFinished: () => void;
  resetMgProgress: () => void;

  // Requirements actions
  setRequirementsSession: (sessionId: string | null) => void;
  setRequirementsStatus: (status: RequirementsStatus) => void;
  addRequirementsMessage: (message: RequirementMessage) => void;
  /** 轮69：流式追加/收尾——按 id 局部更新已存在的消息 */
  updateRequirementsMessage: (id: string, patch: Partial<RequirementMessage>) => void;
  appendRequirementsDelta: (id: string, text: string) => void;
  setRequirementsBusy: (busy: boolean) => void;
  setCreativeBrief: (brief: CreativeBrief | null) => void;
  setProductionPlan: (plan: ProductionPlan | null) => void;
  resetRequirements: () => void;
  restoreAgentState: (snapshot: {
    requirementsSessionId?: string | null;
    requirementsStatus?: string;
    requirementsMessages?: unknown[];
    creativeBrief?: unknown;
    productionPlan?: unknown;
    logEntries?: unknown[];
  }) => void;

  // Annotation actions
  addAnnotation: (ann: Omit<Annotation, 'id'>) => void;
  removeAnnotation: (id: string) => void;
  clearAnnotations: () => void;
  setReviewMode: (mode: 'brief' | 'plan' | null) => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  pipelineId: null,
  phase: 'idle',
  progress: 0,
  agentTimeline: null,
  suggestions: [],
  error: null,
  cancelling: false,
  pipelineStartedAt: null,

  logEntries: [],
  agentStats: [],
  pipelineSummary: null,
  mgTotal: 0,
  mgDone: 0,

  requirementsSessionId: null,
  requirementsStatus: 'idle',
  requirementsMessages: [],
  requirementsBusy: false,
  creativeBrief: null,
  productionPlan: null,

  annotations: [],
  reviewMode: null,

  // 轮72：同一 pipelineId 重复设置不重置计时；新 id 记启动时刻，清空 id 清计时
  setPipelineId: (id) =>
    set((state) => ({
      pipelineId: id,
      pipelineStartedAt: id
        ? (state.pipelineId === id ? state.pipelineStartedAt : Date.now())
        : null,
    })),

  updatePhase: (phase, progress) =>
    set((state) => ({
      phase,
      // 未显式给定进度时，按相位在管线中的位置推导，避免进度条全程卡在初始值
      progress: progress ?? PHASE_PROGRESS[phase] ?? state.progress,
    })),

  setAgentTimeline: (timeline) => set({ agentTimeline: timeline }),

  addSuggestion: (suggestion) =>
    set((state) => ({
      // 批B(P1-2)：同文案去重 + 上限 8 条（重连回放/多次完成不再无限堆叠）
      suggestions: (() => {
        const base = state.suggestions.filter((s) => s.message !== suggestion.message);
        return [...base, suggestion].slice(-8);
      })(),
    })),

  removeSuggestion: (id) =>
    set((state) => ({ suggestions: state.suggestions.filter((s) => s.id !== id) })),

  clearSuggestions: () => set({ suggestions: [] }),

  setError: (error) => set({ error }),

  setCancelling: (busy) => set({ cancelling: busy }),

  resetPipeline: () =>
    set({
      pipelineId: null,
      phase: 'idle',
      progress: 0,
      agentTimeline: null,
      suggestions: [],
      error: null,
      cancelling: false,
      pipelineStartedAt: null,
      logEntries: [],
      agentStats: [],
      pipelineSummary: null,
      mgTotal: 0,
      mgDone: 0,
    }),

  addLogEntry: (entry) =>
    set((state) => ({
      logEntries: [...state.logEntries, { ...entry, id: uid('log') }].slice(-MAX_LOG_ENTRIES),
    })),

  addLogEntries: (entries) =>
    set((state) => ({
      logEntries: [
        ...state.logEntries,
        ...entries.map((e) => ({ ...e, id: uid('log') })),
      ].slice(-MAX_LOG_ENTRIES),
    })),

  clearLogs: () => set({ logEntries: [], agentStats: [], pipelineSummary: null, mgTotal: 0, mgDone: 0 }),
  toggleLogExpand: (id) =>
    set((state) => ({
      logEntries: state.logEntries.map((e) =>
        e.id === id ? { ...e, expanded: !e.expanded } : e,
      ),
    })),

  setAgentStats: (stats) => set({ agentStats: stats }),
  setPipelineSummary: (summary) => set({ pipelineSummary: summary }),

  mgStarted: () =>
    set((state) => ({ mgTotal: state.mgTotal + 1 })),
  mgFinished: () =>
    set((state) => ({ mgDone: state.mgDone + 1 })),
  resetMgProgress: () => set({ mgTotal: 0, mgDone: 0 }),

  setRequirementsSession: (sessionId) =>
    set({ requirementsSessionId: sessionId }),

  setRequirementsStatus: (status) =>
    set({ requirementsStatus: status }),

  setRequirementsBusy: (busy) => set({ requirementsBusy: busy }),

  addRequirementsMessage: (message) =>
    set((state) => {
      // 轮72：内存上限 200 条（草稿本就只存 50 条，长会话不再无限增长）
      const msgs = [...state.requirementsMessages, message].slice(-200);
      saveDraft({ messages: msgs, brief: state.creativeBrief, plan: state.productionPlan, sessionId: state.requirementsSessionId, status: state.requirementsStatus });
      return { requirementsMessages: msgs };
    }),

  updateRequirementsMessage: (id, patch) =>
    set((state) => {
      const msgs = state.requirementsMessages.map((m) => (m.id === id ? { ...m, ...patch } : m));
      saveDraft({ messages: msgs, brief: state.creativeBrief, plan: state.productionPlan, sessionId: state.requirementsSessionId, status: state.requirementsStatus });
      return { requirementsMessages: msgs };
    }),

  appendRequirementsDelta: (id, text) =>
    set((state) => {
      const msgs = state.requirementsMessages.map((m) =>
        m.id === id ? { ...m, content: m.content + text } : m);
      return { requirementsMessages: msgs };
    }),

  setCreativeBrief: (brief) =>
    set((state) => { saveDraft({ brief, plan: state.productionPlan }); return { creativeBrief: brief }; }),
  setProductionPlan: (plan) =>
    set((state) => { saveDraft({ plan, brief: state.creativeBrief }); return { productionPlan: plan }; }),

  resetRequirements: () =>
    set({
      requirementsSessionId: null,
      requirementsStatus: 'idle',
      requirementsMessages: [],
      requirementsBusy: false,
      creativeBrief: null,
      productionPlan: null,
      annotations: [],
      reviewMode: null,
    }),

  restoreAgentState: (snapshot) =>
    set({
      requirementsSessionId: snapshot.requirementsSessionId ?? null,
      requirementsStatus: (snapshot.requirementsStatus as RequirementsStatus) ?? 'idle',
      requirementsMessages: (snapshot.requirementsMessages as RequirementMessage[]) ?? [],
      creativeBrief: (snapshot.creativeBrief as CreativeBrief) ?? null,
      productionPlan: (snapshot.productionPlan as ProductionPlan) ?? null,
      logEntries: (snapshot.logEntries as LogEntry[]) ?? [],
    }),

  addAnnotation: (ann) =>
    set((state) => ({ annotations: [...state.annotations, { ...ann, id: uid('ann') }] })),
  removeAnnotation: (id) =>
    set((state) => ({ annotations: state.annotations.filter((a) => a.id !== id) })),
  clearAnnotations: () => set({ annotations: [] }),
  setReviewMode: (mode) => set({ reviewMode: mode }),
}));

const DRAFT_KEY = 'clipwright_requirements_draft';

function saveDraft(partial: {
  messages?: RequirementMessage[];
  brief?: CreativeBrief | null;
  plan?: ProductionPlan | null;
  sessionId?: string | null;
  status?: RequirementsStatus;
}) {
  try {
    const current = JSON.parse(localStorage.getItem(DRAFT_KEY) || '{}');
    const merged = { ...current, ...partial, ts: Date.now() };
    if (partial.messages) merged.messages = partial.messages.slice(-50);
    localStorage.setItem(DRAFT_KEY, JSON.stringify(merged));
  } catch { /* ignore */ }
}

export function loadRequirementsDraft(): {
  messages: RequirementMessage[];
  brief: CreativeBrief | null;
  plan: ProductionPlan | null;
  sessionId: string | null;
  status: RequirementsStatus;
} | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    // Guard against missing/invalid timestamp (NaN comparison would never expire)
    if (typeof draft.ts !== 'number' || Date.now() - draft.ts > 86400000) {
      localStorage.removeItem(DRAFT_KEY);
      return null;
    }
    return draft;
  } catch { return null; }
}

export function clearRequirementsDraft() {
  localStorage.removeItem(DRAFT_KEY);
}
