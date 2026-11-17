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
