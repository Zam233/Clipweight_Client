/**
 * 预览合成性能诊断（O6）。
 *
 * 目标：把「拖动播放头为什么卡」变成可读数字——每帧总耗时、resolve（素材查找/seek）与
 * composite（绘制）的分解、缓存命中率、实际绘制帧率。全部本地计算，不上报。
 *
 * 采样写进环形缓冲（默认 120 帧 ≈ 2 秒@60Hz），平均与 p95 分别用滑动平均与排序分位。
 * store 更新**节流**（默认 4 次/秒）：诊断面板每帧刷新会把 React 重渲染变成新瓶颈，
 * 那就本末倒置了。
 */
import { create } from 'zustand';
import { getPreviewLayerCache, type LayerCacheStats } from './layerCache';

export interface FrameSample {
  /** 采样时刻（performance.now 或 Date.now） */
  at: number;
  totalMs: number;
  resolveMs: number;
  compositeMs: number;
  /** 本帧绘制的层数（含缓存命中） */
  layers: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface PerfSnapshot {
  frames: number;
  /** 最近一帧 */
  lastTotalMs: number;
  avgTotalMs: number;
  avgResolveMs: number;
  avgCompositeMs: number;
  p95TotalMs: number;
  maxTotalMs: number;
  /** 最近一秒内实际绘制的帧数（拖动/播放时接近刷新率） */
  fps: number;
  avgLayers: number;
  cache: LayerCacheStats;
}

const EMPTY_CACHE: LayerCacheStats = {
  hits: 0, misses: 0, entries: 0, evictions: 0, hitRate: 0, approxBytes: 0,
};

export const EMPTY_SNAPSHOT: PerfSnapshot = {
  frames: 0, lastTotalMs: 0, avgTotalMs: 0, avgResolveMs: 0, avgCompositeMs: 0,
  p95TotalMs: 0, maxTotalMs: 0, fps: 0, avgLayers: 0, cache: EMPTY_CACHE,
};

/** 一帧的累加器：预览循环里逐层累加，帧末交给 `record` */
export interface FramePerf {
  start: number;
  resolveMs: number;
  compositeMs: number;
  layers: number;
  cacheHits: number;
  cacheMisses: number;
}

export function createFramePerf(now: number): FramePerf {
  return { start: now, resolveMs: 0, compositeMs: 0, layers: 0, cacheHits: 0, cacheMisses: 0 };
}

export interface PerfTrackerOptions {
  /** 环形缓冲长度 */
  capacity?: number;
  /** store 推送节流（毫秒） */
  publishIntervalMs?: number;
  /** 取缓存统计（缺省读当前预览层缓存） */
  cacheStats?: () => LayerCacheStats;
  /** 推送快照（缺省写入 usePreviewPerfStore） */
  publish?: (snapshot: PerfSnapshot) => void;
  /** 时钟（测试注入） */
  now?: () => number;
}

export class PerfTracker {
  private samples: FrameSample[] = [];
  private capacity: number;
  private publishIntervalMs: number;
  private cacheStats: () => LayerCacheStats;
  private publish: (snapshot: PerfSnapshot) => void;
  private now: () => number;
  private lastPublish = 0;
  private ema = 0;

  constructor(options: PerfTrackerOptions = {}) {
    this.capacity = Math.max(4, options.capacity ?? 120);
    this.publishIntervalMs = Math.max(0, options.publishIntervalMs ?? 250);
    this.cacheStats = options.cacheStats ?? (() => getPreviewLayerCache().getStats());
    this.publish = options.publish ?? ((snapshot) => {
      usePreviewPerfStore.getState().setSnapshot(snapshot);
    });
    this.now = options.now ?? defaultNow;
  }

  /** 记录一帧（由预览循环调用） */
  record(perf: FramePerf, endAt: number = this.now()): FrameSample {
    const sample: FrameSample = {
      at: endAt,
      totalMs: Math.max(0, endAt - perf.start),
      resolveMs: perf.resolveMs,
      compositeMs: perf.compositeMs,
      layers: perf.layers,
      cacheHits: perf.cacheHits,
      cacheMisses: perf.cacheMisses,
    };
    this.samples.push(sample);
    if (this.samples.length > this.capacity) {
      this.samples.splice(0, this.samples.length - this.capacity);
    }
    this.ema = this.ema === 0 ? sample.totalMs : this.ema * 0.9 + sample.totalMs * 0.1;
    if (endAt - this.lastPublish >= this.publishIntervalMs) {
      this.lastPublish = endAt;
      this.publish(this.snapshot(endAt));
    }
    return sample;
  }

  snapshot(now: number = this.now()): PerfSnapshot {
    const samples = this.samples;
    if (samples.length === 0) {
      return { ...EMPTY_SNAPSHOT, avgTotalMs: this.ema, lastTotalMs: this.ema, cache: this.cacheStats() };
    }
    const total = samples.reduce((sum, s) => sum + s.totalMs, 0);
    const resolve = samples.reduce((sum, s) => sum + s.resolveMs, 0);
    const composite = samples.reduce((sum, s) => sum + s.compositeMs, 0);
    const layers = samples.reduce((sum, s) => sum + s.layers, 0);
    const sorted = samples.map((s) => s.totalMs).sort((a, b) => a - b);
    const p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))];
    const windowMs = 1000;
    const recent = samples.filter((s) => now - s.at <= windowMs);
    const spanMs = recent.length > 1 ? recent[recent.length - 1].at - recent[0].at : 0;
    return {
      frames: samples.length,
      lastTotalMs: samples[samples.length - 1].totalMs,
      avgTotalMs: total / samples.length,
      avgResolveMs: resolve / samples.length,
      avgCompositeMs: composite / samples.length,
      p95TotalMs: p95,
      maxTotalMs: sorted[sorted.length - 1],
      fps: spanMs > 0 ? (recent.length - 1) / (spanMs / windowMs) : 0,
      avgLayers: layers / samples.length,
      cache: this.cacheStats(),
    };
  }

  /** 清空采样并按需立即推送 */
  reset(now: number = this.now()): void {
    this.samples = [];
    this.ema = 0;
    this.lastPublish = now - this.publishIntervalMs;
    this.publish(this.snapshot(now));
  }
}

function defaultNow(): number {
  if (typeof performance !== 'undefined' && typeof performance.now === 'function') return performance.now();
  return Date.now();
}

interface PreviewPerfState {
  /** 最近一次快照（面板订阅它；是否显示由 settingsStore.showPerfPanel 决定） */
  snapshot: PerfSnapshot;
  setSnapshot: (snapshot: PerfSnapshot) => void;
}

export const usePreviewPerfStore = create<PreviewPerfState>((set) => ({
  snapshot: EMPTY_SNAPSHOT,
  setSnapshot: (snapshot) => set({ snapshot }),
}));

/** 预览循环共用的采样器；缓存统计读当前预览层缓存实例 */
export const previewPerf = new PerfTracker({
  capacity: 120,
  publishIntervalMs: 250,
});
