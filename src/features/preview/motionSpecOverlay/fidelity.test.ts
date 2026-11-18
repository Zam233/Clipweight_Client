import { describe, expect, it } from 'vitest';
import { createDefaultClip } from '@/types/timeline';
import { verdictForClip } from './fidelity';

const clip = (metadata: Record<string, unknown>) => createDefaultClip({
  id: 'c', kind: 'text', track_id: 't', start_sec: 0, duration_sec: 2,
  metadata,
} as never);

const spec3d = { schema: 'motion_spec/1', duration_sec: 2, width: 1920, height: 1080,
  elements: [{ type: 'text', content: 'x', keyframes: [
    { time: 0, rotate_x: 10 }, { time: 1, rotate_x: 0 }] }] };

describe('fidelity verdict', () => {
  it('marks canvas 3D unsupported and css3d approx/server exact', () => {
    const c = clip({ mg_def: spec3d });
    expect(verdictForClip(c, 'canvas-play').fidelity).toBe('unsupported');
    expect(verdictForClip(c, 'css3d-pause').fidelity).toBe('approx');
    expect(verdictForClip(c, 'server-frame').fidelity).toBe('exact');
  });
  it('missing mgdef unsupported', () => {
    expect(verdictForClip(clip({}), 'css3d-pause').fidelity).toBe('unsupported');
  });
});


it('marks blur as approx alongside 3D', () => {
  const spec = { schema: 'motion_spec/1', duration_sec: 2, width: 100, height: 100,
    elements: [{ type: 'text', content: 'x', keyframes: [
      { time: 0, rotate_x: 10, blur: 8 }, { time: 1, rotate_x: 0, blur: 0 }] }] };
  const v = verdictForClip(clip({ mg_def: spec }), 'css3d-pause');
  expect(v.approx).toContain('3d:css3d');
  expect(v.approx).toContain('blur');
});
