// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { hitTestTextClipForEdit, applyTransitionAlpha, applyMaskClip } from './PreviewPanel';
import { captionFontSize } from './captionLayout';
import type { Clip, Track } from '@/types/timeline';
import { createDefaultClip, createEmptyTimeline } from '@/types/timeline';

const FRAME = { fx: 100, fy: 100, fw: 800, fh: 450 };
// X3: text/caption 在无显式 position 时按轨序回退——track 0/1 → bottom 锚点，
// 与导出 drawtext y=h-text_h-20（文本框中心再上移半个字高）一致
const MID = captionFontSize(48, FRAME.fw, FRAME.fh) / 2;
const BOTTOM_Y = FRAME.fy + FRAME.fh - 20 - MID;

function track(kind: 'text' | 'caption' | 'video', index: number, clip: Clip): Track {
  return { id: `t${index}`, name: kind, kind, index, locked: false, muted: false, clips: [clip] };
}

function textClip(overrides: Partial<Clip> = {}): Clip {
  return createDefaultClip({ id: 'c1', kind: 'text', track_id: 't0', start_sec: 0, duration_sec: 10, text: '你好', ...overrides });
}

describe('hitTestTextClipForEdit (C1 画布双击编辑文字)', () => {
  it('命中底部锚点文本（track 0 无 position → 导出 bottom 语义）', () => {
    const clip = textClip();
    const hit = hitTestTextClipForEdit(500, BOTTOM_Y, FRAME, [track('text', 0, clip)], 5);
    expect(hit).not.toBeNull();
    expect(hit!.clip.id).toBe('c1');
    expect(hit!.x).toBeCloseTo(500, 1);
    expect(hit!.y).toBeCloseTo(BOTTOM_Y, 1);
  });

  it('显式 metadata.position=center → 锚点帧中心', () => {
    const clip = textClip({ metadata: { position: 'center' } });
    const hit = hitTestTextClipForEdit(500, FRAME.fy + FRAME.fh / 2, FRAME, [track('text', 0, clip)], 5);
    expect(hit).not.toBeNull();
    expect(hit!.y).toBeCloseTo(FRAME.fy + FRAME.fh / 2, 1);
  });

  it('playhead 不在片段范围内 → 未命中', () => {
    const clip = textClip({ start_sec: 20, duration_sec: 5 });
    expect(hitTestTextClipForEdit(500, 325, FRAME, [track('text', 0, clip)], 5)).toBeNull();
  });

  it('点击远离锚点 → 未命中', () => {
    const clip = textClip();
    expect(hitTestTextClipForEdit(100, 100, FRAME, [track('text', 0, clip)], 5)).toBeNull();
  });

  it('隐藏轨道 / 禁用片段不参与命中', () => {
    const clip = textClip();
    const hidden: Track = { ...track('text', 0, clip), hidden: true };
    expect(hitTestTextClipForEdit(500, BOTTOM_Y, FRAME, [hidden], 5)).toBeNull();
    const disabled = textClip({ enabled: false });
    expect(hitTestTextClipForEdit(500, BOTTOM_Y, FRAME, [track('text', 0, disabled)], 5)).toBeNull();
  });

  it('顶层 text 优先于下层 text（倒序命中）', () => {
    const low = textClip({ id: 'low', text: '下层' });
    const high = textClip({ id: 'high', text: '上层' });
    const tracks = [track('text', 0, low), track('text', 1, high)];
    const hit = hitTestTextClipForEdit(500, BOTTOM_Y, FRAME, tracks, 5);
    expect(hit!.clip.id).toBe('high');
  });

  it('左对齐文本锚点偏左（fx + 5% fw + 变换偏移）', () => {
    const clip = textClip({ text_align: 'left', metadata: { transform: { x: 0.1 } } });
    const hit = hitTestTextClipForEdit(500, BOTTOM_Y, FRAME, [track('text', 0, clip)], 5);
    expect(hit!.x).toBeCloseTo(FRAME.fx + FRAME.fw * 0.05 + 0.1 * FRAME.fw, 1);
  });

  it('caption 类型锚点位于字幕基线', () => {
    const clip = textClip({ kind: 'caption' });
    const hit = hitTestTextClipForEdit(500, FRAME.fy + FRAME.fh * 0.85, FRAME, [track('caption', 0, clip)], 5);
    expect(hit).not.toBeNull();
    expect(hit!.clip.kind).toBe('caption');
    expect(hit!.y).toBeCloseTo(BOTTOM_Y, 1);
  });
});

describe('applyTransitionAlpha 与其他导出（防止回归）', () => {
  it('空时间线兼容', () => {
    const tl = createEmptyTimeline();
    expect(tl.markers).toEqual([]);
  });

  it('无转场不调制', () => {
    const c = textClip();
    expect(applyTransitionAlpha(1, c, 0.5)).toBeCloseTo(1, 5);
  });
});

describe('applyMaskClip (M4 蒙版)', () => {
  const FRAME2 = { fx: 0, fy: 0, fw: 1000, fh: 500 };
  let ctx: any;

  beforeEach(() => {
    ctx = {
      beginPath: vi.fn(), rect: vi.fn(), ellipse: vi.fn(), clip: vi.fn(),
      save: vi.fn(), restore: vi.fn(),
    };
  });

  it('无蒙版 → 不调用 clip', () => {
    applyMaskClip(ctx, textClip(), FRAME2.fx, FRAME2.fy, FRAME2.fw, FRAME2.fh);
    expect(ctx.clip).not.toHaveBeenCalled();
  });

  it('rect 蒙版 → rect + clip', () => {
    const c = textClip({ mask_type: 'rect', mask_rect: { x: 0.1, y: 0.2, w: 0.5, h: 0.4 } });
    applyMaskClip(ctx, c, FRAME2.fx, FRAME2.fy, FRAME2.fw, FRAME2.fh);
    const call = ctx.rect.mock.calls[0];
    expect(call[0]).toBeCloseTo(100, 5);
    expect(call[1]).toBeCloseTo(100, 5);
    expect(call[2]).toBeCloseTo(500, 5);
    expect(call[3]).toBeCloseTo(200, 5);
    expect(ctx.clip).toHaveBeenCalledTimes(1);
  });

  it('ellipse 蒙版 → ellipse + clip', () => {
    const c = textClip({ mask_type: 'ellipse', mask_rect: { x: 0, y: 0, w: 0.5, h: 1 } });
    applyMaskClip(ctx, c, FRAME2.fx, FRAME2.fy, FRAME2.fw, FRAME2.fh);
    expect(ctx.ellipse).toHaveBeenCalled();
    expect(ctx.clip).toHaveBeenCalledTimes(1);
  });

  it('越界值钳制：rect 超出画面时裁剪到边界', () => {
    const c = textClip({ mask_type: 'rect', mask_rect: { x: 0.9, y: 0, w: 0.9, h: 1 } });
    applyMaskClip(ctx, c, FRAME2.fx, FRAME2.fy, FRAME2.fw, FRAME2.fh);
    // x 钳到 0.9，宽钳到 0.1（不越界）
    const call = ctx.rect.mock.calls[0];
    expect(call[0]).toBeCloseTo(900, 5);
    expect(call[1]).toBeCloseTo(0, 5);
    expect(call[2]).toBeCloseTo(100, 5);
    expect(call[3]).toBeCloseTo(500, 5);
  });
});
