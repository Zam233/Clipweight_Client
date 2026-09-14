import { describe, it, expect } from 'vitest';
import { PerfTracker, createFramePerf, EMPTY_SNAPSHOT, type PerfSnapshot } from './perf';
import type { LayerCacheStats } from './layerCache';

const CACHE: LayerCacheStats = {
  hits: 30, misses: 10, entries: 4, evictions: 0, hitRate: 0.75, approxBytes: 1024,
};

/** 构造一帧采样（可指定总耗时与分解） */
function frame(total: number, resolve = 1, composite = total - 1) {
  const perf = createFramePerf(0);
  perf.resolveMs = resolve;
  perf.compositeMs = composite;
  perf.layers = 3;
  perf.cacheHits = 2;
  perf.cacheMisses = 1;
  return { perf, end: total };
}

describe('PerfTracker', () => {
  it('无采样时给出空快照并带上缓存统计', () => {
    const tracker = new PerfTracker({ cacheStats: () => CACHE, publish: () => {} });
    const snap = tracker.snapshot(1000);
    expect(snap.frames).toBe(0);
    expect(snap.cache).toEqual(CACHE);
    expect(EMPTY_SNAPSHOT.frames).toBe(0);
  });

  it('统计平均/p95/最大与分解', () => {
    const tracker = new PerfTracker({ cacheStats: () => CACHE, publish: () => {}, publishIntervalMs: 0 });
    for (let i = 0; i < 100; i += 1) {
      const { perf, end } = frame(i + 1, 2, i - 1);
      tracker.record(perf, end);
    }
    const snap = tracker.snapshot(100);
    expect(snap.frames).toBe(100);
    expect(snap.avgTotalMs).toBeCloseTo(50.5, 6);
    expect(snap.avgResolveMs).toBeCloseTo(2, 6);
    expect(snap.maxTotalMs).toBe(100);
    expect(snap.p95TotalMs).toBeGreaterThanOrEqual(95);
    expect(snap.avgLayers).toBe(3);
  });

  it('环形缓冲封顶后只保留最近 N 帧', () => {
    const tracker = new PerfTracker({ capacity: 8, publish: () => {}, publishIntervalMs: 0, cacheStats: () => CACHE });
    for (let i = 0; i < 20; i += 1) {
      const { perf, end } = frame(i + 1);
      tracker.record(perf, end);
    }
    expect(tracker.snapshot(20).frames).toBe(8);
    expect(tracker.snapshot(20).lastTotalMs).toBe(20);
  });

  it('fps 用最近一秒的采样密度估算', () => {
    const tracker = new PerfTracker({ capacity: 200, publish: () => {}, publishIntervalMs: 0, cacheStats: () => CACHE });
    // 1 秒内 60 帧（16.67ms 一帧）
    for (let i = 0; i < 60; i += 1) {
      const { perf } = frame(16.67);
      tracker.record(perf, 1000 + i * (1000 / 60));
    }
    const snap = tracker.snapshot(2100);
    expect(snap.fps).toBeGreaterThan(50);
    expect(snap.fps).toBeLessThanOrEqual(65);
  });

  it('store 推送被节流（避免每帧重渲染拖垮面板）', () => {
    const published: PerfSnapshot[] = [];
    const tracker = new PerfTracker({
      publish: (s) => published.push(s),
      publishIntervalMs: 250,
      cacheStats: () => CACHE,
    });
    for (let i = 0; i < 60; i += 1) {
      const { perf } = frame(16);
      tracker.record(perf, i * 16); // 16ms 一帧 → 约 960ms
    }
    // 960ms / 250ms ≈ 4 次推送（远少于 60 次）
    expect(published.length).toBeGreaterThanOrEqual(3);
    expect(published.length).toBeLessThanOrEqual(6);
  });

  it('reset 清空采样并立即推送', () => {
    const published: PerfSnapshot[] = [];
    const tracker = new PerfTracker({
      publish: (s) => published.push(s),
      publishIntervalMs: 1000,
      cacheStats: () => CACHE,
    });
    const { perf } = frame(30);
    tracker.record(perf, 0);
    tracker.reset(10);
    expect(published[published.length - 1].frames).toBe(0);
    expect(tracker.snapshot(10).avgTotalMs).toBe(0);
  });

  it('帧耗时非负（时钟回拨不产生负数）', () => {
    const tracker = new PerfTracker({ publish: () => {}, publishIntervalMs: 0, cacheStats: () => CACHE });
    const perf = createFramePerf(100);
    tracker.record(perf, 50);
    expect(tracker.snapshot(50).lastTotalMs).toBe(0);
  });
});

describe('createFramePerf', () => {
  it('累加器初值为零并带起止时钟', () => {
    const perf = createFramePerf(12.5);
    expect(perf).toEqual({ start: 12.5, resolveMs: 0, compositeMs: 0, layers: 0, cacheHits: 0, cacheMisses: 0 });
  });
});
