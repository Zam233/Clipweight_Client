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
  isLooping: boolean;
  shuttleSpeed: number;
  playbackSpeed: number;

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
  toggleLoop: () => void;
  stepForward: () => void;
  stepBackward: () => void;
  seekToStart: () => void;
  seekToEnd: () => void;
  shuttleReverse: () => void;
  shuttleForward: () => void;
  shuttleStop: () => void;
  setMarkerIn: () => void;
  setMarkerOut: () => void;
  setPlaybackSpeed: (speed: number) => void;
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
  isLooping: false,
  shuttleSpeed: 0,
  playbackSpeed: 1,

  setPlaying: (playing) => set({ isPlaying: playing }),
  togglePlay: () => set((state) => ({ isPlaying: !state.isPlaying })),
  setCurrentTime: (timeSec) =>
    set((state) => ({
      // duration 尚未同步时不做上限钳位，避免 playhead 卡在 0
      currentTimeSec:
        state.durationSec > 0
          ? Math.max(0, Math.min(timeSec, state.durationSec))
          : Math.max(0, timeSec),
    })),
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
  toggleLoop: () => set((state) => ({ isLooping: !state.isLooping })),
  shuttleReverse: () => set({ isPlaying: true, shuttleSpeed: -1 }),
  shuttleForward: () => set({ isPlaying: true, shuttleSpeed: 1 }),
  shuttleStop: () => set({ isPlaying: false, shuttleSpeed: 0 }),
  setMarkerIn: () => {
    const { currentTimeSec, loopRegion } = get();
    set({ loopRegion: { start: currentTimeSec, end: loopRegion?.end ?? get().durationSec } });
  },
  setMarkerOut: () => {
    const { currentTimeSec, loopRegion } = get();
    set({ loopRegion: { start: loopRegion?.start ?? 0, end: currentTimeSec } });
  },
  setPlaybackSpeed: (speed) => set({ playbackSpeed: Math.max(0.25, Math.min(4, speed)) }),
}));
