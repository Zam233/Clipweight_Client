import type { MotionKeyframe, MotionSpec } from './types';

export interface MotionSpecMetadataMigration {
  metadata: Record<string, unknown>;
  readOnly: boolean;
  legacy: boolean;
  reason?: string;
}

/**
 * 旧项目 metadata 前端迁移只做“识别 + 只读”，不擅自改写 spec 或 hash。
 * 真正迁移必须由后端版本化 API 执行。
 */
export function migrateMotionSpecMetadata(
  metadata: Record<string, unknown> | undefined,
): MotionSpecMetadataMigration {
  const meta = { ...(metadata ?? {}) };
  if (meta.motion_spec === undefined) return { metadata: meta, readOnly: false, legacy: false };
  const raw = meta.motion_spec;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { metadata: meta, readOnly: true, legacy: false, reason: 'motion_spec 形状非法' };
  }
  const schema = (raw as Record<string, unknown>).schema;
  if (schema !== 'motion_spec/1') {
    return {
      metadata: { ...meta, motion_spec_legacy: true },
      readOnly: true, legacy: true,
      reason: `不支持的 MotionSpec 版本: ${String(schema)}`,
    };
  }
  return { metadata: meta, readOnly: false, legacy: false };
}

/** 仅用于本地 draft/缓存键；不是服务端权威 hash。 */
export function specRevisionKey(spec: MotionSpec | null): string {
  if (!spec) return '';
  return `${spec.spec_id}:${spec.duration_sec}:${spec.layers?.length ?? 0}`;
}

export function cloneSpec(spec: MotionSpec): MotionSpec {
  return JSON.parse(JSON.stringify(spec)) as MotionSpec;
}

export function specKeyframesToUi(spec: MotionSpec, layerId: string): Array<{
  normalized: number; keyframe: MotionKeyframe;
}> {
  const layer = spec.layers.find((l) => l.id === layerId);
  if (!layer) return [];
  return (layer.keyframes ?? []).map((kf) => ({
    normalized: spec.duration_sec > 0 ? kf.time / spec.duration_sec : 0,
    keyframe: kf,
  }));
}

export function uiKeyframesToSpec(
  spec: MotionSpec, layerId: string,
  frames: Array<{ normalized: number; keyframe: MotionKeyframe }>,
): MotionSpec {
  const next = cloneSpec(spec);
  const layer = next.layers.find((l) => l.id === layerId);
  if (!layer) return next;
  layer.keyframes = frames
    .map(({ normalized, keyframe }) => ({
      ...keyframe,
      time: Math.max(0, Math.min(1, normalized)) * next.duration_sec,
    }))
    .sort((a, b) => a.time - b.time);
  return next;
}
