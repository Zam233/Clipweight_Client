/** CSS3D 覆盖层契约（CP-0）。 */
import type { FrameRect } from '../frameGeometry';

export type RenderMode = 'canvas-play' | 'css3d-pause' | 'server-frame';
export type Fidelity = 'exact' | 'approx' | 'unsupported';

export interface OverlayFidelity {
  exact: string[];
  approx: string[];
  unsupported: string[];
  reasons: string[];
}

export interface OverlayPlan {
  key: string;
  width: number;
  height: number;
  durationSec: number;
  elements: OverlayElementPlan[];
  fidelity: OverlayFidelity;
}

export interface OverlayElementPlan {
  id: string;
  kind: 'text' | 'shape' | 'line' | 'circle' | 'ring' | 'arc' | 'bg' | 'image';
  tag: 'div' | 'img';
  text?: string;
  attrs: Record<string, string>;
  baseStyle: Record<string, string>;
  keyframes: OverlayKeyframe[];
  durationSec: number;
  fidelity: OverlayFidelity;
}

export interface OverlayKeyframe {
  offset: number;
  easing?: string;
  transform?: string;
  opacity?: string;
  filter?: string;
  clipPath?: string;
  width?: string;
  height?: string;
  fontSize?: string;
  letterSpacing?: string;
}

export interface OverlayGeometry {
  frame: FrameRect;
  timelineWidth: number;
  timelineHeight: number;
  scale: number;
}

export interface OverlayHandle {
  seek(localSec: number): void;
  setLayerOpacity(v: number): void;
  dispose(): void;
}
