// @vitest-environment jsdom
/** 导出时间线指纹（PRD §20）：重试要跑快照，判据必须稳定且能识别改动。 */
import { describe, expect, it } from 'vitest';
import { fingerprintLabel, timelineChanged, timelineFingerprint } from './exportSnapshot';
import type { Timeline } from '@/types/timeline';

const base = {
  duration_sec: 12, fps: 30, width: 1920, height: 1080,
  tracks: [{ id: 't1', clips: [{ id: 'c1', start: 0, duration: 3 }] }],
} as unknown as Timeline;

describe('timelineFingerprint', () => {
  it('同一内容指纹稳定（同一次提交重算两次要一样）', () => {
    expect(timelineFingerprint(base)).toBe(timelineFingerprint(JSON.parse(JSON.stringify(base))));
  });

  it('内容改了指纹就变（不能把新时间线当成旧快照）', () => {
    const edited = { ...base, tracks: [{ id: 't1', clips: [{ id: 'c1', start: 0, duration: 5 }] }] } as unknown as Timeline;
    expect(timelineFingerprint(edited)).not.toBe(timelineFingerprint(base));
  });

  it('空时间线也有稳定指纹（不返回空串）', () => {
    const empty = timelineFingerprint(null);
    expect(empty).toHaveLength(16);
    expect(timelineFingerprint(undefined)).toBe(empty);
  });

  it('循环引用不假装相同：明确返回 unhashable', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(timelineFingerprint(cyclic as unknown as Timeline)).toBe('unhashable');
  });

  it('指纹是 16 位十六进制', () => {
    expect(timelineFingerprint(base)).toMatch(/^[0-9a-f]{16}$/);
  });
});

describe('fingerprintLabel / timelineChanged', () => {
  it('短标签取前 8 位，unhashable 明说无法计算', () => {
    expect(fingerprintLabel('abcdef0123456789')).toBe('abcdef01');
    expect(fingerprintLabel('unhashable')).toBe('无法计算');
    expect(fingerprintLabel('')).toBe('无法计算');
  });

  it('时间线改没改直接用指纹比较', () => {
    const a = timelineFingerprint(base);
    const b = timelineFingerprint({ ...base, duration_sec: 13 } as unknown as Timeline);
    expect(timelineChanged(a, a)).toBe(false);
    expect(timelineChanged(a, b)).toBe(true);
  });
});
