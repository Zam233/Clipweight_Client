// @vitest-environment jsdom
/**
 * 预览保真度提示（O-特效预览还原度）。
 *
 * 目的是"别让用户以为预览什么样成片就什么样"：
 * LUT 调色导出有、预览没有；星形/心形蒙版预览有、导出没有。
 */
import { describe, it, expect } from 'vitest';
import {
  fidelityBadges, previewFidelity, previewOnlyFeatures, unpreviewableFeatures,
} from './previewFidelity';
import { createDefaultClip } from '@/types/timeline';
import type { Clip } from '@/types/timeline';

function clip(overrides: Partial<Clip> = {}): Clip {
  return createDefaultClip({ id: 'c1', kind: 'video', track_id: 't0', start_sec: 0, duration_sec: 5, ...overrides });
}

describe('unpreviewableFeatures', () => {
  it('LUT 调色 → 仅渲染后可见', () => {
    expect(unpreviewableFeatures(clip({ metadata: { lut_path: 'x.cube' } }))).toEqual(['LUT 调色']);
  });

  it('空白/非字符串 lut_path 不算', () => {
    expect(unpreviewableFeatures(clip({ metadata: { lut_path: '   ' } }))).toEqual([]);
    expect(unpreviewableFeatures(clip({ metadata: { lut_path: 5 } }))).toEqual([]);
  });

  it('软字幕轨与 alpha 混合', () => {
    expect(unpreviewableFeatures(clip({ metadata: { soft_subtitle: 'a.srt' } }))).toEqual(['软字幕轨']);
    expect(unpreviewableFeatures(clip({ metadata: { blend_alpha: true } }))).toEqual(['Alpha 混合']);
  });

  it('普通片段没有任何"不可预览"特性', () => {
    expect(unpreviewableFeatures(clip({ metadata: {} }))).toEqual([]);
    expect(unpreviewableFeatures(clip())).toEqual([]);
  });

  it('fx_* 数值特效不算（预览已用 CSS filter 近似）', () => {
    expect(unpreviewableFeatures(clip({ fx_brightness: 1.2, fx_blur: 3 }))).toEqual([]);
  });
});

describe('previewOnlyFeatures', () => {
  it('星形/心形蒙版导出未支持', () => {
    expect(previewOnlyFeatures(clip({ mask_type: 'star' }))).toEqual(['星形蒙版']);
    expect(previewOnlyFeatures(clip({ mask_type: 'heart' }))).toEqual(['心形蒙版']);
  });

  it('rect/ellipse/polygon 不提示（前后端都支持）', () => {
    for (const mask_type of ['rect', 'ellipse', 'polygon'] as const) {
      expect(previewOnlyFeatures(clip({ mask_type }))).toEqual([]);
    }
  });
});

describe('previewFidelity / fidelityBadges', () => {
  it('两侧差异分别汇总', () => {
    const report = previewFidelity(clip({ metadata: { lut_path: 'x.cube' }, mask_type: 'star' }));
    expect(report.noPreview).toEqual(['LUT 调色']);
    expect(report.noExport).toEqual(['星形蒙版']);
  });

  it('角标文案区分两个方向', () => {
    const badges = fidelityBadges(clip({ metadata: { lut_path: 'x.cube' }, mask_type: 'star' }));
    expect(badges).toHaveLength(2);
    expect(badges.some((b) => b.includes('仅渲染后可见'))).toBe(true);
    expect(badges.some((b) => b.includes('导出未支持'))).toBe(true);
  });

  it('无差异与空输入都返回空角标', () => {
    expect(fidelityBadges(clip())).toEqual([]);
    expect(fidelityBadges(null)).toEqual([]);
    expect(fidelityBadges(undefined)).toEqual([]);
    expect(previewFidelity(null)).toEqual({ noPreview: [], noExport: [] });
  });
});
