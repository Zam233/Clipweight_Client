import { BLUR_BUCKETS, BLUR_CALIBRATION_VERSION } from './blur-calibration.generated';

/** 仅当目标 scale/dpr 有标定桶时返回 Canvas 半径；否则 null（保持 approx）。 */
export function canvasBlurRadius(designPx: number, scale: number, dpr: number): number | null {
  if (!Number.isFinite(designPx) || designPx <= 0) return 0;
  if (BLUR_CALIBRATION_VERSION < 1) return null;
  const sameDpr = BLUR_BUCKETS.filter((b) => b.dpr === dpr)
    .slice().sort((a, b) => a.scale - b.scale);
  if (sameDpr.length === 0) return null;
  const exact = sameDpr.find((b) => Math.abs(b.scale - scale) < 0.001);
  if (exact) return exact.a * designPx + exact.b;
  // 标定表只覆盖 0.25/0.5/1；桶之间按 a 线性插值，桶外夹到端点。
  const lo = [...sameDpr].reverse().find((b) => b.scale <= scale) ?? sameDpr[0];
  const hi = sameDpr.find((b) => b.scale >= scale) ?? sameDpr[sameDpr.length - 1];
  if (lo.scale === hi.scale) return lo.a * designPx + lo.b;
  const t = (scale - lo.scale) / (hi.scale - lo.scale);
  const a = lo.a + (hi.a - lo.a) * t;
  const b = lo.b + (hi.b - lo.b) * t;
  return a * designPx + b;
}

export function blurCalibrationStatus(): { version: number; buckets: number } {
  return { version: BLUR_CALIBRATION_VERSION, buckets: BLUR_BUCKETS.length };
}
