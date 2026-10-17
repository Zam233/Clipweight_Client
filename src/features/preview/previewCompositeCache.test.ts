// @vitest-environment jsdom
/**
 * O6 验收：拖动播放头时层缓存到底省了多少。
 *
 * 场景按采纳报告的验收标准搭：1080p 时间线、两路视频 + 一条字幕 + 一个 MG（动画占位）轨，
 * 拖动播放头**每帧内步进两次**（60Hz 的 rAF 跑 30fps 时间线的常态）。
 *
 * 两种跑法都走**同一条** `compositeTimelineClips` 代码路径，唯一差别是缓存是否保留：
 * - cold：每帧前 clear()——等价于 O6 之前的「每帧全量重画」；
 * - warm：保留缓存——O6 之后的实际行为。
 *
 * 这里量的是**操作次数**（seek 次数、内容绘制次数、缓存命中率、每帧层数），不是墙钟：
 * 可信的毫秒数需要真实浏览器 + 视频解码 + GPU，jsdom 给不出来。墙钟验收用手动流程（见文档）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { compositeTimelineClips } from './PreviewPanel';
import { LayerCache, getPreviewLayerCache, setPreviewLayerCache } from './layerCache';
import { createFramePerf, type FramePerf } from './perf';
import { mediaManager } from '@/services/media/mediaManager';
import { createDefaultClip, createEmptyTimeline } from '@/types/timeline';
import type { Clip, Timeline, Track } from '@/types/timeline';

const FRAME = { fx: 0, fy: 0, fw: 960, fh: 540 }; // 1080p 项目在面板里的显示尺寸
const FPS = 30;
const DURATION = 10;

interface Counters {
  drawImage: number;
  fillText: number;
  strokeText: number;
  fillRect: number;
  gradients: number;
  /** 在离屏层画布上执行的操作数 = 内容被光栅化的次数（O6 要降的就是它） */
  layerOps: number;
  /** 在主画布上执行的操作数（动画/形状这类不缓存的层走这里） */
  mainOps: number;
}

function newCounters(): Counters {
  return {
    drawImage: 0, fillText: 0, strokeText: 0, fillRect: 0, gradients: 0, layerOps: 0, mainOps: 0,
  };
}

/** 当前这轮跑法的计数器（假画布工厂写进它） */
let counters: Counters = newCounters();

/** 假 2D 上下文（主画布与离屏层画布共用同一套计数，冷/热跑法口径一致） */
function fake2d(isLayerCanvas: boolean) {
  const bump = (field: keyof Counters, n = 1) => {
    counters[field] += n;
    if (isLayerCanvas) counters.layerOps += 1;
    else counters.mainOps += 1;
  };
  const noop = () => { bump('mainOps', 0); };
  const ctx = {
    save: noop, restore: noop, translate: noop, rotate: noop,
    beginPath: noop, rect: noop, clip: noop, closePath: noop,
    moveTo: noop, lineTo: noop, arc: noop, arcTo: noop,
    fill: noop, stroke: noop, setTransform: noop, clearRect: noop,
    strokeRect: noop, setLineDash: noop,
    fillRect: () => bump('fillRect'),
    drawImage: () => bump('drawImage'),
    fillText: () => bump('fillText'),
    strokeText: () => bump('strokeText'),
    createLinearGradient: () => {
      bump('gradients');
      return { addColorStop: () => {} };
    },
    measureText: (text: string) => ({ width: text.length * 8 }),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    font: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineJoin: 'round',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
  };
  return ctx as unknown as CanvasRenderingContext2D;
}

function fakeMainCtx(): CanvasRenderingContext2D {
  return fake2d(false);
}

/** 假离屏层画布（jsdom 没有可用的 2D 上下文，必须注入） */
function fakeLayerCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = {
    width,
    height,
    getContext: () => fake2d(true),
  };
  return canvas as unknown as HTMLCanvasElement;
}

/** 造一个「就绪」的假 video 元素（readyState>=2 + 有尺寸才走真实绘制路径） */
function fakeVideoEl() {
  return { readyState: 3, videoWidth: 1920, videoHeight: 1080, currentTime: 0 } as unknown as HTMLVideoElement;
}

