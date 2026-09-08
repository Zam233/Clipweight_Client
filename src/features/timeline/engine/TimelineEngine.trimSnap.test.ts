// @vitest-environment jsdom
/**
 * 轮77：修剪边缘吸附——trim-start/trim-end 与移动吸附共用目标集与阈值
 * （此前 trim 显式关闭吸附，对齐到相邻片段边界只能像素级微调）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

class MockResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

const mockCtx = {
  setTransform: vi.fn(), clearRect: vi.fn(), fillRect: vi.fn(), strokeRect: vi.fn(),
  beginPath: vi.fn(), closePath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
  arc: vi.fn(), arcTo: vi.fn(), fill: vi.fn(), stroke: vi.fn(), rect: vi.fn(),
  fillText: vi.fn(), strokeText: vi.fn(), measureText: vi.fn(() => ({ width: 0 })),
  drawImage: vi.fn(), save: vi.fn(), restore: vi.fn(), clip: vi.fn(),
  translate: vi.fn(), rotate: vi.fn(), scale: vi.fn(),
  createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
  setLineDash: vi.fn(), createPattern: vi.fn(),
  canvas: { width: 0, height: 0 },
};
vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as never);

import { TimelineEngine } from './TimelineEngine';
import { DEFAULT_ZOOM, RULER_H, TRACK_H, timeToX } from './types';
import { createDefaultClip } from '@/types/timeline';

const CLIP_A = createDefaultClip({
  id: 'clipA', kind: 'video', track_id: 'v1', start_sec: 0, duration_sec: 5,
});
const CLIP_B = createDefaultClip({
  id: 'clipB', kind: 'video', track_id: 'v1', start_sec: 6, duration_sec: 4,
});

const TL = {
  duration_sec: 60,
  tracks: [{
    id: 'v1', name: 'V1', kind: 'video', index: 0, locked: false, muted: false,
    clips: [CLIP_A, CLIP_B],
  }],
};

vi.mock('@/stores/timelineStore', () => ({
  useTimelineStore: Object.assign(
    vi.fn((sel: (s: unknown) => unknown) => sel({ timeline: TL })),
    {
      subscribe: vi.fn(() => () => {}),
      getState: () => ({ timeline: TL, updateClip: vi.fn(), rollingTrim: vi.fn() }),
    },
  ),
}));

vi.mock('@/stores/selectionStore', () => ({
  useSelectionStore: Object.assign(
    vi.fn((sel: (s: unknown) => unknown) => sel({ selectedClipIds: ['clipB'], selectedTrackId: 'v1' })),
    {
      subscribe: vi.fn(() => () => {}),
      getState: () => ({
        selectedClipIds: ['clipB'], selectedTrackId: 'v1',
        selectClip: vi.fn(), selectTrack: vi.fn(),
      }),
    },
  ),
}));

vi.mock('@/stores/previewStore', () => ({
  usePreviewStore: Object.assign(
    vi.fn((sel: (s: unknown) => unknown) => sel({ currentTimeSec: 0, playing: false })),
    {
      subscribe: vi.fn(() => () => {}),
      getState: () => ({ currentTimeSec: 0, playing: false, setCurrentTime: vi.fn(), setPlaying: vi.fn() }),
    },
  ),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    vi.fn((sel: (s: unknown) => unknown) => sel({ snapEnabled: true, snapThresholdPx: 5, snapToGrid: false, snapGridSec: 0 })),
    {
      subscribe: vi.fn(() => () => {}),
      getState: () => ({ snapEnabled: true, snapThresholdPx: 5, snapToGrid: false, snapGridSec: 0 }),
    },
  ),
}));

vi.mock('@/stores/historyStore', () => ({
  useHistoryStore: Object.assign(
    vi.fn(() => ({})),
    { subscribe: vi.fn(() => () => {}), getState: () => ({ pushState: vi.fn() }) },
  ),
}));

vi.mock('@/services/media/mediaManager', () => ({
  mediaManager: {
    onChange: vi.fn(() => () => {}),
    hasRealMedia: vi.fn(() => false),
    captureThumbnail: vi.fn(() => Promise.resolve(null)),
    getCachedWaveform: vi.fn(() => null),
    ensureWaveform: vi.fn(),
  },
}));

function createCanvas(w = 1200, h = 400) {
  const canvas = document.createElement('canvas');
  document.body.appendChild(canvas);
  const parent = canvas.parentElement!;
  vi.spyOn(parent, 'getBoundingClientRect').mockReturnValue({
    x: 0, y: 0, width: w, height: h,
    top: 0, left: 0, bottom: h, right: w,
    toJSON: () => {},
  } as DOMRect);
  return canvas;
}

function mkPointer(type: string, opts: { x: number; y: number }) {
  return new PointerEvent(type, {
    clientX: opts.x, clientY: opts.y, bubbles: true, pointerId: 1, button: 0,
  } as PointerEventInit);
}

describe('轮77: 修剪边缘吸附', () => {
  let engine: TimelineEngine;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    vi.clearAllMocks();
    canvas = createCanvas();
    canvas.setPointerCapture = vi.fn();
    canvas.releasePointerCapture = vi.fn();
    engine = new TimelineEngine(canvas);
    engine.zoom = DEFAULT_ZOOM;
    engine.scrollX = 0;
    engine.scrollY = 0;
  });

  afterEach(() => { engine.dispose(); canvas.remove(); });

  function dragTrimStartTo(targetSec: number) {
    const L = (engine as unknown as { layout: () => Parameters<typeof timeToX>[1] }).layout();
    const y = RULER_H + TRACK_H / 2;
    const startX = timeToX(CLIP_B.start_sec, L) + 2; // 命中 trim-start 手柄
    (engine as any).onPointerDown(mkPointer('pointerdown', { x: startX, y }));
    expect((engine as any).drag.mode).toBe('trim-start');
    (engine as any).onPointerMove(mkPointer('pointermove', { x: timeToX(targetSec, L), y }));
    return (engine as any).computeTrimGhost();
  }

  it('trim-start 靠近前片段结尾（阈值内）→ 吸附到 5s', () => {
    // 阈值 5px / zoom 60 ≈ 0.083s → 5.05 在阈值内
    const ghost = dragTrimStartTo(5.05);
    expect(ghost).not.toBeNull();
    expect(ghost.start_sec).toBeCloseTo(5, 5);
    expect((engine as any).drag.snapX).not.toBeNull();
  });

  it('trim-start 远离任何目标 → 不吸附（保持原始时间）', () => {
    const ghost = dragTrimStartTo(7.5);
    expect(ghost.start_sec).toBeCloseTo(7.5, 5);
    expect((engine as any).drag.snapX).toBeNull();
  });
});
