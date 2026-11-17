import { describe, expect, it } from 'vitest';
import { migrateMotionSpecMetadata, specKeyframesToUi, uiKeyframesToSpec } from './migration';
import type { MotionSpec } from './types';

const spec: MotionSpec = {
  schema: 'motion_spec/1', spec_id: 's', duration_sec: 2,
  canvas: { width: 1, height: 1 }, requires: ['text'],
  layers: [{ id: 't', type: 'text', keyframes: [{ time: 0, opacity: 0 }, { time: 1, opacity: 1 }] }],
};

describe('MotionSpec migration/adapter', () => {
  it('flags unknown version read-only without rewriting', () => {
    const r = migrateMotionSpecMetadata({ motion_spec: { schema: 'motion_spec/2' } });
    expect(r.readOnly).toBe(true);
    expect(r.metadata.motion_spec).toEqual({ schema: 'motion_spec/2' });
    expect(r.metadata.motion_spec_legacy).toBe(true);
  });
  it('round-trips seconds via normalized frames', () => {
    const ui = specKeyframesToUi(spec, 't');
    expect(ui[1].normalized).toBe(0.5);
    const next = uiKeyframesToSpec(spec, 't', [
      { normalized: 0.25, keyframe: { time: 0, opacity: 1 } },
    ]);
    expect(next.layers[0].keyframes[0].time).toBe(0.5);
    expect(spec.layers[0].keyframes[1].time).toBe(1);
  });
});