function clip(overrides: Partial<Clip> & { id: string; kind: Clip['kind']; track_id: string }): Clip {
  return createDefaultClip({ start_sec: 0, duration_sec: DURATION, ...overrides });
}

function track(kind: Track['kind'], index: number, clips: Clip[]): Track {
  return { id: `t${index}`, name: kind, kind, index, locked: false, muted: false, clips };
}

/** 1080p / 四轨：视频1 + 视频2 + 字幕 + MG（动画占位） */
function timeline4Tracks(): Timeline {
  return {
    ...createEmptyTimeline('tl-1080p'),
    width: 1920,
    height: 1080,
    fps: FPS,
    duration_sec: DURATION,
    tracks: [
      track('video', 0, [clip({ id: 'v1', kind: 'video', track_id: 't0', asset_id: 'asset-v1' })]),
      track('video', 1, [clip({ id: 'v2', kind: 'video', track_id: 't1', asset_id: 'asset-v2',
                                transition_in: 'fade', transition_duration_sec: 0.5 })]),
      track('caption', 2, [clip({ id: 'cap', kind: 'caption', track_id: 't2', text: '拖动播放头时的字幕',
                                  font_size: 48, stroke_width: 2, shadow_blur: 4, shadow_color: '#000000' })]),
      track('animation', 3, [clip({ id: 'mg', kind: 'animation', track_id: 't3', asset_id: 'mg-1' })]),
    ],
  };
}

/** 拖动播放头：每个 30fps 帧内步进 2 次（模拟 60Hz rAF） */
function scrubTimes(steps = 120): number[] {
  const times: number[] = [];
  for (let i = 0; i < steps; i += 1) {
    const frame = Math.floor(i / 2);
    times.push(frame / FPS + (i % 2) * (1 / (FPS * 2)));
  }
  return times;
}

interface RunResult extends Counters {
  seekCalls: number;
  layersPerFrame: number[];
  hits: number;
  misses: number;
}

function run(timeline: Timeline, times: number[], warm: boolean): RunResult {
  counters = newCounters();
  const layersPerFrame: number[] = [];
  const seekSpy = vi.spyOn(mediaManager, 'seekVideo');
  for (const t of times) {
    if (!warm) getPreviewLayerCache().clear();
    const ctx = fakeMainCtx();
    const perf: FramePerf = createFramePerf(0);
    layersPerFrame.push(compositeTimelineClips(ctx, timeline, t, FRAME, 2, perf));
  }
  const stats = getPreviewLayerCache().getStats();
  return {
    ...counters,
    seekCalls: seekSpy.mock.calls.length,
    layersPerFrame,
    hits: stats.hits,
    misses: stats.misses,
  };
}

function pct(cold: number, warm: number): number {
  return cold === 0 ? 0 : (1 - warm / cold) * 100;
}

/** 内容光栅化次数（层画布上的操作数） */
function contentPaints(r: RunResult): number {
  return r.layerOps;
}

