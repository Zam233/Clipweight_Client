import type { MgElement, MgSpec } from '../mgRenderer';
import type { OverlayElementPlan, OverlayFidelity, OverlayKeyframe, OverlayPlan } from './overlayTypes';
import { anchorCss, assertSafeCssValue, cssTiming, has3D, safeImageSrc, transformCss } from './mgLayout';

const asRecord = (v: unknown): Record<string, unknown> => (
  v && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {}
);

function propsOf(el: MgElement, kf: Record<string, unknown>): Record<string, unknown> {
  return { ...(el as Record<string, unknown>), ...asRecord(kf.properties), ...kf };
}

function cssNum(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

function fidelity(reasons: string[], unsupported: string[] = []): OverlayFidelity {
  return { exact: [], approx: reasons, unsupported, reasons };
}

export function buildOverlayPlan(
  spec: MgSpec,
  params: Record<string, unknown>,
  timeline: { width: number; height: number; fps: number },
): OverlayPlan {
  const elements: OverlayElementPlan[] = [];
  const specFidelity = fidelity(['css3d:approx']);
  const designW = cssNum(spec.width, 1920);
  const designH = cssNum(spec.height, 1080);
  const duration = Math.max(0.01, cssNum(spec.duration_sec, 0));
  for (const el of spec.elements ?? []) {
    const kfs = Array.isArray(el.keyframes) ? el.keyframes : [];
    if (kfs.length < 2) continue;
    const anchor = anchorCss(el, designW, designH);
    const baseStyle: Record<string, string> = {
      position: 'absolute',
      ...anchor.style,
      transformOrigin: '50% 50%',
      pointerEvents: 'none',
    };
    const font = typeof el.font_family === 'string' ? el.font_family : 'sans-serif';
    if (el.type === 'text') {
      baseStyle.fontFamily = font;
      baseStyle.fontSize = `${cssNum(el.font_size, cssNum(optionsSize(el), 48))}px`;
      baseStyle.color = typeof el.font_color === 'string' ? el.font_color : '#fff';
      baseStyle.textAlign = typeof el.text_align === 'string' ? el.text_align : 'left';
      baseStyle.whiteSpace = 'pre';
      baseStyle.fontWeight = String(el.font_weight ?? 'normal');
      if (el.letter_spacing !== undefined) baseStyle.letterSpacing = `${cssNum(el.letter_spacing, 0)}px`;
      if (el.line_height !== undefined) baseStyle.lineHeight = String(el.line_height);
      if (typeof el.background === 'string' && assertSafeCssValue(el.background)) baseStyle.background = el.background;
      if (el.border_radius !== undefined) baseStyle.borderRadius = `${cssNum(el.border_radius, 0)}px`;
      if (el.border_width) baseStyle.border = `${cssNum(el.border_width, 0)}px solid ${String(el.border_color ?? 'transparent')}`;
    } else if (el.type === 'image') {
      baseStyle.width = `${cssNum(el.width, 100)}px`;
      baseStyle.height = `${cssNum(el.height, 100)}px`;
      baseStyle.objectFit = 'contain';
    } else {
      baseStyle.width = `${cssNum(el.width, 100)}px`;
      baseStyle.height = `${cssNum(el.height, cssNum(el.width, 100))}px`;
      baseStyle.background = typeof el.background === 'string' && assertSafeCssValue(el.background)
        ? el.background : (typeof el.fill === 'string' ? el.fill : '#fff');
      if (el.border_radius !== undefined) baseStyle.borderRadius = `${cssNum(el.border_radius, 0)}px`;
    }
    const frames: OverlayKeyframe[] = kfs
      .filter((k) => typeof k.time === 'number' && Number.isFinite(k.time))
      .map((k) => {
        const p = propsOf(el, k as Record<string, unknown>);
        const t = transformCss(p);
        const frame: OverlayKeyframe = {
          offset: Math.max(0, Math.min(1, cssNum(k.time, 0) / duration)),
          easing: cssTiming(k.easing ?? (k as Record<string, unknown>).easing),
        };
        if (t) frame.transform = t;
        if (p.opacity !== undefined) frame.opacity = String(Math.max(0, Math.min(1, cssNum(p.opacity, 1))));
        const filter = typeof p.filter === 'string' && assertSafeCssValue(p.filter) ? p.filter : '';
        if (filter) frame.filter = filter;
        if (p.blur !== undefined) frame.filter = `blur(${Math.max(0, Math.min(48, cssNum(p.blur, 0)))}px)`;
        const mask = asRecord(p.mask);
        if (mask.w !== undefined) {
          const x = cssNum(mask.x, 0) * 100; const y = cssNum(mask.y, 0) * 100;
          const w = cssNum(mask.w, 1) * 100; const h = cssNum(mask.h, 1) * 100;
          frame.clipPath = `inset(${y}% ${100 - x - w}% ${100 - y - h}% ${x}%)`;
        }
        return frame;
      });
    if (frames.length < 2) continue;
    if (frames[0].offset > 0) frames.unshift({ ...frames[0], offset: 0 });
    const last = frames[frames.length - 1];
    if (last.offset < 1) frames.push({ ...last, offset: 1 });
    const elFid = fidelity([...anchor.reasons, 'css3d:approx']);
    if (el.type === 'image') {
      const src = safeImageSrc(el.src);
      if (!src) {
        elFid.unsupported.push('image:external-or-unsafe');
        continue;
      }
    }
    if (kfs.some((k) => has3D(propsOf(el, k as Record<string, unknown>)))) {
      elFid.approx.push('3d:css3d');
    }
    elements.push({
      id: String(el.id ?? `${el.type}_${elements.length}`),
      kind: el.type as OverlayElementPlan['kind'],
      tag: el.type === 'image' ? 'img' : 'div',
      text: el.type === 'text' ? String(el.content ?? '') : undefined,
      attrs: el.type === 'image' ? { src: safeImageSrc(el.src) ?? '' } : {},
      baseStyle,
      keyframes: frames,
      durationSec: duration,
      fidelity: elFid,
    });
  }
  return {
    key: JSON.stringify({ elements: elements.map((e) => [e.id, e.baseStyle, e.keyframes]), timeline, duration }).slice(0, 4096),
    width: timeline.width, height: timeline.height, durationSec: duration,
    elements, fidelity: specFidelity,
  };
}

function optionsSize(el: MgElement): unknown {
  const style = asRecord(el.style);
  return style.font_size;
}
