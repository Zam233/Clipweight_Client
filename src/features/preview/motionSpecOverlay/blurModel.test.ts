import { describe, expect, it } from 'vitest';
import { BLUR_BUCKETS } from './blur-calibration.generated';
import { blurCalibrationStatus, canvasBlurRadius } from './blurModel';

/**
 * 288 例标定结论（scripts/calibrate-blur-288.mjs）：
 * ctx.filter 的模糊半径以 device px 计，且与 ctx transform 无关；
 * CSS 侧 blur(R) 发生在局部坐标系、再被 scale(s) 放大。
 * 因此 Canvas 半径 = R_design * scale * dpr，即 a = scale*dpr、b = 0。
 */
describe('blur calibration', () => {
  it('has all six (scale,dpr) buckets with the measured linear model', () => {
    expect(blurCalibrationStatus().buckets).toBe(6);
    for (const b of BLUR_BUCKETS) {
      expect(b.a).toBeCloseTo(b.scale * b.dpr, 6);
      expect(b.b).toBeCloseTo(0, 6);
      expect(b.maxSsimError).toBeLessThan(0.02);
    }
  });

  it('maps a design radius through the matching bucket', () => {
    expect(canvasBlurRadius(8, 1, 1)).toBeCloseTo(8, 5);
    expect(canvasBlurRadius(8, 0.5, 1)).toBeCloseTo(4, 5);
    expect(canvasBlurRadius(8, 1, 2)).toBeCloseTo(16, 5);
    expect(canvasBlurRadius(8, 0.25, 2)).toBeCloseTo(4, 5);
  });

  it('returns 0 for non-positive design radii and falls back to the nearest scale', () => {
    expect(canvasBlurRadius(0, 1, 1)).toBe(0);
    expect(canvasBlurRadius(-4, 1, 1)).toBe(0);
    // 0.3 没有桶 → 取最近的 0.25
    expect(canvasBlurRadius(8, 0.3, 1)).toBeCloseTo(2, 5);
  });

  it('returns null for a dpr without a bucket', () => {
    expect(canvasBlurRadius(8, 1, 3 as never)).toBeNull();
  });
});
