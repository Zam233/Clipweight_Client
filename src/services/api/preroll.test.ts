import { describe, it, expect } from 'vitest';
import { MAX_PREROLL_SEC, clampPreroll, prerollPayload } from './preroll';

describe('V32 片头秒数归一', () => {
  it('非法输入归零（不猜用户想填什么）', () => {
    expect(clampPreroll('')).toBe(0);
    expect(clampPreroll('abc')).toBe(0);
    expect(clampPreroll('-3')).toBe(0);
    expect(clampPreroll(Number.NaN)).toBe(0);
  });

  it('保留一位小数', () => {
    expect(clampPreroll('1.44')).toBe(1.4);
    expect(clampPreroll('1.46')).toBe(1.5);
    expect(clampPreroll(2)).toBe(2);
  });

  it('上限 15 秒（与后端字段约束一致）', () => {
    expect(clampPreroll('99')).toBe(MAX_PREROLL_SEC);
    expect(clampPreroll('15')).toBe(15);
  });

  it('0 不进入请求体（保持后端默认）', () => {
    expect(prerollPayload(0)).toEqual({});
    expect(prerollPayload(1.5)).toEqual({ preroll_sec: 1.5 });
  });
});
