import { describe, expect, it } from 'vitest';
import { validateDraftSpec } from './schema';
import type { MotionSpec } from './types';

const base = (): MotionSpec => ({
  schema: 'motion_spec/1', spec_id: 's1', duration_sec: 2,
  canvas: { width: 1920, height: 1080, fps: 30 }, requires: ['text'],
  layers: [{ id: 't', type: 'text', content: '测试', keyframes: [
    { time: 0, opacity: 0 }, { time: 1, opacity: 1 },
  ] }],
});

describe('validateDraftSpec', () => {
  it('accepts a minimal valid spec', () => {
    expect(validateDraftSpec(base())).toEqual([]);
  });
  it('rejects time/easing/unknown fields', () => {
    const s = base();
    s.layers[0].keyframes[0] = {
      time: 3, opacity: 0,
      easing: { type: 'cubic-bezier', x1: 1.2, y1: 0, x2: 0.2, y2: 1 },
    };
    (s.layers[0] as unknown as Record<string, unknown>).bogus = true;
    const errors = validateDraftSpec(s);
    expect(errors.some((e) => e.field.includes('time'))).toBe(true);
    expect(errors.some((e) => e.field === 'bogus')).toBe(true);
    expect(errors.some((e) => e.field.includes('easing'))).toBe(true);
  });
  it('rejects empty requires/layers', () => {
    const s = base(); s.requires = []; s.layers = [];
    expect(validateDraftSpec(s).length).toBeGreaterThan(0);
  });
});
