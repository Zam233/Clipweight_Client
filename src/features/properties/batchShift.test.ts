// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { effectiveShift } from './PropertiesPanel';

describe('轮75: 多选整体平移位移钳制', () => {
  it('右移：原样返回', () => {
    expect(effectiveShift(10, [3, 8])).toBe(10);
  });

  it('左移越过 0s：钳制到最小起点，保持相对间距', () => {
    expect(effectiveShift(-10, [3, 8])).toBe(-3);
  });

  it('左移不越界：原样返回', () => {
    expect(effectiveShift(-2, [3, 8])).toBe(-2);
  });

  it('零位移/空选择：0', () => {
    expect(effectiveShift(0, [3])).toBe(0);
    expect(effectiveShift(5, [])).toBe(0);
  });
});
