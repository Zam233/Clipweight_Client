import { create } from 'zustand';
import { useTimelineStore } from './timelineStore';

export type SelectionMode = 'select' | 'razor' | 'range';

interface SelectionState {
  /** Currently selected clip IDs */
  selectedClipIds: string[];
  /** MotionSpec keyframe 选中态（时间线 marker → Delete 用） */
  selectedKeyframe: { clipId: string; layerId: string; index: number } | null;
  /** Currently selected track ID (for track-level operations) */
  selectedTrackId: string | null;
  /** Active tool mode */
  toolMode: SelectionMode;
  /** Whether a range selection is active */
  isRangeSelecting: boolean;
  /** Range selection bounds (in seconds) */
  rangeStart: number | null;
  rangeEnd: number | null;

  // Actions
  selectClip: (clipId: string, additive?: boolean) => void;
  selectKeyframe: (keyframe: { clipId: string; layerId: string; index: number } | null) => void;
  deselectAll: () => void;
  selectTrack: (trackId: string | null) => void;
  setToolMode: (mode: SelectionMode) => void;
  setRangeSelecting: (active: boolean) => void;
  setRange: (start: number | null, end: number | null) => void;
  selectClipsInRange: (startSec: number, endSec: number, trackIds?: string[]) => void;
}

export const useSelectionStore = create<SelectionState>((set) => ({
  selectedClipIds: [],
  selectedKeyframe: null,
  selectedTrackId: null,
  toolMode: 'select',
  isRangeSelecting: false,
  rangeStart: null,
  rangeEnd: null,

  selectClip: (clipId, additive = false) =>
    set((state) => ({
      selectedClipIds: additive
        ? state.selectedClipIds.includes(clipId)
          ? state.selectedClipIds.filter((id) => id !== clipId)
          : [...state.selectedClipIds, clipId]
        : [clipId],
      selectedKeyframe: null,
    })),
  selectKeyframe: (keyframe) => set({ selectedKeyframe: keyframe }),

  deselectAll: () =>
    set({ selectedClipIds: [], selectedTrackId: null, rangeStart: null, rangeEnd: null, toolMode: 'select', isRangeSelecting: false }),

  selectTrack: (trackId) =>
    set({ selectedTrackId: trackId }),

  setToolMode: (mode) =>
    set({ toolMode: mode }),

  setRangeSelecting: (active) =>
    set({ isRangeSelecting: active }),

  setRange: (start, end) =>
    set({ rangeStart: start, rangeEnd: end }),

  selectClipsInRange: (startSec, endSec, trackIds) => {
    const { timeline } = useTimelineStore.getState();
    const ids: string[] = [];
    for (const track of timeline.tracks) {
      if (trackIds && !trackIds.includes(track.id)) continue;
      if (track.hidden || track.locked) continue; // P1-37：隐藏/锁定轨不参与框选
      for (const clip of track.clips) {
        const clipEnd = clip.start_sec + clip.duration_sec;
        if (clip.start_sec < endSec && clipEnd > startSec) {
          ids.push(clip.id);
        }
      }
    }
    set({ selectedClipIds: ids, rangeStart: startSec, rangeEnd: endSec });
  },
}));
