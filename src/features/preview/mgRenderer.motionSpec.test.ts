import { describe, expect, it } from 'vitest';
import {
  emptyFidelity, fidelityHasIssue, resolveElementProps,
} from './mgRenderer';

describe('MotionSpec preview primitives', () => {
  it('uses start-frame cubic-bezier easing', () => {
    const f = emptyFidelity();
    const props = resolveElementProps({
      type: 'text', content: 'x',
      keyframes: [
        { time: 0, opacity: 0, easing: 'cubic-bezier(0,0,0.58,1)' },
        { time: 1, opacity: 1 },
      ],
    } as never, 0.5, f);
    expect(Number(props.opacity)).toBeGreaterThan(0.5);
    expect(f.unknownEasings).toEqual([]);
  });
  it('records unsupported props', () => {
    const f = emptyFidelity();
    f.unsupportedProps.push('rotate_x');
    expect(fidelityHasIssue(f)).toBe(true);
  });
});
