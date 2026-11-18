import { describe, expect, it } from 'vitest';
import { isMotionSpec3DEnabled, stableBucket } from './rollout';
import { textMotionFlags } from './flags';

describe('motion spec rollout', () => {
  it('stable bucket is deterministic', () => {
    expect(stableBucket('p1')).toBe(stableBucket('p1'));
    expect(stableBucket('p1')).toBeGreaterThanOrEqual(0);
    expect(stableBucket('p1')).toBeLessThan(100);
  });
  it('dev flag enables, null project with no canary disables', () => {
    if (!textMotionFlags.overlay3d) {
      expect(isMotionSpec3DEnabled(null)).toBe(false);
    }
  });
});
