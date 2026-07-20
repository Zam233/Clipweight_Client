/**
 * Snap system — aligns clip edges to nearby clip edges, playhead, markers, and zero.
 */
import type { Track } from '@/types/timeline';
import type { TimelineLayout } from './types';
import { timeToX } from './types';

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
  markers: number[],
): number[] {
  const targets = new Set<number>();
  targets.add(0);
  targets.add(playheadSec);
  for (const m of markers) targets.add(m);
  for (const track of tracks) {
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
