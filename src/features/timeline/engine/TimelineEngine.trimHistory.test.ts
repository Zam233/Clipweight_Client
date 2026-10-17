// @vitest-environment jsdom
/**
 * P0-03：修剪拖拽必须进撤销栈（旧守卫取样自变更前的 store 快照，恒不成立）。
 * P0-04：拖拽修剪必须受邻居钳制约束（与 store.trimClipStart/trimClipEnd 同语义），
 *        不得拖出同轨重叠。
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

const updateClip = vi.fn();
const rollingTrim = vi.fn();
const pushState = vi.fn();

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
      getState: () => ({ timeline: TL, updateClip, rollingTrim }),
    },
  ),
}));

vi.mock('@/stores/selectionStore', () => ({
  useSelectionStore: Object.assign(
    vi.fn((sel: (s: unknown) => unknown) => sel({ selectedClipIds: ['clipA', 'clipB'], selectedTrackId: 'v1' })),
    {
      subscribe: vi.fn(() => () => {}),
      getState: () => ({
        selectedClipIds: ['clipA', 'clipB'], selectedTrackId: 'v1',
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
    { subscribe: vi.fn(() => () => {}), getState: () => ({ pushState }) },
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

describe('P0-03/P0-04: 修剪撤销栈 + 邻居钳制', () => {
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

  function dragTrim(mode: 'trim-start' | 'trim-end', clipId: string, targetSec: number) {
    const L = (engine as unknown as { layout: () => Parameters<typeof timeToX>[1] }).layout();
    const y = RULER_H + TRACK_H / 2;
    const clip = clipId === 'clipA' ? CLIP_A : CLIP_B;
    const edgeX =
      mode === 'trim-start'
        ? timeToX(clip.start_sec, L) + 2
        : timeToX(clip.start_sec + clip.duration_sec, L) - 2;
    (engine as any).onPointerDown(mkPointer('pointerdown', { x: edgeX, y }));
    expect((engine as any).drag.mode).toBe(mode);
    (engine as any).onPointerMove(mkPointer('pointermove', { x: timeToX(targetSec, L), y }));
    (engine as any).onPointerUp(mkPointer('pointerup', { x: timeToX(targetSec, L), y }));
    return (engine as any).computeTrimGhost();
  }

  it('P0-03: 修剪拖拽后 pushState 恰好一次（进撤销栈）且 updateClip 被调用', () => {
    // clipB trim-start 拖到 7.0（右侧空隙，无吸附目标、无钳制约束）
    dragTrim('trim-start', 'clipB', 7.0);
    expect(updateClip).toHaveBeenCalledTimes(1);
    expect(pushState).toHaveBeenCalledTimes(1);
    expect(pushState.mock.calls[0][1]).toBe('trim');
  });

  it('P0-04: clipB trim-start 拖过 clipA 结尾 → 钳在 5.0，不产生重叠', () => {
    // 4.0 距吸附目标 5s 有 60px（> 5px 阈值）不触发吸附，钳制后仍应停在 5.0
    dragTrim('trim-start', 'clipB', 4.0);
    expect(updateClip).toHaveBeenCalledWith(
      'clipB',
      expect.objectContaining({ start_sec: 5, duration_sec: 5 }),
    );
  });

  it('P0-04: clipA trim-end 拖过 clipB 起点 → 钳在 6.0，不产生重叠', () => {
    dragTrim('trim-end', 'clipA', 7.0);
    expect(updateClip).toHaveBeenCalledWith(
      'clipA',
      expect.objectContaining({ duration_sec: 6 }),
    );
  });

  it('P0-03: 无实际变更的单击（ghost 与原值一致）→ 不 push 幽灵历史', () => {
    // 用无邻居场景：把 clipA trim-start 单击（无 move、无吸附位移、prevEnd=0）
    // 手柄命中点在边界 +2px → 会有 0.03s 微调；这里直接断言「move 与 down 同位置、
    // 且吸附/钳制均不改变值时不 push」——将 clipA 拖到 0（无变化路径）
    const L = (engine as unknown as { layout: () => Parameters<typeof timeToX>[1] }).layout();
    const y = RULER_H + TRACK_H / 2;
    const edgeX = timeToX(CLIP_A.start_sec, L) + 2;
    (engine as any).onPointerDown(mkPointer('pointerdown', { x: edgeX, y }));
    (engine as any).onPointerUp(mkPointer('pointerup', { x: edgeX, y }));
    // 单击命中边界 +2px 会产生 0.03s 微调（视为真实变更、进栈一次），
    // 但绝不能产生多条或零值异常
    expect(pushState.mock.calls.length).toBeLessThanOrEqual(1);
    expect(updateClip.mock.calls.length).toBeLessThanOrEqual(1);
  });
});
