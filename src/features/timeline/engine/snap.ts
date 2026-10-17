/**
 * Snap system — aligns clip edges to nearby clip edges, playhead, markers, keyframes, zero, and grid.
 */
import type { Track } from '@/types/timeline';
import type { TimelineLayout, Marker } from './types';
import { timeToX } from './types';
import { useSettingsStore } from '@/stores/settingsStore';

/** 吸附目标类型（用于在界面上说明「吸附到什么」，而不是只画一条线） */
export type SnapSource = 'clip' | 'playhead' | 'marker' | 'keyframe' | 'grid' | 'zero';

export interface SnapTarget {
  time: number;
  source: SnapSource;
}

export const SNAP_SOURCE_LABELS: Record<SnapSource, string> = {
  clip: '片段边缘',
  playhead: '播放头',
  marker: '书签',
  keyframe: '关键帧',
  grid: '网格',
  zero: '起点',
};

export interface SnapResult {
  /** Adjusted delta time (seconds) after snapping */
  deltaTime: number;
  /** Screen X of the active snap guide, or null */
  snapX: number | null;
  /** 吸附到的目标类型（未吸附为 null） */
  snapSource: SnapSource | null;
  /** 吸附到的绝对时间（未吸附为 null） */
  snapTime: number | null;
}

/**
 * Collect all snap target times from the timeline, excluding the clips being dragged.
 *
 * O-吸附：在片段边缘 / 播放头 / 书签 / 网格之外，**再加上关键帧时间点**——
 * 关键帧是用户手工放的位置（动画落点、节拍点），比网格更该被吸附。
 * 被拖拽片段自身的关键帧不参与（否则会吸回原地）。
 */
export function collectSnapTargets(
  tracks: Track[],
  excludeClipIds: Set<string>,
  playheadSec: number,
  markers: Marker[],
  gridRange?: { start: number; end: number },
): number[] {
  return collectSnapTargetsDetailed(tracks, excludeClipIds, playheadSec, markers, gridRange)
    .map((t) => t.time);
}

/** 与 `collectSnapTargets` 同源，但保留每个目标来自哪里（界面提示用） */
export function collectSnapTargetsDetailed(
  tracks: Track[],
  excludeClipIds: Set<string>,
  playheadSec: number,
  markers: Marker[],
  gridRange?: { start: number; end: number },
): SnapTarget[] {
  // 同一时间点可能既是片段边缘又是关键帧：**先登记的来源优先**（片段/播放头优先），
  // 因此按来源顺序写入，已存在的时间点不覆盖。
  const byTime = new Map<number, SnapSource>();
  const add = (time: number, source: SnapSource) => {
    if (!Number.isFinite(time)) return;
    const key = +time.toFixed(6);
    if (!byTime.has(key)) byTime.set(key, source);
  };

  add(0, 'zero');
  add(playheadSec, 'playhead');
  for (const m of markers) add(m.time, 'marker');

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
      add(+(i * step).toFixed(6), 'grid');
    }
  }

  for (const track of tracks) {
    if (track.hidden) continue; // P1-37：隐藏轨不参与吸附
    for (const clip of track.clips) {
      const dragging = excludeClipIds.has(clip.id);
      if (!dragging) {
        add(clip.start_sec, 'clip');
        add(clip.start_sec + clip.duration_sec, 'clip');
      }
      // 关键帧时间：编辑器内约定 clip_local 归一化 [0,1]（见 timelineStore.setTimeline）
      if (clip.keyframes?.length) {
        for (const kf of clip.keyframes) {
          const local = Number(kf?.time);
          if (!Number.isFinite(local)) continue;
          const abs = local <= 1 ? clip.start_sec + local * clip.duration_sec : local;
          if (abs < clip.start_sec - 1e-6 || abs > clip.start_sec + clip.duration_sec + 1e-6) continue;
          add(abs, 'keyframe');
        }
      }
    }
  }
  return [...byTime.entries()].map(([time, source]) => ({ time, source }));
}

/**
 * Given candidate edge times from the dragged clip(s) and a raw delta,
 * find the best snap within threshold and return the corrected delta.
 */
export function applySnap(
  candidateEdges: number[],
  rawDelta: number,
  targets: number[] | SnapTarget[],
  layout: TimelineLayout,
  thresholdPx: number,
): SnapResult {
  const thresholdSec = thresholdPx / layout.zoom;
  let bestAdjust = 0;
  let bestDist = thresholdSec;
  let bestTarget: number | null = null;
  let bestSource: SnapSource | null = null;

  for (const edge of candidateEdges) {
    const movedEdge = edge + rawDelta;
    for (const target of targets) {
      const time = typeof target === 'number' ? target : target.time;
      const source: SnapSource = typeof target === 'number' ? 'clip' : target.source;
      const dist = Math.abs(movedEdge - time);
      if (dist < bestDist) {
        bestDist = dist;
        bestAdjust = time - movedEdge;
        bestTarget = time;
        bestSource = source;
      }
    }
  }

  if (bestTarget === null) {
    return { deltaTime: rawDelta, snapX: null, snapSource: null, snapTime: null };
  }

  return {
    deltaTime: rawDelta + bestAdjust,
    snapX: timeToX(bestTarget, layout),
    snapSource: bestSource,
    snapTime: bestTarget,
  };
}
