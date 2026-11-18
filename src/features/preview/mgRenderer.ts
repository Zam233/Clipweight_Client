/**
 * MG 动画的前端渲染层（devplan M2 T2.1/T2.2）。
 *
 * 为什么要在浏览器里渲染：动画的中间表示本来就是 **JSON**（后端 `mg/validator.py` 校验、
 * `mg/generator.py` 产出），而时间线上每一个 animation clip 的 `metadata.mg_def` 里
 * 就存着这份 spec。既然 spec 已经在手上，预览再往后端要一张已渲染的图/视频就纯属绕路
 * ——直接把它画进预览 canvas 即可（后端渲染仍是最终成片的唯一权威，见
 * `docs/frontend-preview-and-library-prd-2026-11-02.md` §5）。
 *
 * 三条纪律：
 * 1. **白名单渲染**：只画 `mg/validator.py` 声明过的元素类型与可动画属性；不认识的东西
 *    记进 `fidelity.unsupported`，不猜、不静默画错。
 * 2. **不执行模型生成的 HTML**（AGENTS #19/#21 的同一精神）：这里只消费结构化 JSON，
 *    `metadata.mg_html` 一律不碰。
 * 3. **图片只认同源或 blob**：spec 里的 `src` 若指向外部域名直接跳过并记 fidelity，
 *    避免「LLM 写个 URL 就把预览变成任意请求器」，也避免 canvas 被污染。
 */
import { canvasBlurRadius } from './motionSpecOverlay/blurModel';
import {
  EasingFunctions,
  normalizeBezier,
  cubicBezierEase,
  type EasingName,
} from '@/features/timeline/engine/easing';

/** 后端 `mg/validator.py:VALID_ELEMENT_TYPES` 的镜像（少一个就记 unsupported）。 */
export const MG_ELEMENT_TYPES = [
  'text', 'shape', 'line', 'circle', 'ring', 'arc', 'bg', 'image',
] as const;
export type MgElementType = (typeof MG_ELEMENT_TYPES)[number];

/** 前端只做**能对的**属性插值；字符串型（color/background/font）按段首值吸附。 */
const NUMBER_PROPS = new Set([
  'opacity', 'scale', 'translate_x', 'translate_y', 'rotate',
  'width', 'height', 'font_size', 'border_radius', 'border_width',
  'letter_spacing', 'font_weight', 'line_height',
]);

/** 后端 easing 名 → 前端曲线名。对不上就退化 linear（并记 fidelity）。 */
const EASING_MAP: Record<string, EasingName> = {
  linear: 'linear',
  ease: 'ease-in-out',
  'ease-in': 'ease-in',
  'ease-out': 'ease-out',
  'ease-in-out': 'ease-in-out',
  'back-out': 'ease-out-back',
  'elastic-out': 'ease-out-elastic',
  bounce: 'ease-out-bounce',
};

export interface MgKeyframe {
  time: number;
  properties?: Record<string, unknown>;
  easing?: string;
  /** 兼容后端把属性平铺在 keyframe 上（validator 允许 `properties` 缺省） */
  [key: string]: unknown;
}

export interface MgElement {
  type: string;
  content?: string;
  shape?: string;
  src?: string;
  /** 关键帧（后端要求至少 2 个） */
  keyframes?: MgKeyframe[];
  /** 元素级静态样式（部分模板只给静态值 + 少量关键帧） */
  [key: string]: unknown;
}

export interface MgSpec {
  animation_id?: string;
  duration_sec?: number;
  width?: number;
  height?: number;
  style?: { background?: string; font_family?: string };
  elements?: MgElement[];
  [key: string]: unknown;
}

export interface MgFidelity {
  /** 不认识的元素类型 */
  unsupportedTypes: string[];
  /** 被拒绝的资源（外链图片等） */
  blockedResources: string[];
  /** 不认识的 easing（已退化 linear） */
  unknownEasings: string[];
  /** 缺 spec：只能画占位 */
  missingSpec: boolean;
  /** Canvas 无等价语义的属性（3D 等） */
  unsupportedProps: string[];
  /** Canvas 只能近似的属性（blur 等） */
  approxProps: string[];
}

export function emptyFidelity(): MgFidelity {
  return {
    unsupportedTypes: [], blockedResources: [], unknownEasings: [], missingSpec: false,
    unsupportedProps: [], approxProps: [],
  };
}

