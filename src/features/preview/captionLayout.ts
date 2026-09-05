/**
 * Caption layout helpers — keep the Canvas preview WYSIWYG-consistent with the
 * backend ASS/libass renderer (see clipwright/schema/timeline.py + design.py).
 *
 * - Bottom anchor: ASS bottom alignment maps to `h-text_h-20` (design.py), i.e.
 *   the caption baseline sits 20px up from the frame bottom edge. The preview
 *   keeps textBaseline='middle' but anchors the text the same distance from the
 *   bottom, so it never drifts like the old 0.85-height heuristic.
 * - Font size: scaled by the SMALLER of the two frame dimensions so caption text
 *   never overflows a portrait frame (e.g. 1080x1920 exports, where height-only
 *   scaling would overshoot the width). The 1080 reference matches the default
 *   1080p timeline.
 */

/** Bottom-anchored caption baseline (frame-local, before the frame top fy is added). */
export function captionBaselineY(fh: number, bottomMargin = 20): number {
  return fh - bottomMargin;
}

/** Caption font size scaled to the frame via the min-dimension (portrait-safe). */
export function captionFontSize(
  fontSize: number,
  fw: number,
  fh: number,
  scale = 1,
): number {
  return fontSize * (Math.min(fw, fh) / 1080) * scale;
}

/**
 * X3: preview/export text-anchor parity — mirrors backend render.py
 * `_extract_text_overlay` + drawtext position maps:
 * - position: `metadata.position` → `metadata.style.position` → track-index
 *   fallback {1: bottom, 2: top, 3: center, else bottom}
 * - offset stacking: non-caption text clips on the same track stack +35px each
 *   (capped 500); captions stay anchored (export offset_y=0)
 * - y anchors are text-box centers: drawtext y is the box top (margin=20),
 *   so preview adds fontSize/2 to land the visual center at the same spot
 */
export interface TextLayout {
  x: number;
  y: number;
  align: 'left' | 'center' | 'right';
}

export function textLayout(
  opts: {
    position?: string | null;
    textAlign?: string | null;
    isCaption: boolean;
    stackIndex: number;
    fontSize: number;
    fw: number;
    fh: number;
    trackIndex: number;
  },
): TextLayout {
  const byTrack: Record<number, string> = { 1: 'bottom', 2: 'top', 3: 'center' };
  const pos = (opts.position
    ?? byTrack[opts.trackIndex]
    ?? 'bottom').toLowerCase();
  const offsetY = opts.isCaption ? 0 : Math.min(opts.stackIndex * 35, 500);
  const m = 20;
  const mid = opts.fontSize / 2;
  const nine: Record<string, TextLayout> = {
    center: { x: opts.fw / 2, y: opts.fh / 2, align: 'center' },
    top: { x: opts.fw / 2, y: m + mid, align: 'center' },
    bottom: { x: opts.fw / 2, y: opts.fh - m - mid, align: 'center' },
    left: { x: m + mid, y: opts.fh / 2, align: 'left' },
    right: { x: opts.fw - m - mid, y: opts.fh / 2, align: 'right' },
    top_left: { x: m + mid, y: m + mid, align: 'left' },
    top_right: { x: opts.fw - m - mid, y: m + mid, align: 'right' },
    bottom_left: { x: m + mid, y: opts.fh - m - mid, align: 'left' },
    bottom_right: { x: opts.fw - m - mid, y: opts.fh - m - mid, align: 'right' },
  };
  const base = nine[pos] ?? nine.bottom;
  // 未显式指定 position 时，保留 text_align 的左右习惯（居中系锚点才生效）
  let align = base.align;
  let x = base.x;
  if (!opts.position && base.align === 'center') {
    align = (opts.textAlign as TextLayout['align']) ?? 'center';
    if (align === 'left') x = opts.fw * 0.05;
    else if (align === 'right') x = opts.fw * 0.95;
  }
  return { x, y: base.y + offsetY, align };
}
