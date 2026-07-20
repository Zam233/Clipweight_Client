/**
 * Timeline engine shared types & coordinate helpers.
 * All rendering is done in CSS pixels; the canvas is scaled by devicePixelRatio.
 */
import type { Clip } from '@/types/timeline';

export interface TimelineLayout {
  /** Canvas CSS width/height */
  width: number;
  height: number;
  /** Track header column width */
  headerW: number;
  /** Time ruler height */
  rulerH: number;
  /** Height of a single track lane */
  trackH: number;
  /** Pixels per second */
  zoom: number;
  /** Horizontal scroll (px, in clip-area space) */
  scrollX: number;
  /** Vertical scroll (px) */
  scrollY: number;
}

export const HEADER_W = 152;
export const RULER_H = 30;
export const TRACK_H = 48;
export const MIN_ZOOM = 4;
export const MAX_ZOOM = 600;
export const DEFAULT_ZOOM = 60;

export function makeLayout(
  width: number,
  height: number,
  zoom: number,
  scrollX: number,
  scrollY: number,
): TimelineLayout {
  return { width, height, headerW: HEADER_W, rulerH: RULER_H, trackH: TRACK_H, zoom, scrollX, scrollY };
}

// ── Coordinate transforms ──────────────────────────────
export const timeToX = (t: number, L: TimelineLayout) =>
  L.headerW + t * L.zoom - L.scrollX;

export const xToTime = (x: number, L: TimelineLayout) =>
  (x - L.headerW + L.scrollX) / L.zoom;

export const trackToY = (index: number, L: TimelineLayout) =>
  L.rulerH + index * L.trackH - L.scrollY;

export const yToTrackIndex = (y: number, L: TimelineLayout) =>
  Math.floor((y - L.rulerH + L.scrollY) / L.trackH);

// ── Drag interaction state ─────────────────────────────
export type DragMode =
  | 'none'
  | 'scrub'
  | 'marquee'
  | 'move-clip'
  | 'trim-start'
  | 'trim-end'
  | 'pan';

export interface DragState {
  mode: DragMode;
  startMouse: { x: number; y: number };
  /** Time under the mouse when drag began */
  startTime: number;
  /** Clips being moved (id -> original clip) */
  origClips: Map<string, Clip>;
  /** Current horizontal drag delta in seconds */
  deltaTime: number;
  /** Current vertical drag delta in track indices */
  deltaTrack: number;
  /** Clip being trimmed */
  trimClipId: string | null;
  trimOrig: Clip | null;
  /** Marquee rect in screen px */
  marquee: { x0: number; y0: number; x1: number; y1: number } | null;
  /** Active snap guide screen X (for rendering) */
  snapX: number | null;
  /** Whether we pushed a history snapshot for this drag */
  historyPushed: boolean;
}

export function makeDragState(): DragState {
  return {
    mode: 'none',
    startMouse: { x: 0, y: 0 },
    startTime: 0,
    origClips: new Map(),
    deltaTime: 0,
    deltaTrack: 0,
    trimClipId: null,
    trimOrig: null,
    marquee: null,
    snapX: null,
    historyPushed: false,
  };
}

/** Hit-test edge zone width in px for trim handles */
export const TRIM_HANDLE_PX = 7;
