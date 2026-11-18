import { describe, expect, it } from 'vitest';
import { motionSpecMarkers } from './markers';

describe('motionSpecMarkers', () => {
  it('flattens layer keyframes without touching clip.keyframes', () => {
    const markers = motionSpecMarkers('c1', {
      schema: 'motion_spec/1', spec_id: 's', duration_sec: 2,
      canvas: { width: 1, height: 1 }, requires: ['text'],
      layers: [{ id: 't', type: 'text', keyframes: [
        { time: 1, opacity: 1 }, { time: 0, opacity: 0, easing: 'linear' },
      ] }],
    });
    expect(markers.map((m) => m.time)).toEqual([0, 1]);
    expect(markers[0].properties).toEqual(['opacity']);
  });
});
