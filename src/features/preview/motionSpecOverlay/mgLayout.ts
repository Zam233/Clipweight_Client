/** MotionSpec DOM 覆盖层布局/变换（镜像后端 CSS 语义，不执行 mg_html）。 */
import type { MgElement } from '../mgRenderer';

export const CSS_TRANSFORM_ORDER = [
  'perspective', 'scale', 'rotate', 'translateY', 'translateX', 'translateZ',
  'scaleX', 'scaleY', 'rotateX', 'rotateY', 'rotateZ',
] as const;

export function cssTiming(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return 'linear';
  const v = value.trim();
  if (v.startsWith('cubic-bezier(')) return v;
  if (['linear', 'ease', 'ease-in', 'ease-out', 'ease-in-out'].includes(v)) return v;
  return v === 'back-out' ? 'cubic-bezier(.34,1.56,.64,1)' : 'linear';
}

export function assertSafeCssValue(value: string): boolean {
  const v = value.toLowerCase();
  return !/url\s*\(|expression\s*\(|javascript:|@import|var\s*\(/.test(v);
}

export function safeImageSrc(src: unknown): string | null {
  if (typeof src !== 'string') return null;
  const s = src.trim();
  if (!s) return null;
  if (s.startsWith('blob:') || s.startsWith('data:image/png;base64,')
    || s.startsWith('data:image/jpeg;base64,') || s.startsWith('data:image/webp;base64,')) {
    return s.length > 2_800_000 ? null : s;
  }
  if (/^[a-z]+:/i.test(s) || s.startsWith('//') || s.startsWith('/')) return null;
  return s;
}

function num(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}

/** 锚点只覆盖常用 x/y；未知值按 center 处理并记 approx（由调用方）。 */
export function anchorCss(el: MgElement, designW: number, designH: number): {
  style: Record<string, string>; reasons: string[];
} {
  const style: Record<string, string> = {};
  const reasons: string[] = [];
  const x = el.x; const y = el.y;
  if (typeof x === 'number') style.left = `${x}px`;
  else if (x === 'left') style.left = '20px';
  else if (x === 'right') style.right = '20px';
  else { style.left = '50%'; reasons.push('x:center'); }
  if (typeof y === 'number') style.top = `${y}px`;
  else if (y === 'top') style.top = '20px';
  else if (y === 'bottom') style.bottom = '60px';
  else { style.top = '50%'; reasons.push('y:center'); }
  if (style.left === '50%' || style.right) style.transform = 'translateX(-50%)';
  if (style.top === '50%' || style.bottom) {
    style.transform = `${style.transform ?? ''} translateY(-50%)`.trim();
  }
  return { style, reasons };
}

export function transformCss(props: Record<string, unknown>): string {
  const parts: string[] = [];
  const perspective = num(props.perspective, 0);
  if (perspective > 0) parts.push(`perspective(${perspective}px)`);
  if (num(props.scale, 1) !== 1) parts.push(`scale(${num(props.scale, 1)})`);
  if (num(props.rotate, 0)) parts.push(`rotate(${num(props.rotate, 0)}deg)`);
  if (num(props.translate_y, 0)) parts.push(`translateY(${num(props.translate_y, 0)}px)`);
  if (num(props.translate_x, 0)) parts.push(`translateX(${num(props.translate_x, 0)}px)`);
  if (num(props.translate_z, 0)) parts.push(`translateZ(${num(props.translate_z, 0)}px)`);
  if (num(props.scale_x, 1) !== 1) parts.push(`scaleX(${num(props.scale_x, 1)})`);
  if (num(props.scale_y, 1) !== 1) parts.push(`scaleY(${num(props.scale_y, 1)})`);
  if (num(props.rotate_x, 0)) parts.push(`rotateX(${num(props.rotate_x, 0)}deg)`);
  if (num(props.rotate_y, 0)) parts.push(`rotateY(${num(props.rotate_y, 0)}deg)`);
  if (num(props.rotate_z, 0)) parts.push(`rotateZ(${num(props.rotate_z, 0)}deg)`);
  return parts.join(' ');
}

export function has3D(props: Record<string, unknown>): boolean {
  return ['translate_z', 'rotate_x', 'rotate_y', 'perspective'].some((k) => k in props && num(props[k], 0) !== 0);
}
