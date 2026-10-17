// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { LayerCache, contentKey, quantize, type Layer2DContext } from './layerCache';

/** 假 2D 上下文：记录操作，供断言「命中时不再重画内容」 */
function fakeCtx() {
  const ops: string[] = [];
  const ctx = {
    ops,
    drawImage: (...args: unknown[]) => { ops.push(`drawImage:${String(args[1])},${String(args[2])}`); },
    fillRect: () => ops.push('fillRect'),
    fillText: (text: string) => ops.push(`fillText:${text}`),
    setTransform: (...args: unknown[]) => ops.push(`setTransform:${args.slice(0, 3).join(',')}`),
    clearRect: () => ops.push('clearRect'),
    globalAlpha: 1,
    globalCompositeOperation: 'source-over',
    filter: 'none',
    shadowColor: '',
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    textAlign: 'left',
    textBaseline: 'alphabetic',
  };
  return ctx as unknown as Layer2DContext & { ops: string[] };
}

/** 假层画布：记录 paint 次数 */
function fakeCanvasFactory() {
  const state = { created: 0, painted: 0 };
  const make = (w: number, h: number) => {
    state.created += 1;
    const ops: string[] = [];
    const canvas = {
      width: w,
      height: h,
      getContext: () => ({
        setTransform: () => {},
        clearRect: () => {},
        fillRect: () => { ops.push('paint'); state.painted += 1; },
        drawImage: () => { ops.push('paint'); state.painted += 1; },
        fillText: () => { ops.push('paint'); state.painted += 1; },
        measureText: () => ({ width: 10 }),
        globalAlpha: 1,
        globalCompositeOperation: 'source-over',
        filter: 'none',
        shadowColor: '',
        shadowBlur: 0,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        textAlign: 'left',
        textBaseline: 'alphabetic',
      }),
      ops,
    };
    return canvas as unknown as HTMLCanvasElement;
  };
  return { make, state };
}

const GEOM = { x: 10, y: 20, w: 320, h: 180 };

describe('contentKey / quantize', () => {
  it('相同输入 → 相同键；任一输入变化 → 不同键', () => {
    const a = contentKey('media', ['v', 'asset1', 5, 1]);
    expect(contentKey('media', ['v', 'asset1', 5, 1])).toBe(a);
    expect(contentKey('media', ['v', 'asset1', 6, 1])).not.toBe(a);
    expect(contentKey('text', ['v', 'asset1', 5, 1])).not.toBe(a);
  });

  it('空值统一成空串（null 与 undefined 同键）', () => {
    expect(contentKey('media', [null, 'x'])).toBe(contentKey('media', [undefined, 'x']));
  });

  it('quantize 抹掉浮点噪声', () => {
    expect(quantize(0.1 + 0.2)).toBe(quantize(0.30000000000000004));
    expect(quantize(1.00049)).toBe(1);
    expect(quantize(Number.NaN)).toBe(0);
    expect(quantize(1.23456, 2)).toBe(1.23);
  });
});

