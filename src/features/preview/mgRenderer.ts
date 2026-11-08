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
}

export function emptyFidelity(): MgFidelity {
  return { unsupportedTypes: [], blockedResources: [], unknownEasings: [], missingSpec: false };
}

function hasFidelityIssue(f: MgFidelity): boolean {
  return f.missingSpec || f.unsupportedTypes.length > 0
    || f.blockedResources.length > 0 || f.unknownEasings.length > 0;
}

export function fidelityHasIssue(f: MgFidelity): boolean {
  return hasFidelityIssue(f);
}

/** 从 clip.metadata 里取 spec（后端写入 `mg_def`；也接受直接挂在 metadata 上的旧格式）。 */
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
  const easingName = String(next.easing || prev.easing || 'linear');
  const handles = normalizeBezier((next as { bezier?: unknown }).bezier);
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
export function drawMgFrame(
  ctx: CanvasRenderingContext2D,
  spec: MgSpec,
  localSec: number,
  box: MgDrawBox,
  fidelity: MgFidelity = emptyFidelity(),
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
    const opacity = Math.max(0, Math.min(1, num(p.opacity, num(el.opacity, 1))));
    if (opacity <= 0.001) continue;

    const scale = num(p.scale, 1);
    const rot = num(p.rotate, 0);
    const tx = num(p.translate_x, 0);
    const ty = num(p.translate_y, 0);
    const w = num(p.width, num(el.width, designW));
    const h = num(p.height, num(el.height, designH));
    const ex = num(el.x, 0) + tx;
    const ey = num(el.y, 0) + ty;

    ctx.save();
    ctx.globalAlpha = opacity;
    if (scale !== 1 || rot !== 0) {
      // 变换原点：默认元素左上（与渲染器 transform-origin 缺省一致）
      ctx.translate(ex + w / 2, ey + h / 2);
      ctx.rotate((rot * Math.PI) / 180);
      ctx.scale(scale, scale);
      ctx.translate(-(ex + w / 2), -(ey + h / 2));
    }

    const color = str(p.color, str(el.color, '#FFFFFF'));
    const background = str(p.background, str(el.background, ''));
    const radius = num(p.border_radius, num(el.border_radius, 0));

    switch (type) {
      case 'text': {
        const content = str(el.content, '');
        if (!content) break;
        const fontSize = num(p.font_size, num(el.font_size, Math.max(24, h * 0.5)));
        const weight = num(p.font_weight, num(el.font_weight, 600));
        const align = str(el.align, 'left');
        ctx.fillStyle = color;
        ctx.font = `${Math.round(weight)} ${Math.round(fontSize)}px ${fontFamily}`;
        ctx.textBaseline = 'top';
        const lines = content.split('\n');
        const lineHeight = num(p.line_height, num(el.line_height, 1.25)) * fontSize;
        const maxWidth = w > 0 ? w : undefined;
        lines.forEach((line, i) => {
          let textX = ex;
          if (align === 'center' && maxWidth) textX = ex + maxWidth / 2;
          else if (align === 'right' && maxWidth) textX = ex + maxWidth;
          ctx.textAlign = align === 'center' ? 'center' : (align === 'right' ? 'right' : 'left');
          ctx.fillText(line, textX, ey + i * lineHeight, maxWidth);
        });
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
          ctx.strokeStyle = str(p.border_color, str(el.border_color, color));
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
        const src = str(el.src, '');
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
