// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { applyTransitionAlpha, transitionGeometry } from './PreviewPanel';
import { interpolateProperties } from '@/features/timeline/engine/easing';
import type { Clip } from '@/types/timeline';
import { createDefaultClip } from '@/types/timeline';

function clip(overrides: Partial<Clip>): Clip {
  return createDefaultClip({ id: 'c1', kind: 'video', track_id: 't1', ...overrides });
}

describe('applyTransitionAlpha (M11 转场可见性)', () => {
  it('无转场 → 透明度不变', () => {
    const c = clip({ duration_sec: 5 });
    expect(applyTransitionAlpha(0.8, c, 0.01)).toBeCloseTo(0.8, 5);
    expect(applyTransitionAlpha(0.8, c, 0.99)).toBeCloseTo(0.8, 5);
  });

  it('hard_cut → 不调制', () => {
    const c = clip({ duration_sec: 5, transition_in: 'hard_cut', transition_out: 'hard_cut' });
    expect(applyTransitionAlpha(0.8, c, 0.01)).toBeCloseTo(0.8, 5);
    expect(applyTransitionAlpha(0.8, c, 0.99)).toBeCloseTo(0.8, 5);
  });

  it('transition_in=fade → 开头淡入（0→1 线性）', () => {
    const c = clip({ duration_sec: 5, transition_in: 'fade', transition_duration_sec: 0.5 });
    // 0.5s 窗口在 localT 0→0.1
    expect(applyTransitionAlpha(1, c, 0)).toBeCloseTo(0, 5);
    expect(applyTransitionAlpha(1, c, 0.05)).toBeCloseTo(0.5, 5);
    expect(applyTransitionAlpha(1, c, 0.1)).toBeCloseTo(1, 5);
    expect(applyTransitionAlpha(1, c, 0.5)).toBeCloseTo(1, 5);
  });

  it('transition_out=dissolve → 结尾淡出（1→0 线性）', () => {
    const c = clip({ duration_sec: 5, transition_out: 'dissolve', transition_duration_sec: 0.5 });
    expect(applyTransitionAlpha(1, c, 0.9)).toBeCloseTo(1, 5);
    expect(applyTransitionAlpha(1, c, 0.95)).toBeCloseTo(0.5, 5);
    expect(applyTransitionAlpha(1, c, 1)).toBeCloseTo(0, 5);
  });

  it('与 clip.opacity 相乘调制（0.5 基础 × 淡入系数）', () => {
    const c = clip({ duration_sec: 5, transition_in: 'fade', transition_duration_sec: 0.5 });
    expect(applyTransitionAlpha(0.5, c, 0.05)).toBeCloseTo(0.25, 5);
  });

  it('无效转场类型（空/未知字符串）→ 不调制', () => {
    const c = clip({ duration_sec: 5, transition_in: 'not_a_real_type' });
    expect(applyTransitionAlpha(0.7, c, 0.01)).toBeCloseTo(0.7, 5);
  });

  it('轮76: slide/wipe 不再走 alpha 调制（改由几何转场呈现）', () => {
    const slide = clip({ duration_sec: 5, transition_in: 'slide', transition_duration_sec: 0.5 });
    expect(applyTransitionAlpha(0.8, slide, 0)).toBeCloseTo(0.8, 5);
    const wipe = clip({ duration_sec: 5, transition_out: 'wipe', transition_duration_sec: 0.5 });
    expect(applyTransitionAlpha(0.8, wipe, 1)).toBeCloseTo(0.8, 5);
  });
});

describe('轮76: transitionGeometry 几何转场', () => {
  it('无转场 → 无位移无裁剪', () => {
    const c = clip({ duration_sec: 5 });
    expect(transitionGeometry(c, 0, 1280, 720)).toEqual({ dx: 0, clipW: null });
  });

  it('slide-in：从右侧滑入（起点 dx=fw，窗口结束 dx=0）', () => {
    const c = clip({ duration_sec: 5, transition_in: 'slide', transition_duration_sec: 0.5 });
    expect(transitionGeometry(c, 0, 1280, 720).dx).toBeCloseTo(1280, 5);
    expect(transitionGeometry(c, 0.05, 1280, 720).dx).toBeCloseTo(640, 5);
    expect(transitionGeometry(c, 0.1, 1280, 720).dx).toBeCloseTo(0, 5);
  });

  it('slide-out：向左滑出（dx 从 0 到 -fw）', () => {
    const c = clip({ duration_sec: 5, transition_out: 'slide', transition_duration_sec: 0.5 });
    expect(transitionGeometry(c, 0.9, 1280, 720).dx).toBeCloseTo(0, 5);
    expect(transitionGeometry(c, 0.95, 1280, 720).dx).toBeCloseTo(-640, 5);
    expect(transitionGeometry(c, 1, 1280, 720).dx).toBeCloseTo(-1280, 5);
  });

  it('wipe-in：可见宽从 0 到 fw；wipe-out：从 fw 到 0', () => {
    const inC = clip({ duration_sec: 5, transition_in: 'wipe', transition_duration_sec: 0.5 });
    expect(transitionGeometry(inC, 0, 1280, 720).clipW).toBeCloseTo(0, 5);
    expect(transitionGeometry(inC, 0.05, 1280, 720).clipW).toBeCloseTo(640, 5);
    expect(transitionGeometry(inC, 0.1, 1280, 720).clipW).toBeCloseTo(1280, 5);

    const outC = clip({ duration_sec: 5, transition_out: 'wipe', transition_duration_sec: 0.5 });
    expect(transitionGeometry(outC, 0.9, 1280, 720).clipW).toBeCloseTo(1280, 5);
    expect(transitionGeometry(outC, 1, 1280, 720).clipW).toBeCloseTo(0, 5);
  });
});

describe('M5 时间重映射（关键帧 speed 插值）', () => {
  it('双关键帧 speed 线性插值', () => {
    const props = interpolateProperties([
      { time: 0, properties: { speed: 0.5 } },
      { time: 1, properties: { speed: 2 } },
    ], 0.5);
    expect(props.speed).toBeCloseTo(1.25, 5);
  });

  it('播放头在前/后关键帧之外 → 取端点值', () => {
    const kfs = [
      { time: 0.2, properties: { speed: 0.5 } },
      { time: 0.8, properties: { speed: 2 } },
    ];
    expect(interpolateProperties(kfs, 0).speed).toBeCloseTo(0.5, 5);
    expect(interpolateProperties(kfs, 1).speed).toBeCloseTo(2, 5);
  });

  it('无 speed 关键帧 → 不返回 speed 属性（回退 clip.speed）', () => {
    const props = interpolateProperties([
      { time: 0, properties: { opacity: 0 } },
      { time: 1, properties: { opacity: 1 } },
    ], 0.5);
    expect(props.speed).toBeUndefined();
  });
});