describe('LayerCache', () => {
  let cache: LayerCache;
  let factory: ReturnType<typeof fakeCanvasFactory>;

  beforeEach(() => {
    factory = fakeCanvasFactory();
    cache = new LayerCache({ maxEntries: 3, createCanvas: factory.make });
  });

  it('未命中时绘制一次并贴图，命中时只贴图不再绘制', () => {
    const ctx = fakeCtx();
    let paints = 0;
    const paint = () => { paints += 1; return true; };
    const first = cache.draw(ctx, 'media:a', GEOM, 1, paint);
    const second = cache.draw(ctx, 'media:a', GEOM, 1, paint);
    expect(first.hit).toBe(false);
    expect(second.hit).toBe(true);
    expect(paints).toBe(1);
    // 两次都应把层贴到主画布
    expect(ctx.ops.filter((op) => op.startsWith('drawImage')).length).toBe(2);
    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.entries).toBe(1);
    expect(stats.hitRate).toBeCloseTo(0.5, 6);
  });

  it('每次未命中才创建一次离屏画布，复用同一张', () => {
    const ctx = fakeCtx();
    cache.draw(ctx, 'media:a', GEOM, 1, () => true);
    cache.draw(ctx, 'media:b', GEOM, 1, () => true);
    expect(factory.state.created).toBeLessThanOrEqual(2);
    // 换不同尺寸时重建同一条目的画布（尺寸不匹配 → 重新光栅化）
    cache.draw(ctx, 'media:a', { ...GEOM, w: 640 }, 1, () => true);
    expect(cache.getStats().misses).toBe(3);
  });

  it('paint 返回 false（占位/降级内容）不入缓存', () => {
    const ctx = fakeCtx();
    const miss = cache.draw(ctx, 'media:placeholder', GEOM, 1, () => false);
    expect(miss.hit).toBe(false);
    expect(miss.painted).toBe(false);
    expect(cache.getStats().entries).toBe(0);
    expect(cache.draw(ctx, 'media:placeholder', GEOM, 1, () => false).hit).toBe(false);
  });

  it('LRU 淘汰最久未用的条目', () => {
    const ctx = fakeCtx();
    for (const key of ['media:a', 'media:b', 'media:c']) cache.draw(ctx, key, GEOM, 1, () => true);
    // 访问 a（移到队尾），再插入 d → 应淘汰 b
    expect(cache.draw(ctx, 'media:a', GEOM, 1, () => true).hit).toBe(true);
    cache.draw(ctx, 'media:d', GEOM, 1, () => true);
    expect(cache.getStats().entries).toBe(3);
    expect(cache.getStats().evictions).toBe(1);
    expect(cache.draw(ctx, 'media:b', GEOM, 1, () => true).hit).toBe(false); // 已被淘汰
    expect(cache.draw(ctx, 'media:a', GEOM, 1, () => true).hit).toBe(true);
  });

  it('dpr 进键：同一层在不同 dpr 下重新光栅化（避免糊）', () => {
    const ctx = fakeCtx();
    cache.draw(ctx, 'media:a', GEOM, 1, () => true);
    cache.draw(ctx, 'media:a', GEOM, 2, () => true);
    expect(cache.getStats().misses).toBe(2);
  });

  it('几何非法（宽高 0）直接跳过，不创建画布', () => {
    const ctx = fakeCtx();
    const outcome = cache.draw(ctx, 'media:a', { x: 0, y: 0, w: 0, h: 10 }, 1, () => true);
    expect(outcome).toEqual({ hit: false, painted: false });
    expect(factory.state.created).toBe(0);
  });

  it('invalidatePrefix 只清指定前缀', () => {
    const ctx = fakeCtx();
    cache.draw(ctx, 'media:a', GEOM, 1, () => true);
    cache.draw(ctx, 'text:b', GEOM, 1, () => true);
    expect(cache.invalidatePrefix('media')).toBe(1);
    expect(cache.draw(ctx, 'media:a', GEOM, 1, () => true).hit).toBe(false);
    expect(cache.draw(ctx, 'text:b', GEOM, 1, () => true).hit).toBe(true);
  });

  it('clear / resetStats', () => {
    const ctx = fakeCtx();
    cache.draw(ctx, 'media:a', GEOM, 1, () => true);
    cache.clear();
    expect(cache.getStats().entries).toBe(0);
    cache.resetStats();
    expect(cache.getStats().hits).toBe(0);
    expect(cache.getStats().misses).toBe(0);
  });

  it('无离屏画布可用时退化为直接绘制且不炸', () => {
    const ctx = fakeCtx();
    const noCanvas = new LayerCache({ createCanvas: () => null });
    let paints = 0;
    const outcome = noCanvas.draw(ctx, 'media:a', GEOM, 1, () => { paints += 1; return true; });
    expect(outcome.painted).toBe(true);
    expect(paints).toBe(1);
    expect(noCanvas.getStats().entries).toBe(0);
  });
});
