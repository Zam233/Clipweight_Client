import { BLUR_BUCKETS, BLUR_CALIBRATION_VERSION } from './blur-calibration.generated';

/** 仅当目标 scale/dpr 有标定桶时返回 Canvas 半径；否则 null（保持 approx）。 */
export function canvasBlurRadius(designPx: number, scale: number, dpr: number): number | null {
  if (!Number.isFinite(designPx) || designPx <= 0) return 0;
  if (BLUR_CALIBRATION_VERSION < 1) return null;
  const sameDpr = BLUR_BUCKETS.filter((b) => b.dpr === dpr);
  let bucket = sameDpr.find((b) => Math.abs(b.scale - scale) < 0.001);
  if (!bucket && sameDpr.length > 0) {
    bucket = sameDpr.reduce((best, b) => (
      Math.abs(b.scale - scale) < Math.abs(best.scale - scale) ? b : best
    ), sameDpr[0]);
  }
  if (!bucket) return null;
  return bucket.a * designPx + bucket.b;
}

export function blurCalibrationStatus(): { version: number; buckets: number } {
  return { version: BLUR_CALIBRATION_VERSION, buckets: BLUR_BUCKETS.length };
}
