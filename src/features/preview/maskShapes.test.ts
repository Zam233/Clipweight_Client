// @vitest-environment jsdom
/**
 * 预览蒙版升级（O-遮罩升级）：polygon / star / heart / 旋转 / 反相 / 羽化。
 *
 * 用假 2D 上下文记录路径命令与 clip 规则——jsdom 没有真实 canvas，
 * 但"画了哪些路径、用什么填充规则裁剪"是可断言的语义。
 */
import { describe, it, expect } from 'vitest';
import { applyMaskClip } from './PreviewPanel';
import { createDefaultClip } from '@/types/timeline';
import type { Clip } from '@/types/timeline';

const FRAME = { fx: 100, fy: 50, fw: 800, fh: 450 };

interface Recorder {
  ops: string[];
  clipRule: string | null;
  lineWidths: number[];
  alphas: number[];
}

function fakeCtx(): CanvasRenderingContext2D & Recorder {
  const rec: Recorder = { ops: [], clipRule: null, lineWidths: [], alphas: [] };
  const ctx = {
    ops: rec.ops,
    get clipRule() { return rec.clipRule; },
    get lineWidths() { return rec.lineWidths; },
    get alphas() { return rec.alphas; },
    _globalAlpha: 1,
    get globalAlpha() { return this._globalAlpha; },
    set globalAlpha(v: number) { this._globalAlpha = v; rec.alphas.push(v); },
    beginPath: () => rec.ops.push('beginPath'),
    moveTo: (x: number, y: number) => rec.ops.push(`moveTo:${x.toFixed(1)},${y.toFixed(1)}`),
    lineTo: (x: number, y: number) => rec.ops.push(`lineTo:${x.toFixed(1)},${y.toFixed(1)}`),
    rect: (x: number, y: number, w: number, h: number) => rec.ops.push(`rect:${x},${y},${w},${h}`),
    ellipse: (...args: unknown[]) => rec.ops.push(`ellipse:${args.slice(0, 5).map((a) => Number(a).toFixed(2)).join(',')}`),
    bezierCurveTo: () => rec.ops.push('bezierCurveTo'),
    closePath: () => rec.ops.push('closePath'),
    clip: (rule?: string) => { rec.clipRule = rule ?? 'nonzero'; },
    save: () => rec.ops.push('save'),
    restore: () => rec.ops.push('restore'),
    stroke: () => rec.ops.push('stroke'),
    set lineWidth(v: number) { rec.lineWidths.push(v); },
    get lineWidth() { return rec.lineWidths[rec.lineWidths.length - 1] ?? 0; },
  };
  return ctx as unknown as CanvasRenderingContext2D & Recorder;
}

function clip(overrides: Partial<Clip>): Clip {
  return createDefaultClip({
    id: 'c1', kind: 'video', track_id: 't0', start_sec: 0, duration_sec: 5,
    mask_type: 'ellipse', mask_rect: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 },
    ...overrides,
  });
}

