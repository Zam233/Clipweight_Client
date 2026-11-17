import type { MotionSpec, MotionValidationError } from './types';
import { motionSpecOf } from './adapter';

const ALLOWED_EASING = new Set(['linear', 'named', 'cubic-bezier', 'steps', 'hold', 'spring']);
const ALLOWED_TOP = new Set(['schema', 'spec_id', 'duration_sec', 'canvas', 'requires', 'layers', 'camera', 'meta']);
const ALLOWED_LAYER = new Set([
  'id', 'type', 'content', 'layout', 'style', 'text_motion', 'keyframes', 'tracks',
  'motion_path', 'effects', 'mask', 'parent', 'z_index', 'blend_mode',
]);

const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

export function validateDraftSpec(spec: MotionSpec): MotionValidationError[] {
  const errors: MotionValidationError[] = [];
  const add = (layerId: string, field: string, message: string, time?: number) =>
    errors.push({ layerId, field, message, time });

  if (spec.schema !== 'motion_spec/1') add('', 'schema', '仅支持 motion_spec/1');
  if (!spec.spec_id) add('', 'spec_id', 'spec_id 必填');
  if (!finite(spec.duration_sec) || spec.duration_sec <= 0) add('', 'duration_sec', '时长必须大于 0');
  if (!Array.isArray(spec.requires) || spec.requires.length === 0) {
    add('', 'requires', 'requires 必须显式声明能力');
  }
  if (!spec.layers || spec.layers.length < 1 || spec.layers.length > 8) {
    add('', 'layers', 'layers 数量必须为 1..8');
  }
  for (const key of Object.keys(spec as unknown as Record<string, unknown>)) {
    if (!ALLOWED_TOP.has(key)) add('', key, `未知顶层字段 ${key}`);
  }
  for (const layer of spec.layers ?? []) {
    if (!layer.id) add('', 'layers.id', 'layer id 必填');
    for (const key of Object.keys(layer as unknown as Record<string, unknown>)) {
      if (!ALLOWED_LAYER.has(key)) add(layer.id, key, `未知 layer 字段 ${key}`);
    }
    const kfs = layer.keyframes ?? [];
    if (kfs.length === 0) add(layer.id, 'keyframes', '至少一个 keyframe');
    if (kfs.length > 16) add(layer.id, 'keyframes', 'keyframe 超过 16');
    let prev = -Infinity;
    for (const kf of kfs) {
      if (!finite(kf.time) || kf.time < 0 || kf.time > spec.duration_sec) {
        add(layer.id, 'keyframes.time', '时间越界', kf.time);
      }
      if (kf.time < prev) add(layer.id, 'keyframes.time', '时间必须升序', kf.time);
      prev = kf.time;
      const easing = kf.easing;
      if (easing && typeof easing !== 'string') {
        if (!ALLOWED_EASING.has(easing.type)) add(layer.id, 'easing.type', '非法 easing', kf.time);
        if (easing.type === 'cubic-bezier') {
          for (const k of ['x1', 'y1', 'x2', 'y2'] as const) {
            if (!finite(easing[k])) add(layer.id, `easing.${k}`, '贝塞尔参数必须有限', kf.time);
          }
          if ((easing.x1 ?? 0) < 0 || (easing.x1 ?? 0) > 1
            || (easing.x2 ?? 0) < 0 || (easing.x2 ?? 0) > 1) {
            add(layer.id, 'easing.x', '贝塞尔 x 必须 0..1', kf.time);
          }
        }
        if (easing.type === 'steps' && (!Number.isInteger(easing.count)
          || (easing.count ?? 0) < 1 || (easing.count ?? 0) > 60)) {
          add(layer.id, 'easing.count', 'steps 必须 1..60', kf.time);
        }
        if (easing.type === 'spring') {
          if (!finite(easing.stiffness) || easing.stiffness < 20 || easing.stiffness > 1000) {
            add(layer.id, 'easing.stiffness', 'spring stiffness 20..1000', kf.time);
          }
          if (!finite(easing.damping) || easing.damping < 2 || easing.damping > 100) {
            add(layer.id, 'easing.damping', 'spring damping 2..100', kf.time);
          }
        }
      }
      for (const [k, v] of Object.entries(kf)) {
        if (typeof v === 'number' && !Number.isFinite(v)) add(layer.id, k, 'NaN/Infinity', kf.time);
      }
    }
  }
  return errors;
}

export function specFromMetadata(metadata: Record<string, unknown> | undefined): MotionSpec | null {
  return motionSpecOf(metadata);
}
