import type { Clip } from '@/types/timeline';
import type { Fidelity, RenderMode } from './overlayTypes';
import { mgSpecOf } from '../mgRenderer';
import { has3D } from './mgLayout';

export interface FidelityVerdict {
  mode: RenderMode;
  fidelity: Fidelity;
  exact: string[];
  approx: string[];
  unsupported: string[];
  reasons: string[];
}

export function verdictForClip(clip: Clip, mode: RenderMode): FidelityVerdict {
  const spec = mgSpecOf(clip.metadata);
  const out: FidelityVerdict = { mode, fidelity: 'approx', exact: [], approx: [], unsupported: [], reasons: [] };
  if (!spec) {
    out.fidelity = 'unsupported'; out.unsupported.push('mg_def'); out.reasons.push('missing mg_def');
    return out;
  }
  const threeD = (spec.elements ?? []).some((el) => (el.keyframes ?? []).some(
    (k) => has3D({ ...el, ...(k.properties as Record<string, unknown>), ...k } as Record<string, unknown>),
  ));
  const hasBlur = (spec.elements ?? []).some((el) => (el.keyframes ?? []).some(
    (k) => 'blur' in { ...el, ...(k.properties as Record<string, unknown>), ...k },
  ));
  if (hasBlur) out.approx.push('blur');
  if (!threeD) {
    if (out.approx.length === 0) out.exact.push('transform2d');
    return out;
  }
  if (mode === 'canvas-play') {
    out.fidelity = 'unsupported'; out.unsupported.push('3d');
    out.reasons.push('连续播放 Canvas 2D 不支持 3D');
    return out;
  }
  if (mode === 'server-frame') {
    out.fidelity = 'exact'; out.exact.push('3d'); return out;
  }
  out.approx.push('3d:css3d');
  out.reasons.push('CSS3D 与成片同一 CSS 语义，但未做逐像素阈值证明');
  return out;
}
