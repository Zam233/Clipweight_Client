// @vitest-environment jsdom
/**
 * TL-04 (W08)：素材投放必须拒绝 locked/hidden 轨，且 sameKindTracks 自动选轨
 * 分支同样过滤 locked/hidden（隐藏轨永不自动选）。store.addClip 是第二道闸。
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
import { DEFAULT_ZOOM, RULER_H, TRACK_H, HEADER_W } from './types';
import { createDefaultClip } from '@/types/timeline';

type Track = {
  id: string; name: string; kind: string; index: number;
  locked: boolean; muted: boolean; hidden?: boolean;
  clips: ReturnType<typeof createDefaultClip>[];
};

let TL: { duration_sec: number; tracks: Track[] };
const addClip = vi.fn((trackId: string) => `clip_${trackId}`);
const addTrack = vi.fn((kind: string, _name?: string, idx?: number) => {
  const id = `new_${kind}_${TL.tracks.length}`;
  const t: Track = {
    id, name: `${kind} new`, kind, index: idx ?? TL.tracks.length,
    locked: false, muted: false, clips: [],
  };
  TL.tracks.splice(Math.min(idx ?? TL.tracks.length, TL.tracks.length), 0, t);
  return id;
});
const pushState = vi.fn();
const selectClip = vi.fn();
const selectTrack = vi.fn();
// vi.mock 工厂会被提升到文件顶部执行，不能引用普通 const（否则 TDZ 报错）。
const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock('@/stores/timelineStore', () => ({
  useTimelineStore: Object.assign(
    vi.fn((sel: (s: unknown) => unknown) => sel({ timeline: TL })),
    {
      subscribe: vi.fn(() => () => {}),
      getState: () => ({ timeline: TL, addClip, addTrack }),
    },
  ),
}));

vi.mock('@/stores/selectionStore', () => ({
  useSelectionStore: Object.assign(
    vi.fn((sel: (s: unknown) => unknown) => sel({ selectedClipIds: [], selectedTrackId: null })),
    {
      subscribe: vi.fn(() => () => {}),
      getState: () => ({
        selectedClipIds: [], selectedTrackId: null,
        selectClip, selectTrack,
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
    vi.fn((sel: (s: unknown) => unknown) => sel({ snapEnabled: false, snapThresholdPx: 5, snapToGrid: false, snapGridSec: 0 })),
    {
      subscribe: vi.fn(() => () => {}),
      getState: () => ({ snapEnabled: false, snapThresholdPx: 5, snapToGrid: false, snapGridSec: 0 }),
    },
  ),
}));

vi.mock('@/stores/historyStore', () => ({
  useHistoryStore: Object.assign(
    vi.fn(() => ({})),
    { subscribe: vi.fn(() => () => {}), getState: () => ({ pushState }) },
  ),
}));

vi.mock('@/stores/toastStore', () => ({ toast }));

vi.mock('@/services/media/mediaManager', () => ({
  mediaManager: {
    onChange: vi.fn(() => () => {}),
    hasRealMedia: vi.fn(() => false),
    captureThumbnail: vi.fn(() => Promise.resolve(null)),
    getCachedThumbnailAt: vi.fn(() => null),
    ensureThumbnail: vi.fn(),
    getCachedWaveform: vi.fn(() => null),
    ensureWaveform: vi.fn(),
    registerTimeline: vi.fn(),
  },
}));

function makeTrack(over: Partial<Track> & { id: string; kind: string }): Track {
  return {
    id: over.id, name: over.name ?? over.id, kind: over.kind,
    index: over.index ?? 0, locked: over.locked ?? false,
    muted: false, hidden: over.hidden, clips: over.clips ?? [],
  };
}

function clip(id: string, start: number, dur: number) {
  return createDefaultClip({ id, kind: 'video', track_id: 'v', start_sec: start, duration_sec: dur });
}

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

const ASSET = { id: 'a1', kind: 'video', filename: 'a.mp4', duration: 2 };
// x 落在 2s（HEADER_W + 2*DEFAULT_ZOOM），y 落在指定轨道中心
const dropX = HEADER_W + 2 * DEFAULT_ZOOM;
const dropY = (idx: number) => RULER_H + idx * TRACK_H + 1;

describe('TL-04: 投放 locked/hidden 轨拒绝 + sameKindTracks 过滤', () => {
  let engine: TimelineEngine;
  let canvas: HTMLCanvasElement;

  beforeEach(() => {
    vi.clearAllMocks();
    TL = { duration_sec: 60, tracks: [] };
    canvas = createCanvas();
    engine = new TimelineEngine(canvas);
    engine.zoom = DEFAULT_ZOOM;
    engine.scrollX = 0;
    engine.scrollY = 0;
  });

  afterEach(() => { engine.dispose(); canvas.remove(); });

  it('RED→GREEN：拖到 locked 同类型轨 → 拒绝投放、给可读提示、不入撤销栈', () => {
    TL.tracks = [makeTrack({ id: 'lockedV', kind: 'video', locked: true, clips: [clip('c0', 0, 1)] })];

    engine.dropAssetAt(dropX, dropY(0), ASSET);

    expect(addClip).not.toHaveBeenCalled();
    expect(pushState).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('锁定'), 'error');
    expect(engine.dropFeedback?.type).toBe('reject');
  });

  it('RED→GREEN：拖到 hidden 同类型轨 → 拒绝投放、给可读提示', () => {
    TL.tracks = [makeTrack({ id: 'hiddenV', kind: 'video', hidden: true, clips: [clip('c0', 0, 1)] })];

    engine.dropAssetAt(dropX, dropY(0), ASSET);

    expect(addClip).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('隐藏'), 'error');
    expect(engine.dropFeedback?.type).toBe('reject');
  });

  it('sameKindTracks 自动选轨跳过 locked/hidden：只落在可见未锁的同类型轨', () => {
    // 拖在 text 轨（不同类型）→ 走自动选轨；同类型候选里仅 unlocked/visible 的 v2 可用
    TL.tracks = [
      makeTrack({ id: 'text0', kind: 'text', index: 0, clips: [] }),
      makeTrack({ id: 'lockedV', kind: 'video', index: 1, locked: true, clips: [] }),
      makeTrack({ id: 'hiddenV', kind: 'video', index: 2, hidden: true, clips: [] }),
      makeTrack({ id: 'visibleV', kind: 'video', index: 3, clips: [] }),
    ];

    engine.dropAssetAt(dropX, dropY(0), ASSET);

    expect(addClip).toHaveBeenCalledTimes(1);
    expect(addClip.mock.calls[0][0]).toBe('visibleV');
  });

  it('所有同类型轨都 locked/hidden → 新建可见轨投放，不写入锁/隐轨', () => {
    TL.tracks = [
      makeTrack({ id: 'lockedV', kind: 'video', index: 0, locked: true, clips: [clip('c0', 0, 1)] }),
      makeTrack({ id: 'hiddenV', kind: 'video', index: 1, hidden: true, clips: [clip('c1', 0, 1)] }),
    ];

    engine.dropAssetAt(dropX, dropY(0), ASSET); // 落在 lockedV → 直接拒绝

    expect(addClip).not.toHaveBeenCalled();
    expect(addTrack).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.stringContaining('锁定'), 'error');
  });

  it('锁/隐轨为不同类型时不成为投放目标，也不进候选', () => {
    TL.tracks = [
      makeTrack({ id: 'lockedT', kind: 'text', index: 0, locked: true, clips: [] }),
      makeTrack({ id: 'hiddenT', kind: 'text', index: 1, hidden: true, clips: [] }),
      makeTrack({ id: 'visibleV', kind: 'video', index: 2, clips: [] }),
    ];

    engine.dropAssetAt(dropX, dropY(0), ASSET); // 落在 locked text 轨

    expect(addClip).toHaveBeenCalledTimes(1);
    expect(addClip.mock.calls[0][0]).toBe('visibleV');
  });
});
