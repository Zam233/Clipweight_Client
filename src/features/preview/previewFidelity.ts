/**
 * 预览保真度提示（O-特效预览还原度）。
 *
 * 预览是 Canvas 近似合成，导出是 ffmpeg 滤镜链，两者能力**不完全重合**。
 * 与其让用户以为"预览什么样、成片就什么样"，不如把差异显式标出来：
 *
 * - `noPreview`：导出有、预览没有（例如 LUT 调色 `metadata.lut_path`）——
 *   预览看不出效果，但成片会有；
 * - `noExport`：预览有、导出没有（例如星形/心形蒙版）——
 *   预览能看到，但导出会记 warning 并跳过。
 *
 * 纯函数、无副作用，测试可穷举。
 */
import type { Clip } from '@/types/timeline';

export interface FidelityReport {
  /** 仅渲染后可见（预览无法还原） */
  noPreview: string[];
  /** 仅预览可见（导出未支持） */
  noExport: string[];
}

/** 预览无法还原的导出特性 */
export function unpreviewableFeatures(clip: Clip): string[] {
  const out: string[] = [];
  const meta = (clip.metadata ?? {}) as Record<string, unknown>;
  if (typeof meta.lut_path === 'string' && meta.lut_path.trim()) {
    out.push('LUT 调色');
  }
  if (meta.blend_alpha === true) {
    out.push('Alpha 混合');
  }
  if (typeof meta.soft_subtitle === 'string' && meta.soft_subtitle.trim()) {
    out.push('软字幕轨');
  }
  return out;
}

/** 导出未支持、仅预览可见的特性 */
export function previewOnlyFeatures(clip: Clip): string[] {
  const out: string[] = [];
  if (clip.mask_type === 'star') out.push('星形蒙版');
  if (clip.mask_type === 'heart') out.push('心形蒙版');
  return out;
}

/** 汇总保真度提示（空数组表示预览与导出一致） */
export function previewFidelity(clip: Clip | null | undefined): FidelityReport {
  if (!clip) return { noPreview: [], noExport: [] };
  return {
    noPreview: unpreviewableFeatures(clip),
    noExport: previewOnlyFeatures(clip),
  };
}

/** 提示文案（预览角标用）；无差异返回空数组 */
export function fidelityBadges(clip: Clip | null | undefined): string[] {
  const { noPreview, noExport } = previewFidelity(clip);
  const badges: string[] = [];
  if (noPreview.length > 0) badges.push(`${noPreview.join('、')}·仅渲染后可见`);
  if (noExport.length > 0) badges.push(`${noExport.join('、')}·导出未支持`);
  return badges;
}