function hasFidelityIssue(f: MgFidelity): boolean {
  return f.missingSpec || f.unsupportedTypes.length > 0
    || f.blockedResources.length > 0 || f.unknownEasings.length > 0
    || (f.unsupportedProps?.length ?? 0) > 0 || (f.approxProps?.length ?? 0) > 0;
}

export function fidelityHasIssue(f: MgFidelity): boolean {
  return hasFidelityIssue(f);
}

/** 从 clip.metadata 里取 spec（后端写入 `mg_def`；也接受直接挂在 metadata 上的旧格式）。 */
/** 取后端写入的 mg_params（占位符实际值）。 */
export function mgParamsOf(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  const raw = metadata?.mg_params;
  return raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
}

/** 替换 `{key}` 占位符：预览此前直接画 `{title}`，看起来像模板占位符。 */
function withParams(value: string, params: Record<string, unknown>): string {
  if (!value || value.indexOf('{') < 0) return value;
  return value.replace(/\{([a-zA-Z_][a-zA-Z0-9_]*)\}/g, (whole, key: string) => {
    if (!(key in params)) return whole;
    const v = params[key];
    return v === null || v === undefined ? '' : String(v);
  });
}

export function mgSpecOf(metadata: Record<string, unknown> | undefined): MgSpec | null {
  if (!metadata) return null;
  const raw = metadata.mg_def ?? metadata.mg_spec;
  if (!raw || typeof raw !== 'object') return null;
  const spec = raw as MgSpec;
  if (!Array.isArray(spec.elements) || spec.elements.length === 0) return null;
  return spec;
}

/** 图片源只允许同源相对路径 / blob / data（外链→拒绝并记 fidelity）。 */
function isAllowedImageSrc(src: string): boolean {
  const s = src.trim();
  if (!s) return false;
  if (s.startsWith('blob:') || s.startsWith('data:image/')) return true;
  if (s.startsWith('http://') || s.startsWith('https://')) return false;
  return true; // 相对路径 → 同源
}

/** 颜色插值：只处理 #rgb/#rrggbb 与 rgb()/rgba()；其它按段首吸附。 */
function parseColor(value: string): [number, number, number, number] | null {
  const v = value.trim();
  if (v.startsWith('#')) {
    const hex = v.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) / 255 : 1;
      return [r, g, b, a];
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1;
      return [r, g, b, a];
    }
    return null;
  }
  const m = /^rgba?\(([^)]+)\)$/i.exec(v);
  if (m) {
    const parts = m[1].split(',').map((x) => parseFloat(x.trim()));
    if (parts.length >= 3) return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
  }
  return null;
}

function mixColor(a: string, b: string, t: number): string | null {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  const r = Math.round(ca[0] + (cb[0] - ca[0]) * t);
  const g = Math.round(ca[1] + (cb[1] - ca[1]) * t);
  const bl = Math.round(ca[2] + (cb[2] - ca[2]) * t);
  const al = ca[3] + (cb[3] - ca[3]) * t;
  return `rgba(${r}, ${g}, ${bl}, ${Number(al.toFixed(3))})`;
}

/** 取 keyframe 的动画属性（兼容 `properties` 与平铺两种写法）。 */
function propsOf(kf: MgKeyframe): Record<string, unknown> {
  if (kf.properties && typeof kf.properties === 'object') return kf.properties;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(kf)) {
    if (k === 'time' || k === 'properties' || k === 'easing' || k === 'bezier') continue;
    out[k] = v;
  }
  return out;
}

function sortedKeyframes(el: MgElement): MgKeyframe[] {
  const kfs = Array.isArray(el.keyframes) ? el.keyframes : [];
  return [...kfs]
    .filter((k) => k && typeof k.time === 'number')
    .sort((a, b) => a.time - b.time);
}

