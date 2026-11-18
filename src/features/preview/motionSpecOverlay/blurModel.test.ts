import { describe, expect, it } from 'vitest';
import { blurCalibrationStatus, canvasBlurRadius } from './blurModel';

describe('blur calibration', () => {
  it('uses calibrated bucket only when present', () => {
    expect(blurCalibrationStatus().buckets).toBeGreaterThan(0);
    expect(canvasBlurRadius(8, 1, 1)).toBeCloseTo(8, 5);
    expect(canvasBlurRadius(8, 0.5, 1)).toBeNull();
    expect(canvasBlurRadius(8, 1, 3 as never)).toBeNull();
  });
});
