import type { MotionSpec } from './types';
import { cloneSpec } from './migration';

/** 编辑器纯函数：只修改本地 draft，不写 timeline/hash。 */
export function updateKeyframeTime(spec: MotionSpec, layerId: string, index: number, seconds: number): MotionSpec {
  const next = cloneSpec(spec);
  const layer = next.layers.find((l) => l.id === layerId);
  if (!layer || !layer.keyframes?.[index]) return next;
  layer.keyframes[index].time = Math.max(0, Math.min(next.duration_sec, seconds));
  layer.keyframes.sort((a, b) => a.time - b.time);
  return next;
}

export function addKeyframe(spec: MotionSpec, layerId: string, seconds: number): MotionSpec {
  const next = cloneSpec(spec);
  const layer = next.layers.find((l) => l.id === layerId);
  if (!layer) return next;
  const time = Math.max(0, Math.min(next.duration_sec, seconds));
  if (layer.keyframes.some((k) => Math.abs(k.time - time) < 0.001)) return next;
  layer.keyframes.push({ time, opacity: 1 });
  layer.keyframes.sort((a, b) => a.time - b.time);
  return next;
}

export function removeKeyframe(spec: MotionSpec, layerId: string, index: number): MotionSpec {
  const next = cloneSpec(spec);
  const layer = next.layers.find((l) => l.id === layerId);
  if (!layer || !layer.keyframes?.[index]) return next;
  layer.keyframes.splice(index, 1);
  return next;
}

export function updateKeyframeValue(
  spec: MotionSpec, layerId: string, index: number, key: string, value: number,
): MotionSpec {
  const next = cloneSpec(spec);
  const layer = next.layers.find((l) => l.id === layerId);
  const kf = layer?.keyframes?.[index];
  if (!kf || !Number.isFinite(value)) return next;
  (kf as Record<string, unknown>)[key] = value;
  return next;
}


export function updateKeyframeEasing(
  spec: MotionSpec, layerId: string, index: number, easing: Record<string, unknown>,
): MotionSpec {
  const next = cloneSpec(spec);
  const layer = next.layers.find((l) => l.id === layerId);
  const kf = layer?.keyframes?.[index];
  if (!kf) return next;
  kf.easing = easing as never;
  return next;
}


export function updateCameraValue(
  spec: MotionSpec, index: number, key: string, value: number,
): MotionSpec {
  const next = cloneSpec(spec);
  const kf = next.camera?.keyframes?.[index];
  if (!kf || !Number.isFinite(value)) return next;
  (kf as Record<string, unknown>)[key] = value;
  return next;
}


export function updatePathType(spec: MotionSpec, layerId: string, type: string): MotionSpec {
  const next = cloneSpec(spec);
  const layer = next.layers.find((l) => l.id === layerId);
  if (!layer?.motion_path) return next;
  layer.motion_path.type = type as never;
  return next;
}

export function updatePathPoint(
  spec: MotionSpec, layerId: string, index: number, axis: 'x' | 'y', value: number,
): MotionSpec {
  const next = cloneSpec(spec);
  const point = next.layers.find((l) => l.id === layerId)?.motion_path?.points?.[index];
  if (!point || !Number.isFinite(value)) return next;
  point[axis] = value;
  return next;
}


export function updateTrackSegment(
  spec: MotionSpec, layerId: string, trackIndex: number, segmentIndex: number,
  key: 'start' | 'end', value: number,
): MotionSpec {
  const next = cloneSpec(spec);
  const seg = next.layers.find((l) => l.id === layerId)?.tracks?.[trackIndex]?.segments?.[segmentIndex];
  if (!seg || !Number.isFinite(value)) return next;
  seg[key] = value;
  return next;
}


export function removeEffect(spec: MotionSpec, layerId: string, index: number): MotionSpec {
  const next = cloneSpec(spec);
  const layer = next.layers.find((l) => l.id === layerId);
  if (!layer?.effects?.[index]) return next;
  layer.effects.splice(index, 1);
  return next;
}


export function addEffect(spec: MotionSpec, layerId: string, effect: Record<string, unknown>): MotionSpec {
  const next = cloneSpec(spec);
  const layer = next.layers.find((l) => l.id === layerId);
  if (!layer) return next;
  layer.effects = [...(layer.effects ?? []), effect];
  return next;
}
