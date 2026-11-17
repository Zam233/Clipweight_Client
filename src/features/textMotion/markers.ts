import type { MotionSpec } from './types';

export interface MotionSpecMarker {
  clipId: string;
  layerId: string;
  time: number;
  properties: string[];
}

/** 只读 marker 数据；不写入 clip.keyframes。 */
export function motionSpecMarkers(clipId: string, spec: MotionSpec | null): MotionSpecMarker[] {
  if (!spec) return [];
  const out: MotionSpecMarker[] = [];
  for (const layer of spec.layers ?? []) {
    for (const kf of layer.keyframes ?? []) {
      if (!Number.isFinite(kf.time)) continue;
      out.push({
        clipId, layerId: layer.id, time: kf.time,
        properties: Object.keys(kf).filter((k) => k !== 'time' && k !== 'easing'),
      });
    }
  }
  return out.sort((a, b) => a.time - b.time);
}
