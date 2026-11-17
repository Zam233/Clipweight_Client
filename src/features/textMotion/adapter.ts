import type { Clip } from '@/types/timeline';
import type {
  MotionCompiledArtifact, MotionKeyframe, MotionLayer, MotionPreviewState,
  MotionSpec, MotionSpecVersion,
} from './types';

export const MOTION_SPEC_VERSION: MotionSpecVersion = 'motion_spec/1';

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

export function motionSpecOf(metadata: Record<string, unknown> | undefined): MotionSpec | null {
  if (!metadata) return null;
  const raw = metadata.motion_spec;
  if (!isRecord(raw)) return null;
  if (raw.schema !== MOTION_SPEC_VERSION) return null;
  if (typeof raw.duration_sec !== 'number' || !Array.isArray(raw.layers)) return null;
  return raw as unknown as MotionSpec;
}

export function motionSpecMetaOf(metadata: Record<string, unknown> | undefined) {
  const raw = metadata ?? {};
  return {
    hash: typeof raw.motion_spec_hash === 'string' ? raw.motion_spec_hash : '',
    version: typeof raw.motion_spec_version === 'string' ? raw.motion_spec_version : '',
    provider: typeof raw.text_provider_id === 'string' ? raw.text_provider_id : '',
  };
}

export function motionArtifactOf(metadata: Record<string, unknown> | undefined): MotionCompiledArtifact {
  const raw = metadata ?? {};
  const mg = isRecord(raw.mg_def) ? raw.mg_def : null;
  const ops = Array.isArray(raw.preview_ops)
    ? raw.preview_ops.filter(isRecord) as Array<Record<string, unknown>>
    : [];
  const fidelity = raw.fidelity === 'exact' || raw.fidelity === 'approx'
    ? raw.fidelity : 'unsupported';
  return {
    mg_def: mg,
    preview_ops: ops,
    fidelity,
    spec_hash: typeof raw.motion_spec_hash === 'string' ? raw.motion_spec_hash : undefined,
    compiler_version: typeof raw.motion_spec_compiler_version === 'string'
      ? raw.motion_spec_compiler_version : undefined,
  };
}

/** 只读预览状态；不判断产物是否“像素一致”，只判断是否可安全进入绘制。 */
export function motionPreviewState(clip: Clip): MotionPreviewState {
  const meta = clip.metadata ?? {};
  const spec = motionSpecOf(meta);
  const specFlag = meta.motion_spec !== undefined;
  if (!specFlag) return 'plain';
  if (!spec) return 'invalid_spec';
  const artifact = motionArtifactOf(meta);
  if (!artifact.mg_def) return 'spec_without_artifact';
  if (meta.fidelity === 'unsupported') return 'invalid_spec';
  return 'ready';
}

export function isMotionSpecClip(clip: Clip): boolean {
  return motionSpecOf(clip.metadata) !== null;
}

/** spec 秒 ↔ 通用编辑器 [0,1]；零时长返回 0，不做隐式截断。 */
export function specSecondsToUi(seconds: number, durationSec: number): number {
  if (!Number.isFinite(seconds) || !Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.max(0, Math.min(1, seconds / durationSec));
}

export function uiToSpecSeconds(normalized: number, durationSec: number): number {
  if (!Number.isFinite(normalized) || !Number.isFinite(durationSec) || durationSec <= 0) return 0;
  return Math.max(0, Math.min(1, normalized)) * durationSec;
}

/**
 * 通用 KeyframeEditor 的 easing 在 `clip.keyframes` 的结束帧；
 * MotionSpec 的 easing 在起始帧→下一帧。读写做显式映射，避免直接共用。
 */
export function uiEasingIndexToSpec(index: number): number {
  return Math.max(0, index - 1);
}

export function specEasingIndexToUi(index: number, frameCount: number): number {
  return Math.min(Math.max(0, frameCount - 1), Math.max(0, index) + 1);
}

export function lastSpecKeyframeEditable(keyframeIndex: number, frameCount: number): boolean {
  return keyframeIndex >= 0 && keyframeIndex < frameCount - 1;
}

export function layerById(spec: MotionSpec | null, layerId: string): MotionLayer | null {
  return spec?.layers.find((l) => l.id === layerId) ?? null;
}

export function sortedKeyframes(layer: MotionLayer): MotionKeyframe[] {
  return [...(layer.keyframes ?? [])].sort((a, b) => a.time - b.time);
}

/** 本地缓存/乱序保护用；不是权威 motion_spec_hash。 */
export function draftFingerprint(spec: MotionSpec | null): string {
  if (!spec) return '';
  try {
    return JSON.stringify(spec);
  } catch {
    return '';
  }
}
