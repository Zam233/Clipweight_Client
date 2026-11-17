/**
 * 前端 MotionSpec 类型（版本化契约草案）。
 *
 * 权威 schema 以后端 motion_spec/1 + capability snapshot 为准；这里只用于
 * 读取/编辑器边界，不自行生成权威 hash。
 */

export type MotionSpecVersion = 'motion_spec/1';

export interface Easing {
  type: 'linear' | 'named' | 'cubic-bezier' | 'steps' | 'hold' | 'spring';
  name?: string;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  count?: number;
  position?: 'start' | 'end' | 'both';
  stiffness?: number;
  damping?: number;
  mass?: number;
  velocity?: number;
}

export interface MotionKeyframe {
  time: number;
  easing?: Easing | string;
  [key: string]: unknown;
}

export interface MotionTrack {
  property: string;
  segments: Array<{
    start: number;
    end: number;
    from: unknown;
    to: unknown;
    easing?: Easing | string;
  }>;
}

export interface MotionPath {
  type: 'line' | 'polyline' | 'cubic-bezier' | 'arc' | 'circle';
  points: Array<{ x: number; y: number }>;
  orient?: boolean;
  progress?: Array<{ time: number; value: number; easing?: Easing | string }>;
}

export interface MotionLayer {
  id: string;
  type: 'text' | 'shape' | 'line' | 'image' | 'group' | 'mask';
  content?: string;
  layout?: Record<string, unknown>;
  style?: Record<string, unknown>;
  text_motion?: {
    unit: 'char' | 'word' | 'line' | 'range';
    order?: 'forward' | 'reverse' | 'center' | 'random';
    stagger?: number;
    unit_duration?: number;
    seed?: number;
  };
  keyframes: MotionKeyframe[];
  tracks?: MotionTrack[];
  motion_path?: MotionPath | null;
  effects?: Array<Record<string, unknown>>;
  mask?: { x: number; y: number; w: number; h: number } | null;
}

export interface MotionSpec {
  schema: MotionSpecVersion;
  spec_id: string;
  duration_sec: number;
  canvas: { width: number; height: number; fps?: number };
  requires: string[];
  layers: MotionLayer[];
  camera?: { keyframes: MotionKeyframe[] } | null;
  meta?: Record<string, unknown>;
}

export interface MotionAuthorMeta {
  provider?: string;
  model?: string;
  prompt_version?: string;
  attempt?: number;
  seed?: number;
  spec_hash?: string;
}

export interface MotionCompiledArtifact {
  mg_def: Record<string, unknown> | null;
  preview_ops: Array<Record<string, unknown>>;
  fidelity: 'exact' | 'approx' | 'unsupported';
  spec_hash?: string;
  compiler_version?: string;
}

export type MotionPreviewState =
  | 'ready'
  | 'spec_without_artifact'
  | 'invalid_spec'
  | 'legacy'
  | 'plain';

export interface MotionValidationError {
  layerId: string;
  field: string;
  time?: number;
  message: string;
}