describe('O6 预览层缓存：拖动播放头的收益（操作次数口径）', () => {
  let v1: HTMLVideoElement;
  let v2: HTMLVideoElement;

  beforeEach(() => {
    v1 = fakeVideoEl();
    v2 = fakeVideoEl();
    vi.spyOn(mediaManager, 'registerTimeline').mockImplementation(() => {});
    vi.spyOn(mediaManager, 'get').mockImplementation((assetId: string) => {
      if (assetId === 'asset-v1') return { url: 'blob:v1', kind: 'video', videoEl: v1, durationSec: DURATION, thumbnails: new Map(), thumbLru: [] };
      if (assetId === 'asset-v2') return { url: 'blob:v2', kind: 'video', videoEl: v2, durationSec: DURATION, thumbnails: new Map(), thumbLru: [] };
      return undefined;
    });
    counters = newCounters();
    setPreviewLayerCache(new LayerCache({ maxEntries: 64, createCanvas: fakeLayerCanvas }));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    setPreviewLayerCache(new LayerCache({ maxEntries: 48 }));
  });

  it('内容绘制与 seek 次数显著下降（≥30%），且每帧层数不变', () => {
    const timeline = timeline4Tracks();
    const times = scrubTimes();

    const cold = run(timeline, times, false);
    const warm = run(timeline, times, true);

    const seekDrop = pct(cold.seekCalls, warm.seekCalls);
    const paintDrop = pct(contentPaints(cold), contentPaints(warm));
    const hitRate = warm.hits + warm.misses > 0 ? warm.hits / (warm.hits + warm.misses) : 0;

    // 读数（也是写进文档的实测数字；失败时便于定位）
    console.info('[O6] cold/warm', {
      cold: { contentPaints: contentPaints(cold), seek: cold.seekCalls, drawImage: cold.drawImage },
      warm: { contentPaints: contentPaints(warm), seek: warm.seekCalls, drawImage: warm.drawImage },
      drops: { seek: seekDrop.toFixed(1), contentPaint: paintDrop.toFixed(1) },
      hitRate: `${(hitRate * 100).toFixed(1)}%`,
    });

    // ① 内容确实被复用
    expect(hitRate).toBeGreaterThanOrEqual(0.3);
    // ② seek 次数按「不同源帧」收敛（子帧重复不再 seek）
    expect(seekDrop).toBeGreaterThanOrEqual(30);
    // ③ 内容绘制（视频帧/文字排版+描边/形状）次数下降 ≥30%
    expect(paintDrop).toBeGreaterThanOrEqual(30);
    // ④ 正确性：每帧合成的层数完全一致（没有因为缓存少画层）
    expect(warm.layersPerFrame).toEqual(cold.layersPerFrame);
    expect(warm.layersPerFrame.every((n) => n === 4)).toBe(true);
  });

  it('静止帧重复绘制（暂停后缩放/安全框变化触发重绘）几乎全部命中', () => {
    const timeline = timeline4Tracks();
    const first = run(timeline, [3.0], false);
    const again = run(timeline, Array.from({ length: 20 }, () => 3.0), true);
    // 每帧 3 个可缓存层（两路视频 + 字幕）应全部命中；MG 动画轨不缓存（每帧重画 1 次）
    expect(again.hits).toBeGreaterThanOrEqual(19 * 3);
    expect(contentPaints(again)).toBeLessThan(contentPaints(first) * 2);
    expect(again.mainOps).toBeGreaterThan(0); // MG 轨每帧仍重画
    expect(again.seekCalls).toBeLessThanOrEqual(4); // 同一源帧不再重复 seek
  });

  it('素材版本变化后缓存整体失效（不会贴过时帧）', () => {
    const timeline = timeline4Tracks();
    run(timeline, scrubTimes(20), true);
    const before = getPreviewLayerCache().getStats();
    expect(before.entries).toBeGreaterThan(0);
    // 等价于 mediaManager.onChange → 预览层 invalidatePrefix('media')
    expect(getPreviewLayerCache().invalidatePrefix('media')).toBe(before.entries);
    expect(getPreviewLayerCache().getStats().entries).toBe(0);
  });

  it('素材未就绪时不缓存占位图（同一时间点连续两帧都会重画）', () => {
    vi.spyOn(mediaManager, 'get').mockImplementation(() => ({
      url: 'blob:loading', kind: 'video', durationSec: DURATION, thumbnails: new Map(), thumbLru: [],
    }) as never);
    const timeline: Timeline = {
      ...createEmptyTimeline('tl-placeholder'),
      fps: FPS, duration_sec: DURATION,
      tracks: [track('video', 0, [clip({ id: 'v1', kind: 'video', track_id: 't0', asset_id: 'asset-v1' })])],
    };
    const result = run(timeline, [0, 0.01], true);
    expect(getPreviewLayerCache().getStats().entries).toBe(0);
    expect(result.hits).toBe(0);
    expect(result.misses).toBe(2);          // 两次都判定为未命中
    expect(contentPaints(result)).toBeGreaterThan(2); // 两次都真的重画了占位
  });

  it('动画（MG）轨不入缓存：时间相关的脉冲始终重画', () => {
    const timeline: Timeline = {
      ...createEmptyTimeline('tl-mg'),
      fps: FPS, duration_sec: DURATION,
      tracks: [track('animation', 0, [clip({ id: 'mg', kind: 'animation', track_id: 't0' })])],
    };
    const result = run(timeline, [0, 1 / 60, 2 / 60], true);
    expect(result.hits).toBe(0);
    expect(contentPaints(result)).toBe(0);   // 直接画在主画布上，不经过层画布
    expect(result.mainOps).toBeGreaterThan(0);
  });
});