/** 在 localSec 处解析元素属性（数字插值 + 颜色插值 + 其余吸附）。 */
export function resolveElementProps(
  el: MgElement,
  localSec: number,
  fidelity: MgFidelity,
): Record<string, number | string> {
  const kfs = sortedKeyframes(el);
  if (kfs.length === 0) {
    // 没有关键帧：用元素静态值（部分模板元素是完全静态的）
    const out: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(el)) {
      if (typeof v === 'number' || typeof v === 'string') out[k] = v;
    }
    return out;
  }
  if (kfs.length === 1) return { ...propsOf(kfs[0]) } as Record<string, number | string>;
  const t = Math.max(kfs[0].time, Math.min(localSec, kfs[kfs.length - 1].time));
  let lo = 0;
  for (let i = 0; i < kfs.length - 1; i += 1) {
    if (kfs[i].time <= t && t <= kfs[i + 1].time) { lo = i; break; }
    if (t > kfs[i + 1].time) lo = i + 1;
  }
  const prev = kfs[lo];
  const next = kfs[Math.min(lo + 1, kfs.length - 1)];
  const span = next.time - prev.time;
  const raw = span > 0 ? (t - prev.time) / span : 0;
  // MotionSpec 契约：easing 属于起始帧→下一帧；旧 MG 兼容读取结束帧。
  const easingName = String(prev.easing || next.easing || 'linear');
  let handles = normalizeBezier((prev as { bezier?: unknown }).bezier)
    ?? normalizeBezier((next as { bezier?: unknown }).bezier);
  const cubic = /^cubic-bezier\(([^)]+)\)$/.exec(easingName.trim());
  if (!handles && cubic) {
    const parts = cubic[1].split(',').map((v) => Number(v.trim()));
    if (parts.length === 4 && parts.every((v) => Number.isFinite(v))) {
      handles = { x1: parts[0], y1: parts[1], x2: parts[2], y2: parts[3] };
    }
  }
  let eased: number;
  if (handles) {
    eased = cubicBezierEase(raw, handles);
  } else {
    const mapped = EASING_MAP[easingName] ?? EASING_MAP[easingName.toLowerCase()];
    if (!mapped) {
      if (!fidelity.unknownEasings.includes(easingName)) fidelity.unknownEasings.push(easingName);
      eased = raw;
    } else {
      eased = (EasingFunctions[mapped] ?? EasingFunctions.linear)(raw);
    }
  }
  const a = propsOf(prev);
  const b = propsOf(next);
  const out: Record<string, number | string> = {};
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (key === 'easing' || key === 'filter' || key === 'transform_origin') continue;
    const av = a[key] ?? b[key];
    const bv = b[key] ?? a[key];
    if (typeof av === 'number' && typeof bv === 'number') {
      out[key] = av + (bv - av) * eased;
    } else if (NUMBER_PROPS.has(key)) {
      const an = typeof av === 'number' ? av : parseFloat(String(av));
      const bn = typeof bv === 'number' ? bv : parseFloat(String(bv));
      out[key] = Number.isFinite(an) && Number.isFinite(bn)
        ? an + (bn - an) * eased
        : (av as string);
    } else if (typeof av === 'string' && typeof bv === 'string') {
      const mixed = mixColor(av, bv, eased);
      out[key] = mixed ?? av;   // 颜色能插值就插，其它（如 font_family）吸附段首
    } else if (typeof av === 'string' || typeof av === 'number') {
      out[key] = av;
    }
  }
  return out;
}

function num(v: unknown, fallback: number): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''));
  return Number.isFinite(n) ? n : fallback;
}

function str(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}

export interface MgDrawBox {
  x: number; y: number; w: number; h: number;
}

/**
 * 把 MG spec 在 `localSec` 时刻画进 `ctx` 的 box。
 *
 * 坐标系：spec 的 width/height 是设计分辨率，这里按 box 等比缩放——
 * 与后端渲染的 `width/height` 语义一致，避免"预览里偏左上角"这种错位。
 */
/** 复刻后端 mg_renderer 的锚点语义：center/left/right/top/bottom + offset。 */
function resolveAnchor(
  x: unknown, y: unknown, xOff: number, yOff: number,
  ew: number, eh: number, designW: number, designH: number,
): { x: number; y: number } {
  let px: number;
  if (x === 'center') px = designW / 2 + xOff - ew / 2;
  else if (x === 'left') px = 20 + xOff;
  else if (x === 'right') px = designW - 20 - xOff - ew;
  else px = num(x, 0);
  let py: number;
  if (y === 'center') py = designH / 2 + yOff - eh / 2;
  else if (y === 'top') py = 20 + yOff;
  else if (y === 'bottom') py = designH - 60 - yOff - eh;
  else py = num(y, 0);
  return { x: px, y: py };
}

