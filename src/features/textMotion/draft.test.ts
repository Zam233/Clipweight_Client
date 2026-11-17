import { describe, expect, it } from 'vitest';
import { addKeyframe, removeKeyframe, updateCameraValue, updateKeyframeEasing, updateKeyframeTime, updateKeyframeValue } from './draft';
import type { MotionSpec } from './types';

const spec = (): MotionSpec => ({
  schema: 'motion_spec/1', spec_id: 's', duration_sec: 2,
  canvas: { width: 1, height: 1 }, requires: ['text'],
  layers: [{ id: 't', type: 'text', keyframes: [{ time: 0, opacity: 0 }, { time: 1, opacity: 1 }] }],
});

describe('MotionSpec draft editor', () => {
  it('updates/sorts without mutating source', () => {
    const src = spec();
    const next = updateKeyframeTime(src, 't', 0, 1.5);
    expect(next.layers[0].keyframes[1].time).toBe(1.5);
    expect(src.layers[0].keyframes[0].time).toBe(0);
  });
  it('adds/removes/updates values and clamps time', () => {
    let next = addKeyframe(spec(), 't', 0.5);
    expect(next.layers[0].keyframes).toHaveLength(3);
    next = updateKeyframeValue(next, 't', 0, 'opacity', 0.3);
    expect(next.layers[0].keyframes[0].opacity).toBe(0.3);
    next = removeKeyframe(next, 't', 0);
    expect(next.layers[0].keyframes).toHaveLength(2);
  });
});


describe('easing draft', () => {
  it('updates keyframe easing immutably', () => {
    const src = spec();
    const next = updateKeyframeEasing(src, 't', 0, { type: 'steps', count: 4 });
    expect((next.layers[0].keyframes[0].easing as unknown as Record<string, unknown>).type).toBe('steps');
    expect(src.layers[0].keyframes[0].easing).toBeUndefined();
  });
});


describe('camera draft', () => {
  it('updates camera keyframe values immutably', () => {
    const src = { ...spec(), camera: { keyframes: [{ time: 0, scale: 1 }] } } as ReturnType<typeof spec>;
    const next = updateCameraValue(src, 0, 'scale', 1.1);
    expect(next.camera?.keyframes[0].scale).toBe(1.1);
    expect(src.camera?.keyframes[0].scale).toBe(1);
  });
});
