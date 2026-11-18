import { describe, expect, it } from 'vitest';
import { createDefaultClip, createEmptyTimeline } from '@/types/timeline';
import { overlayEligibility } from './overlayEligibility';

const track = createEmptyTimeline().tracks[0] ?? {
  id: 't', name: 'T', kind: 'text', index: 0, clips: [], locked: false, muted: false,
};
const clip = (overrides: Record<string, unknown> = {}) => createDefaultClip({
  id: 'c', kind: 'text', track_id: track.id, start_sec: 10, duration_sec: 5,
  ...overrides,
} as never);

describe('overlay eligibility', () => {
  it('accepts plain text in window', () => {
    expect(overlayEligibility(clip(), track, 11, false).ok).toBe(true);
  });
  it('rejects mask/blend/nested/playing/outside', () => {
    expect(overlayEligibility(clip({ mask_type: 'star' }), track, 11, false).ok).toBe(false);
    expect(overlayEligibility(clip({ blend_mode: 'screen' }), track, 11, false).ok).toBe(false);
    expect(overlayEligibility(clip({ nested_timeline: {} }), track, 11, false).ok).toBe(false);
    expect(overlayEligibility(clip(), track, 11, true).ok).toBe(false);
    expect(overlayEligibility(clip(), track, 20, false).ok).toBe(false);
  });
  it('rejects geometry transition windows only', () => {
    const slideIn = clip({ transition_in: 'slide', transition_duration_sec: 0.5 });
    expect(overlayEligibility(slideIn, track, 10.1, false).ok).toBe(false);
    expect(overlayEligibility(slideIn, track, 12, false).ok).toBe(true);
    const fade = clip({ transition_in: 'fade', transition_duration_sec: 0.5 });
    expect(overlayEligibility(fade, track, 10.1, false).ok).toBe(true);
  });
});
