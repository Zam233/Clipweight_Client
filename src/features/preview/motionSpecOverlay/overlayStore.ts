import { create } from 'zustand';

interface OverlayState {
  activeClipIds: string[];
  setActiveClipIds: (ids: string[]) => void;
  clear: () => void;
}

export const useOverlayStore = create<OverlayState>((set) => ({
  activeClipIds: [],
  setActiveClipIds: (ids) => set({ activeClipIds: ids }),
  clear: () => set({ activeClipIds: [] }),
}));