describe('applyMaskClip · 形状', () => {
  it('无蒙版 / none 不进裁剪', () => {
    for (const mask_type of [null, 'none'] as const) {
      const ctx = fakeCtx();
      applyMaskClip(ctx, clip({ mask_type }), FRAME.fx, FRAME.fy, FRAME.fw, FRAME.fh);
      expect(ctx.ops).toHaveLength(0);
      expect(ctx.clipRule).toBeNull();
    }
  });

  it('rect 走矩形裁剪', () => {
    const ctx = fakeCtx();
    applyMaskClip(ctx, clip({ mask_type: 'rect' }), FRAME.fx, FRAME.fy, FRAME.fw, FRAME.fh);
    // x=0.25*800=200 → fx+200=300；w=0.5*800=400
    expect(ctx.ops).toContain('rect:300,162.5,400,225');
    expect(ctx.clipRule).toBe('nonzero');
  });

  it('ellipse 走椭圆路径（中心与半轴正确）', () => {
    const ctx = fakeCtx();
    applyMaskClip(ctx, clip({ mask_type: 'ellipse' }), FRAME.fx, FRAME.fy, FRAME.fw, FRAME.fh);
    const ellipse = ctx.ops.find((op) => op.startsWith('ellipse:'));
    // 中心 (500, 275)，半轴 (200, 112.5)，旋转 0
    expect(ellipse).toBe('ellipse:500.00,275.00,200.00,112.50,0.00');
  });

  it('polygon 按 mask_points 画 N 个顶点', () => {
    for (const points of [3, 6, 12]) {
      const ctx = fakeCtx();
      applyMaskClip(ctx, clip({ mask_type: 'polygon', mask_points: points }),
        FRAME.fx, FRAME.fy, FRAME.fw, FRAME.fh);
      expect(ctx.ops.filter((op) => op.startsWith('lineTo:'))).toHaveLength(points - 1);
      expect(ctx.ops).toContain('closePath');
    }
  });

  it('polygon 默认 5 边，且点数被夹到 3-12', () => {
    const dflt = fakeCtx();
    applyMaskClip(dflt, clip({ mask_type: 'polygon', mask_points: null }),
      FRAME.fx, FRAME.fy, FRAME.fw, FRAME.fh);
    expect(dflt.ops.filter((op) => op.startsWith('lineTo:'))).toHaveLength(4);

    const few = fakeCtx();
    applyMaskClip(few, clip({ mask_type: 'polygon', mask_points: 1 }),
      FRAME.fx, FRAME.fy, FRAME.fw, FRAME.fh);
    expect(few.ops.filter((op) => op.startsWith('lineTo:'))).toHaveLength(2);
  });

  it('star 画 2N 个顶点（内外半径交替）', () => {
    const ctx = fakeCtx();
    applyMaskClip(ctx, clip({ mask_type: 'star', mask_points: 5 }),
      FRAME.fx, FRAME.fy, FRAME.fw, FRAME.fh);
    expect(ctx.ops.filter((op) => op.startsWith('lineTo:'))).toHaveLength(9);
  });

  it('heart 用两段三次贝塞尔', () => {
    const ctx = fakeCtx();
    applyMaskClip(ctx, clip({ mask_type: 'heart' }), FRAME.fx, FRAME.fy, FRAME.fw, FRAME.fh);
    expect(ctx.ops.filter((op) => op === 'bezierCurveTo')).toHaveLength(2);
    expect(ctx.ops).toContain('closePath');
  });

  it('mask_rect 越界被钳制到画面内', () => {
    const ctx = fakeCtx();
    applyMaskClip(ctx, clip({ mask_type: 'rect', mask_rect: { x: 0.9, y: 0.95, w: 0.5, h: 0.5 } }),
      FRAME.fx, FRAME.fy, FRAME.fw, FRAME.fh);
    const rect = ctx.ops.find((op) => op.startsWith('rect:'));
    expect(rect).toBeTruthy();
    const [x, y, w, h] = rect!.slice(5).split(',').map(Number);
    expect(x! + w!).toBeLessThanOrEqual(FRAME.fx + FRAME.fw + 0.01);
    expect(y! + h!).toBeLessThanOrEqual(FRAME.fy + FRAME.fh + 0.01);
  });
});

describe('applyMaskClip · 旋转 / 反相 / 羽化', () => {
  it('mask_rotation 传给椭圆（弧度）', () => {
    const ctx = fakeCtx();
    applyMaskClip(ctx, clip({ mask_type: 'ellipse', mask_rotation: 90 }),
      FRAME.fx, FRAME.fy, FRAME.fw, FRAME.fh);
    const ellipse = ctx.ops.find((op) => op.startsWith('ellipse:'))!;
    // 90 度 → π/2 ≈ 1.57（假上下文把参数格式化为两位小数）
    expect(Number(ellipse.split(',')[4])).toBeCloseTo(1.57, 2);
  });

  it('反相用 evenodd 规则、整幅矩形 + 形状一起裁剪', () => {
    const ctx = fakeCtx();
    applyMaskClip(ctx, clip({ mask_type: 'ellipse', mask_inverted: true }),
      FRAME.fx, FRAME.fy, FRAME.fw, FRAME.fh);
    expect(ctx.clipRule).toBe('evenodd');
    expect(ctx.ops.some((op) => op.startsWith('rect:'))).toBe(true);
    expect(ctx.ops.some((op) => op.startsWith('ellipse:'))).toBe(true);
  });

  it('羽化做多圈渐变描边（外圈宽而淡、内圈窄而实）后再裁剪', () => {
    const ctx = fakeCtx();
    applyMaskClip(ctx, clip({ mask_type: 'ellipse', mask_feather: 20 }),
      FRAME.fx, FRAME.fy, FRAME.fw, FRAME.fh);
    expect(ctx.ops.filter((op) => op === 'stroke').length).toBeGreaterThanOrEqual(3);
    // 先画内圈（窄、不透明），后画外圈（宽、淡）→ 线宽递增
    for (let i = 1; i < ctx.lineWidths.length; i += 1) {
      expect(ctx.lineWidths[i]).toBeGreaterThan(ctx.lineWidths[i - 1]!);
    }
    expect(ctx.clipRule).toBe('nonzero');
  });

  it('羽化 0 不做描边（保持硬边，性能零开销）', () => {
    const ctx = fakeCtx();
    applyMaskClip(ctx, clip({ mask_type: 'ellipse', mask_feather: 0 }),
      FRAME.fx, FRAME.fy, FRAME.fw, FRAME.fh);
    expect(ctx.ops).not.toContain('stroke');
  });
});
