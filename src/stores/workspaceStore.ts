import { create } from 'zustand';
import { loadPref, savePref } from '@/services/storage/localPrefs';

interface WorkspacePanel {
  assets: boolean;
  properties: boolean;
  agent: boolean;
}

interface WorkspaceState {
  /** Panel visibility */
  panels: WorkspacePanel;
  /** Panel widths in pixels */
  panelWidths: {
    assets: number;
    properties: number;
    agent: number;
  };
  /** Timeline height in pixels */
  timelineHeight: number;
  /** Whether the timeline is collapsed */
  timelineCollapsed: boolean;
  /** Active bottom tab in timeline area */
  activeBottomTab: 'timeline' | 'keyframes' | 'audio';

  // Actions
  togglePanel: (panel: keyof WorkspacePanel) => void;
  setPanelWidth: (panel: keyof WorkspacePanel, width: number) => void;
  setTimelineHeight: (height: number) => void;
  toggleTimelineCollapsed: () => void;
  setActiveBottomTab: (tab: 'timeline' | 'keyframes' | 'audio') => void;
  resetLayout: () => void;
}

const DEFAULT_PANEL_WIDTHS = {
  assets: 280,
  properties: 300,
  agent: 320,
};

const DEFAULT_TIMELINE_HEIGHT = 280;

/** Persisted layout (survives reloads via localStorage). */
const persisted = loadPref('layout', {
  panels: { assets: true, properties: true, agent: true },
  panelWidths: { ...DEFAULT_PANEL_WIDTHS },
  timelineHeight: DEFAULT_TIMELINE_HEIGHT,
});

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  panels: { ...persisted.panels },
  panelWidths: { ...persisted.panelWidths },
  timelineHeight: persisted.timelineHeight,
  timelineCollapsed: false,
  activeBottomTab: 'timeline',

  togglePanel: (panel) =>
    set((state) => ({
      panels: { ...state.panels, [panel]: !state.panels[panel] },
    })),

  setPanelWidth: (panel, width) =>
    set((state) => ({
      panelWidths: { ...state.panelWidths, [panel]: Math.max(200, Math.min(500, width)) },
    })),

  setTimelineHeight: (height) =>
    set({ timelineHeight: Math.max(150, Math.min(600, height)) }),

  toggleTimelineCollapsed: () =>
    set((state) => ({ timelineCollapsed: !state.timelineCollapsed })),

  setActiveBottomTab: (tab) => set({ activeBottomTab: tab }),

  resetLayout: () =>
    set({
      panels: { assets: true, properties: true, agent: true },
      panelWidths: { ...DEFAULT_PANEL_WIDTHS },
      timelineHeight: DEFAULT_TIMELINE_HEIGHT,
      timelineCollapsed: false,
    }),
}));

// Persist layout changes (debounced via simple throttle on each change)
useWorkspaceStore.subscribe((state) => {
  savePref('layout', {
    panels: state.panels,
    panelWidths: state.panelWidths,
    timelineHeight: state.timelineHeight,
  });
});
