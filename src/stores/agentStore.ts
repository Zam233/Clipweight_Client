import { create } from 'zustand';
import type { Timeline } from '@/types/timeline';
import type {
  PipelinePhase,
  AgentSuggestion,
  AgentChatMessage,
  PipelineRequest,
} from '@/types/pipeline';
import type {
  RequirementsStatus,
  RequirementMessage,
  CreativeBrief,
  ProductionPlan,
} from '@/types/persona';

interface AgentState {
  // Pipeline state
  pipelineId: string | null;
  phase: PipelinePhase;
  progress: number;
  agentTimeline: Timeline | null;
  suggestions: AgentSuggestion[];
  chatMessages: AgentChatMessage[];
  error: string | null;
  isStreaming: boolean;

  // Requirements Agent state
  requirementsSessionId: string | null;
  requirementsStatus: RequirementsStatus;
  requirementsMessages: RequirementMessage[];
  creativeBrief: CreativeBrief | null;
  productionPlan: ProductionPlan | null;

  // Pipeline actions
  setPipelineId: (id: string | null) => void;
  updatePhase: (phase: PipelinePhase, progress?: number) => void;
  setAgentTimeline: (timeline: Timeline | null) => void;
  addSuggestion: (suggestion: AgentSuggestion) => void;
  clearSuggestions: () => void;
  addChatMessage: (message: AgentChatMessage) => void;
  setError: (error: string | null) => void;
  setStreaming: (streaming: boolean) => void;
  resetPipeline: () => void;

  // Requirements actions
  setRequirementsSession: (sessionId: string | null) => void;
  setRequirementsStatus: (status: RequirementsStatus) => void;
  addRequirementsMessage: (message: RequirementMessage) => void;
  setCreativeBrief: (brief: CreativeBrief | null) => void;
  setProductionPlan: (plan: ProductionPlan | null) => void;
  resetRequirements: () => void;
}

export const useAgentStore = create<AgentState>((set) => ({
  pipelineId: null,
  phase: 'idle',
  progress: 0,
  agentTimeline: null,
  suggestions: [],
  chatMessages: [],
  error: null,
  isStreaming: false,

  requirementsSessionId: null,
  requirementsStatus: 'idle',
  requirementsMessages: [],
  creativeBrief: null,
  productionPlan: null,

  setPipelineId: (id) => set({ pipelineId: id }),

  updatePhase: (phase, progress) =>
    set((state) => ({
      phase,
      progress: progress ?? state.progress,
    })),

  setAgentTimeline: (timeline) => set({ agentTimeline: timeline }),

  addSuggestion: (suggestion) =>
    set((state) => ({
      suggestions: [...state.suggestions, suggestion],
    })),

  clearSuggestions: () => set({ suggestions: [] }),

  addChatMessage: (message) =>
    set((state) => ({
      chatMessages: [...state.chatMessages, message],
    })),

  setError: (error) => set({ error }),

  setStreaming: (streaming) => set({ isStreaming: streaming }),

  resetPipeline: () =>
    set({
      pipelineId: null,
      phase: 'idle',
      progress: 0,
      agentTimeline: null,
      suggestions: [],
      error: null,
      isStreaming: false,
    }),

  setRequirementsSession: (sessionId) =>
    set({ requirementsSessionId: sessionId }),

  setRequirementsStatus: (status) =>
    set({ requirementsStatus: status }),

  addRequirementsMessage: (message) =>
    set((state) => ({
      requirementsMessages: [...state.requirementsMessages, message],
    })),

  setCreativeBrief: (brief) => set({ creativeBrief: brief }),

  setProductionPlan: (plan) => set({ productionPlan: plan }),

  resetRequirements: () =>
    set({
      requirementsSessionId: null,
      requirementsStatus: 'idle',
      requirementsMessages: [],
      creativeBrief: null,
      productionPlan: null,
    }),
}));
