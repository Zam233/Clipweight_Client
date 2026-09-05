import { describe, it, expect } from 'vitest';
import { captionBaselineY, captionFontSize, textLayout } from './captionLayout';

describe('captionBaselineY — ASS bottom anchor (h-text_h-20)', () => {
  it('anchors the caption baseline 20px above the frame bottom (1080 → 1060)', () => {
    expect(captionBaselineY(1080)).toBe(1060);
  });

  it('is frame-local (before the frame top offset fy is added)', () => {
    expect(captionBaselineY(1080) + 100).toBe(1160);
  });
});

describe('captionFontSize — min-dimension scaling for portrait frames', () => {
  it('scales by the smaller dimension so caption text fits portrait exports', () => {
    // 1080x1920 portrait: height-only scaling would give 48 * (1920/1080) ≈ 85.
    const size = captionFontSize(48, 1080, 1920);
    expect(size).toBe(48);
    expect(size).toBeLessThanOrEqual(1920);
  });

  it('matches the reference scale on a 16:9 1080p frame', () => {
    expect(captionFontSize(48, 1920, 1080)).toBe(48);
  });

  it('respects the transform scale factor', () => {
    expect(captionFontSize(48, 1920, 1080, 1.5)).toBe(72);
  });
});

describe('textLayout — X3 预览/导出锚点对齐（drawtext 语义）', () => {
  const base = { isCaption: false, stackIndex: 0, fontSize: 48, fw: 1920, fh: 1080 };

  it('track 0/1 无 position → bottom（h-text_h/2-20）', () => {
    expect(textLayout({ ...base, trackIndex: 0 }).y).toBe(1080 - 20 - 24);
    expect(textLayout({ ...base, trackIndex: 1 }).y).toBe(1080 - 20 - 24);
    expect(textLayout({ ...base, trackIndex: 1 }).align).toBe('center');
  });

  it('track 2 → top；track 3 → center；显式 position 优先于轨序', () => {
    expect(textLayout({ ...base, trackIndex: 2 }).y).toBe(20 + 24);
    expect(textLayout({ ...base, trackIndex: 3 }).y).toBe(540);
    const tl = textLayout({ ...base, trackIndex: 1, position: 'top_left' });
    expect(tl.align).toBe('left');
    expect(tl.x).toBe(20 + 24);
  });

  it('非字幕同轨堆叠 +35px/条（上限 500）；字幕不堆叠', () => {
    expect(textLayout({ ...base, trackIndex: 0, stackIndex: 2 }).y).toBe(1080 - 20 - 24 + 70);
    expect(textLayout({ ...base, trackIndex: 0, stackIndex: 99 }).y).toBe(1080 - 20 - 24 + 500);
    const cap = { ...base, trackIndex: 0, stackIndex: 3, isCaption: true };
    expect(textLayout(cap).y).toBe(1080 - 20 - 24);
  });

  it('9 宫格位置语义与导出 x/y 映射一致', () => {
    expect(textLayout({ ...base, trackIndex: 0, position: 'bottom_right' })).toMatchObject({ x: 1920 - 44, align: 'right' });
    expect(textLayout({ ...base, trackIndex: 0, position: 'left' }).y).toBe(540);
    expect(textLayout({ ...base, trackIndex: 0, position: 'right' }).x).toBe(1920 - 44);
  });

  it('未显式 position 时 text_align 左右习惯仍生效', () => {
    const l = textLayout({ ...base, trackIndex: 0, textAlign: 'left' });
    expect(l.align).toBe('left');
    expect(l.x).toBeCloseTo(1920 * 0.05, 5);
  });
});
