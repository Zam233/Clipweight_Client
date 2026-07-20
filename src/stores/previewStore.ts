import { create } from 'zustand';

interface PreviewState {
  isPlaying: boolean;
  currentTimeSec: number;
  durationSec: number;
  fps: number;
  volume: number;
  isMuted: boolean;
  isFullscreen: boolean;
  zoomLevel: number;
  showSafeArea: boolean;
  loopRegion: { start: number; end: number } | null;

  // Actions
  setPlaying: (playing: boolean) => void;
  togglePlay: () => void;
  setCurrentTime: (timeSec: number) => void;
  setDuration: (durationSec: number) => void;
  setFps: (fps: number) => void;
  setVolume: (volume: number) => void;
  toggleMute: () => void;
  setFullscreen: (fullscreen: boolean) => void;
  setZoomLevel: (zoom: number) => void;
  toggleSafeArea: () => void;
  setLoopRegion: (region: { start: number; end: number } | null) => void;
  stepForward: () => void;
  stepBackward: () => void;
  seekToStart: () => void;
  seekToEnd: () => void;
}

export const usePreviewStore = create<PreviewState>((set, get) => ({
  isPlaying: false,
  currentTimeSec: 0,
  durationSec: 0,
  fps: 30,
  volume: 1,
  isMuted: false,
  isFullscreen: false,
  zoomLevel: 1,
  showSafeArea: false,
  loopRegion: null,

  setPlaying: (playing) => set({ isPlaying: playing }),
  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setCurrentTime: (timeSec) => set({ currentTimeSec: timeSec }),
  setDuration: (durationSec) => set({ durationSec }),
  setFps: (fps) => set({ fps }),
  setVolume: (volume) => set({ volume }),
  toggleMute: () => set((state) => ({ isMuted: !state.isMuted })),
  setFullscreen: (fullscreen) => set({ isFullscreen: fullscreen }),
  setZoomLevel: (zoom) => set({ zoomLevel: zoom }),
  toggleSafeArea: () => set((state) => ({ showSafeArea: !state.showSafeArea })),
  setLoopRegion: (region) => set({ loopRegion: region }),

  stepForward: () =>
    set((state) => ({
      currentTimeSec: Math.min(
        state.durationSec,
        state.currentTimeSec + 1 / state.fps,
      ),
    })),

  stepBackward: () =>
    set((state) => ({
      currentTimeSec: Math.max(0, state.currentTimeSec - 1 / state.fps),
    })),

  seekToStart: () => set({ currentTimeSec: 0 }),
  seekToEnd: () => set((state) => ({ currentTimeSec: state.durationSec })),
}));
