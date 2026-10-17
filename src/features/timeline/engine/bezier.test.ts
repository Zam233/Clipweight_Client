import { describe, it, expect } from 'vitest';
import {
  BEZIER_PRESETS, bezierToCss, cubicBezierEase, normalizeBezier, sampleBezier,
  interpolateProperties,
} from './easing';

const LINEAR = { x1: 0.33, y1: 0.33, x2: 0.67, y2: 0.67 };
const EASE_IN_OUT = { x1: 0.42, y1: 0, x2: 0.58, y2: 1 };

describe('cubicBezierEase', () => {
  it('端点固定为 0 / 1', () => {
    expect(cubicBezierEase(0, EASE_IN_OUT)).toBe(0);
    expect(cubicBezierEase(1, EASE_IN_OUT)).toBe(1);
  });

  it('线性控制点在 [0,1] 内近似恒等（容差 1e-3）', () => {
    for (const x of [0.1, 0.25, 0.5, 0.75, 0.9]) {
      expect(Math.abs(cubicBezierEase(x, LINEAR) - x)).toBeLessThan(1e-3);
    }
  });

  it('ease-in-out 在中点回到 0.5 且两端更平缓', () => {
    expect(cubicBezierEase(0.5, EASE_IN_OUT)).toBeCloseTo(0.5, 3);
    expect(cubicBezierEase(0.25, EASE_IN_OUT)).toBeLessThan(0.25);
    expect(cubicBezierEase(0.75, EASE_IN_OUT)).toBeGreaterThan(0.75);
  });

  it('单调递增（曲线求解不会折返）', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 50; i += 1) {
      const y = cubicBezierEase(i / 50, EASE_IN_OUT);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });

  it('允许过冲：y 可以越出 0-1', () => {
    const overshoot = BEZIER_PRESETS.find((p) => p.name === 'overshoot')!.handles;
    const ys = Array.from({ length: 21 }, (_, i) => cubicBezierEase(i / 20, overshoot));
    expect(Math.max(...ys)).toBeGreaterThan(1);
  });

  it('x 超出 [0,1] 会被夹住而不是抛错', () => {
    expect(cubicBezierEase(-1, EASE_IN_OUT)).toBe(0);
    expect(cubicBezierEase(2, EASE_IN_OUT)).toBe(1);
    expect(cubicBezierEase(0.5, { x1: -3, y1: 0, x2: 9, y2: 1 })).toBeGreaterThan(0);
  });

  it('极端控制点（贴近端点）也能求解（Newton 失稳时走二分）', () => {
    const extreme = { x1: 0, y1: 0, x2: 1, y2: 1 };
    const mid = cubicBezierEase(0.5, extreme);
    expect(mid).toBeGreaterThan(0.4);
    expect(mid).toBeLessThan(0.6);
    expect(cubicBezierEase(0.999, extreme)).toBeGreaterThan(0.99);
  });
});

describe('normalizeBezier', () => {
  it('合法输入原样返回（x 夹到 [0,1]，y 保留过冲）', () => {
    expect(normalizeBezier({ x1: 0.2, y1: -0.5, x2: 1.4, y2: 1.6 }))
      .toEqual({ x1: 0.2, y1: -0.5, x2: 1, y2: 1.6 });
  });

  it('非法输入返回 null（回退到 easing 名字）', () => {
    for (const bad of [null, undefined, {}, 'x', 42, { x1: 0.1, y1: 0.2, x2: 0.3 }]) {
      expect(normalizeBezier(bad)).toBeNull();
    }
    expect(normalizeBezier({ x1: NaN, y1: 0, x2: 0.5, y2: 1 })).toBeNull();
    expect(normalizeBezier({ x1: Infinity, y1: 0, x2: 0.5, y2: 1 })).toBeNull();
  });
});

describe('interpolateProperties 与贝塞尔', () => {
  const kfs = [
    { time: 0, properties: { opacity: 0 } },
    { time: 1, properties: { opacity: 1 }, bezier: EASE_IN_OUT },
  ];

  it('有关键帧带 bezier 时优先于 easing 名字', () => {
    const withBezier = interpolateProperties(kfs, 0.25);
    const nameOnly = interpolateProperties(
      [{ time: 0, properties: { opacity: 0 } },
       { time: 1, properties: { opacity: 1 }, easing: 'linear' }], 0.25,
    );
    // ease-in-out 在 1/4 处明显小于线性的 0.25
    expect(withBezier.opacity).toBeLessThan(nameOnly.opacity);
    expect(withBezier.opacity).toBeCloseTo(cubicBezierEase(0.25, EASE_IN_OUT), 6);
  });

  it('bezier 非法时回退到 easing 名字', () => {
    const broken = interpolateProperties(
      [{ time: 0, properties: { opacity: 0 } },
       { time: 1, properties: { opacity: 1 }, easing: 'linear',
         bezier: { x1: 'a' } as unknown as { x1: number; y1: number; x2: number; y2: number } }], 0.5,
    );
    expect(broken.opacity).toBeCloseTo(0.5, 6);
  });

  it('无 bezier 的旧行为不变', () => {
    const legacy = interpolateProperties(
      [{ time: 0, properties: { opacity: 0 } },
       { time: 1, properties: { opacity: 1 }, easing: 'ease-out' }], 0.5,
    );
    expect(legacy.opacity).toBeCloseTo(0.75, 6);
  });
});

describe('sampleBezier / bezierToCss', () => {
  it('采样点数量与端点正确', () => {
    const points = sampleBezier(EASE_IN_OUT, 10);
    expect(points).toHaveLength(11);
    expect(points[0]).toEqual([0, 0]);
    expect(points[10][0]).toBe(1);
    expect(points[10][1]).toBeCloseTo(1, 6);
  });

  it('CSS 字符串格式', () => {
    expect(bezierToCss({ x1: 0.42, y1: 0, x2: 0.58, y2: 1 }))
      .toBe('cubic-bezier(0.42, 0, 0.58, 1)');
  });

  it('预设集合覆盖线性/缓入缓出/过冲', () => {
    const names = BEZIER_PRESETS.map((p) => p.name);
    expect(names).toContain('linear');
    expect(names).toContain('ease-in-out');
    expect(names).toContain('overshoot');
    for (const preset of BEZIER_PRESETS) {
      expect(normalizeBezier(preset.handles)).not.toBeNull();
    }
  });
});
