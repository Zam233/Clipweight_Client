import { create } from 'zustand';

interface OverlayState {
  activeClipIds: string[];
  generation: number;
  canvasGeneration: number;
  requestOverlay: (ids: string[]) => void;
  releaseOverlay: () => void;
  markCanvasDrawn: (generation: number) => void;
  clear: () => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  activeClipIds: [],
  generation: 0,
  canvasGeneration: 0,
  requestOverlay: (ids) => set((s) => ({
    activeClipIds: ids,
    generation: s.generation + 1,
  })),
  releaseOverlay: () => set((s) => ({
    activeClipIds: [],
    generation: s.generation + 1,
  })),
  markCanvasDrawn: (generation) => set({ canvasGeneration: generation }),
  clear: () => set({ activeClipIds: [], generation: 0, canvasGeneration: 0 }),
}));
