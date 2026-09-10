/**
 * Snap system — aligns clip edges to nearby clip edges, playhead, markers, zero, and grid.
 */
import type { Track } from '@/types/timeline';
import type { TimelineLayout, Marker } from './types';
import { timeToX } from './types';
import { useSettingsStore } from '@/stores/settingsStore';

export interface SnapResult {
  /** Adjusted delta time (seconds) after snapping */
  deltaTime: number;
  /** Screen X of the active snap guide, or null */
  snapX: number | null;
}

/**
 * Collect all snap target times from the timeline, excluding the clips being dragged.
 */
export function collectSnapTargets(
  tracks: Track[],
  excludeClipIds: Set<string>,
  playheadSec: number,
  markers: Marker[],
  gridRange?: { start: number; end: number },
): number[] {
  const targets = new Set<number>();
  targets.add(0);
  targets.add(playheadSec);
  for (const m of markers) targets.add(m.time);

  const settings = useSettingsStore.getState();
  if (settings.snapToGrid && settings.snapGridSec > 0) {
    const step = settings.snapGridSec;
    // P2-07: 网格目标只生成视口附近（默认再放宽一个视口宽）——旧实现从 0
    // 循环到全时长，1 小时时间线 + 0.05s 网格每次指针移动需 7 万次迭代
    const start = Math.max(0, gridRange?.start ?? 0);
    const end = Math.max(gridRange?.end ?? 60, start + step);
    const firstIdx = Math.floor(start / step);
    const lastIdx = Math.ceil(end / step);
    for (let i = firstIdx; i <= lastIdx; i++) {
      targets.add(+(i * step).toFixed(6));
    }
  }

  for (const track of tracks) {
    if (track.hidden) continue; // P1-37：隐藏轨不参与吸附
    for (const clip of track.clips) {
      if (excludeClipIds.has(clip.id)) continue;
      targets.add(clip.start_sec);
      targets.add(clip.start_sec + clip.duration_sec);
    }
  }
  return [...targets];
}

/**
 * Given candidate edge times from the dragged clip(s) and a raw delta,
 * find the best snap within threshold and return the corrected delta.
 */
export function applySnap(
  candidateEdges: number[],
  rawDelta: number,
  targets: number[],
  layout: TimelineLayout,
  thresholdPx: number,
): SnapResult {
  const thresholdSec = thresholdPx / layout.zoom;
  let bestAdjust = 0;
  let bestDist = thresholdSec;
  let bestTarget: number | null = null;

  for (const edge of candidateEdges) {
    const movedEdge = edge + rawDelta;
    for (const target of targets) {
      const dist = Math.abs(movedEdge - target);
      if (dist < bestDist) {
        bestDist = dist;
        bestAdjust = target - movedEdge;
        bestTarget = target;
      }
    }
  }

  if (bestTarget === null) {
    return { deltaTime: rawDelta, snapX: null };
  }

  return {
    deltaTime: rawDelta + bestAdjust,
    snapX: timeToX(bestTarget, layout),
  };
}