export function drawMgFrame(
  ctx: CanvasRenderingContext2D,
  spec: MgSpec,
  localSec: number,
  box: MgDrawBox,
  fidelity: MgFidelity = emptyFidelity(),
  params: Record<string, unknown> = {},
): void {
  const elements = Array.isArray(spec.elements) ? spec.elements : [];
  if (elements.length === 0) {
    fidelity.missingSpec = true;
    return;
  }
  const designW = num(spec.width, 1920) || 1920;
  const designH = num(spec.height, 1080) || 1080;
  const sx = box.w / designW;
  const sy = box.h / designH;
  const background = str(spec.style?.background, '');
  const fontFamily = str(spec.style?.font_family, "sans-serif");
  const duration = num(spec.duration_sec, 0);

  ctx.save();
  // 只在 box 内绘制：MG 元素可能按设计稿坐标画到边界外
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  ctx.translate(box.x, box.y);
  ctx.scale(sx, sy);

  if (background && background !== 'transparent') {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, designW, designH);
  }

  for (const el of elements) {
    const type = str(el.type) as MgElementType;
    if (!MG_ELEMENT_TYPES.includes(type)) {
      if (!fidelity.unsupportedTypes.includes(type)) fidelity.unsupportedTypes.push(type);
      continue;
    }
    const local = duration > 0 ? Math.max(0, Math.min(localSec, duration)) : Math.max(0, localSec);
    const p = resolveElementProps(el, local, fidelity);
    for (const key of ['translate_z', 'rotate_x', 'rotate_y', 'perspective']) {
      if (key in p || key in el) {
        if (!fidelity.unsupportedProps.includes(key)) fidelity.unsupportedProps.push(key);
      }
    }
    for (const key of ['blur', 'clip_inset', 'mask']) {
      if (key in p || key in el) {
        if (!fidelity.approxProps.includes(key)) fidelity.approxProps.push(key);
      }
    }
    const opacity = Math.max(0, Math.min(1, num(p.opacity, num(el.opacity, 1))));
    if (opacity <= 0.001) continue;

    const scale = num(p.scale, 1);
    const rot = num(p.rotate, 0);
    const tx = num(p.translate_x, 0);
    const ty = num(p.translate_y, 0);
    const w = num(p.width, num(el.width, designW));
    const h = num(p.height, num(el.height, designH));
    // 后端坐标是锚点语义（center/left/right + offset），不是裸像素左上角；
    // 旧实现 num('center') → 0，所有元素被画到 (0,0)，预览全挤在左上角。
    const anchorPos = resolveAnchor(el.x, el.y, num(el.x_offset, 0), num(el.y_offset, 0),
      w, h, designW, designH);
    let ex = (type === 'text' ? 0 : anchorPos.x) + tx;
    let ey = (type === 'text' ? 0 : anchorPos.y) + ty;

    ctx.save();
    ctx.globalAlpha = opacity;
    // 近似原语：blur 用 Canvas filter；clip/mask 用矩形裁剪；3D 已记 unsupported。
    if (typeof p.blur === 'number' || typeof el.blur === 'number') {
      const _designBlur = num(p.blur, num(el.blur, 0));
      const _scale = designW > 0 ? box.w / designW : 1;
      const _dpr = typeof window !== 'undefined' ? (window.devicePixelRatio || 1) : 1;
      const _cal = canvasBlurRadius(_designBlur, _scale, _dpr >= 2 ? 2 : 1);
      ctx.filter = `blur(${_cal ?? _designBlur}px)`;
    }
    const _clip = p.clip_inset ?? el.clip_inset;
    if (Array.isArray(_clip) && _clip.length === 4) {
      const [ct, cr, cb, cl] = _clip.map((v) => num(v, 0));
      ctx.beginPath();
      ctx.rect(cl, ct, Math.max(0, w - cl - cr), Math.max(0, h - ct - cb));
      ctx.clip();
    }
    const _maskRaw = p.mask ?? el.mask;
    if (_maskRaw && typeof _maskRaw === 'object') {
      const _mask = _maskRaw as Record<string, unknown>;
      const mx = num(_mask.x, 0); const my = num(_mask.y, 0);
      const mw = num(_mask.w, 1); const mh = num(_mask.h, 1);
      ctx.beginPath();
      ctx.rect(ex + mx * w, ey + my * h, mw * w, mh * h);
      ctx.clip();
    }
    if (type !== 'text' && (scale !== 1 || rot !== 0)) {
      // 变换原点：默认元素左上（与渲染器 transform-origin 缺省一致）
      ctx.translate(ex + w / 2, ey + h / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.translate(-(ex + w / 2), -(ey + h / 2));
    }

    // 颜色/背景/描边中的 {accent} 等占位符也要从 mg_params 替换；否则
    // parseColor('{accent}') 返回 null，线条/描边直接画不出来。
    const color = withParams(str(p.color, str(el.color, str(el.font_color, '#FFFFFF'))), params);
    const background = withParams(str(p.background, str(el.background, '')), params);
    const radius = num(p.border_radius, num(el.border_radius, 0));

    switch (type) {
      case 'text': {
        const content = withParams(str(el.content, ''), params);
        if (!content) break;
        const fontSize = num(p.font_size, num(el.font_size, Math.max(24, h * 0.5)));
        const weight = num(p.font_weight, num(el.font_weight, 600));
        const align = str(el.text_align, str(el.align, 'left'));
        const italic = Boolean(el.font_italic);
        ctx.font = `${italic ? 'italic ' : ''}${Math.round(weight)} ${Math.round(fontSize)}px ${fontFamily}`;
        const lines = content.split('\n');
        const lineHeight = num(p.line_height, num(el.line_height, 1.25)) * fontSize;
        // 渐变文字（后端 MGRenderer 用 background-clip:text 输出）
        const gradientBg = withParams(str(el.background, ''), params);
        if (Boolean(el.text_gradient) && gradientBg.startsWith('linear-gradient')) {
          const colors = [...gradientBg.matchAll(/#[0-9a-fA-F]{6,8}|rgba?\([^)]*\)/g)].map((m) => m[0]);
          if (colors.length >= 2) {
            const g = ctx.createLinearGradient(ex, ey, ex + Math.max(1, w), ey);
            colors.forEach((c, i) => g.addColorStop(i / (colors.length - 1), c));
            ctx.fillStyle = g;
          } else {
            ctx.fillStyle = color;
          }
        } else {
          ctx.fillStyle = color;
        }
        // 投影/霓虹/glitch：后端把多层 text-shadow 存在 text_shadow；canvas 只取第一层做主投影。
        const shadowRaw = str(el.text_shadow, '');
        if (shadowRaw) {
          const m = shadowRaw.match(/(-?\d+(?:\.\d+)?)px\s+(-?\d+(?:\.\d+)?)px\s+(\d+(?:\.\d+)?)px\s+(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/);
          if (m) {
            ctx.shadowColor = m[4];
            ctx.shadowOffsetX = Number(m[1]);
            ctx.shadowOffsetY = Number(m[2]);
            ctx.shadowBlur = Number(m[3]);
          }
        }
        // 文本宽度后端由浏览器布局决定；这里用 canvas 测量来还原 center 锚点。
        const measured = Math.max(...lines.map((ln) => ctx.measureText(ln).width), 1);
        // 文本元素通常没有显式 width/height：不能沿用 w/h 的 designW/designH 默认值，
        // 否则 center 锚点会按整幅画布居中，文字被顶到画面左上/顶部。
        const hasWidth = p.width != null || el.width != null;
        const hasHeight = p.height != null || el.height != null;
        const textW = hasWidth ? Math.max(w, measured) : measured;
        const textH = hasHeight ? Math.max(h, lineHeight * lines.length) : lineHeight * lines.length;
        const textAnchor = resolveAnchor(el.x, el.y, num(el.x_offset, 0), num(el.y_offset, 0),
          textW, textH, designW, designH);
        ex = textAnchor.x + tx;
        ey = textAnchor.y + ty;
        const maxWidth = w > 0 ? w : undefined;
        ctx.textBaseline = 'top';
        // 文本的缩放/旋转必须绕它自己的测量框中心；上面的全局变换用的是
        // 尚未测量的 ex/ey（0,0），会让文字绕画布原点飞出去。
        const textCx = ex + textW / 2;
        const textCy = ey + textH / 2;
        if (scale !== 1 || rot !== 0) {
          ctx.save();
          ctx.translate(textCx, textCy);
          ctx.rotate((rot * Math.PI) / 180);
          ctx.scale(scale, scale);
          ctx.translate(-textCx, -textCy);
        }
        const strokeRaw = str(el.text_stroke, '');
        const strokeMatch = strokeRaw.match(/(\d+(?:\.\d+)?)px\s+(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))/);
        lines.forEach((line, i) => {
          let textX = ex;
          if (align === 'center') textX = ex + textW / 2;
          else if (align === 'right') textX = ex + textW;
          ctx.textAlign = align === 'center' ? 'center' : (align === 'right' ? 'right' : 'left');
          if (strokeMatch) {
            ctx.lineWidth = Number(strokeMatch[1]) * 2;
            ctx.strokeStyle = strokeMatch[2];
            ctx.lineJoin = 'round';
            ctx.strokeText(line, textX, ey + i * lineHeight, maxWidth);
          }
          ctx.fillText(line, textX, ey + i * lineHeight, maxWidth);
        });
        if (shadowRaw) {
          ctx.shadowColor = 'transparent';
          ctx.shadowBlur = 0;
          ctx.shadowOffsetX = 0;
          ctx.shadowOffsetY = 0;
        }
        if (scale !== 1 || rot !== 0) ctx.restore();
        break;
      }
      case 'shape': {
        const shape = str(el.shape, 'rect');
        if (background) {
          ctx.fillStyle = background;
          if (shape === 'ellipse') {
            ctx.beginPath();
            ctx.ellipse(ex + w / 2, ey + h / 2, Math.abs(w) / 2, Math.abs(h) / 2, 0, 0, Math.PI * 2);
            ctx.fill();
          } else if (radius > 0) {
            ctx.beginPath();
            if (typeof ctx.roundRect === 'function') {
              ctx.roundRect(ex, ey, w, h, radius);
            } else {
              ctx.rect(ex, ey, w, h);
            }
            ctx.fill();
          } else {
            ctx.fillRect(ex, ey, w, h);
          }
        }
        const bw = num(p.border_width, num(el.border_width, 0));
        if (bw > 0) {
          ctx.strokeStyle = withParams(str(p.border_color, str(el.border_color, color)), params);
          ctx.lineWidth = bw;
          ctx.strokeRect(ex, ey, w, h);
        }
        break;
      }
      case 'line': {
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, num(p.border_width, num(el.border_width, 4)));
        ctx.beginPath();
        ctx.moveTo(ex, ey);
        ctx.lineTo(ex + w, ey + h);
        ctx.stroke();
        break;
      }
      case 'circle':
      case 'ring': {
        const cx = ex + w / 2;
        const cy = ey + h / 2;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(Math.abs(w), Math.abs(h)) / 2, 0, Math.PI * 2);
        if (type === 'ring') {
          ctx.strokeStyle = color;
          ctx.lineWidth = Math.max(1, num(p.border_width, num(el.border_width, 8)));
          ctx.stroke();
        } else {
          ctx.fillStyle = background || color;
          ctx.fill();
        }
        break;
      }
      case 'arc': {
        const cx = ex + w / 2;
        const cy = ey + h / 2;
        const start = (num(el.start_deg, -90) * Math.PI) / 180;
        const sweep = (num(el.sweep_deg, 270) * Math.PI) / 180;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.min(Math.abs(w), Math.abs(h)) / 2, start, start + sweep);
        ctx.strokeStyle = color;
        ctx.lineWidth = Math.max(1, num(p.border_width, num(el.border_width, 10)));
        ctx.stroke();
        break;
      }
      case 'bg': {
        ctx.fillStyle = background || color;
        ctx.fillRect(ex, ey, w || designW, h || designH);
        break;
      }
      case 'image': {
        const src = withParams(str(el.src, ''), params);
        if (!src || !isAllowedImageSrc(src)) {
          if (src && !fidelity.blockedResources.includes(src)) fidelity.blockedResources.push(src);
          break;
        }
        const img = imageCache.get(src);
        if (img && img.complete && img.naturalWidth > 0) {
          ctx.drawImage(img, ex, ey, w, h);
        } else {
          // 首帧还没解码完：登记异步加载，下一帧（媒体版本变化）会重绘
          requestSpecImage(src);
        }
        break;
      }
      default:
        break;
    }
    ctx.restore();
  }
  ctx.restore();
}

/**
 * spec 图片的进程内缓存。
 *
 * 为什么允许缓存外链以外的图：这些图来自工作区（相对路径，同源），重复 new Image()
 * 会在拖动播放头时反复发起请求；缓存 + `complete` 即可。
 */
const imageCache = new Map<string, HTMLImageElement>();
const imagePending = new Set<string>();

function requestSpecImage(src: string): void {
  if (imagePending.has(src) || imageCache.has(src)) return;
  imagePending.add(src);
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    imageCache.set(src, img);
    imagePending.delete(src);
  };
  img.onerror = () => {
    imagePending.delete(src);
  };
  img.src = src;
}

/** 测试/切项目时清空 spec 图片缓存（避免跨项目串图）。 */
export function clearMgImageCache(): void {
  imageCache.clear();
  imagePending.clear();
}
