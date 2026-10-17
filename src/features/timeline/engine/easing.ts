/**
 * Keyframe interpolation engine — Penner easing functions + property interpolation.
 * (Design Plan P4-6)
 */

export type EasingName =
  | 'linear'
  | 'ease-in' | 'ease-out' | 'ease-in-out'
  | 'ease-in-quad' | 'ease-out-quad' | 'ease-in-out-quad'
  | 'ease-in-cubic' | 'ease-out-cubic' | 'ease-in-out-cubic'
  | 'ease-in-quart' | 'ease-out-quart' | 'ease-in-out-quart'
  | 'ease-in-expo' | 'ease-out-expo' | 'ease-in-out-expo'
  | 'ease-in-back' | 'ease-out-back' | 'ease-in-out-back'
  | 'ease-out-elastic' | 'ease-out-bounce';

export const EasingFunctions: Record<EasingName, (t: number) => number> = {
  linear: (t) => t,
  'ease-in': (t) => t * t,
  'ease-out': (t) => t * (2 - t),
  'ease-in-out': (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  'ease-in-quad': (t) => t * t,
  'ease-out-quad': (t) => t * (2 - t),
  'ease-in-out-quad': (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t),
  'ease-in-cubic': (t) => t * t * t,
  'ease-out-cubic': (t) => (--t) * t * t + 1,
  'ease-in-out-cubic': (t) => (t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1),
  'ease-in-quart': (t) => t * t * t * t,
  'ease-out-quart': (t) => 1 - (--t) * t * t * t,
  'ease-in-out-quart': (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - 8 * (--t) * t * t * t),
  'ease-in-expo': (t) => (t === 0 ? 0 : Math.pow(2, 10 * (t - 1))),
  'ease-out-expo': (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  'ease-in-out-expo': (t) => {
    if (t === 0 || t === 1) return t;
    return t < 0.5
      ? Math.pow(2, 20 * t - 10) / 2
      : (2 - Math.pow(2, -20 * t + 10)) / 2;
  },
  'ease-in-back': (t) => { const c = 1.70158; return (c + 1) * t * t * t - c * t * t; },
  'ease-out-back': (t) => { const c = 1.70158; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); },
  'ease-in-out-back': (t) => {
    const c = 1.70158 * 1.525;
    return t < 0.5
      ? (Math.pow(2 * t, 2) * ((c + 1) * 2 * t - c)) / 2
      : (Math.pow(2 * t - 2, 2) * ((c + 1) * (t * 2 - 2) + c) + 2) / 2;
  },
  'ease-out-elastic': (t) => {
    if (t === 0 || t === 1) return t;
    const c = (2 * Math.PI) / 3;
    return Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * c) + 1;
  },
  'ease-out-bounce': (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

export const EASING_NAMES = Object.keys(EasingFunctions) as EasingName[];

export interface KeyframeLike {
  time: number;
  properties: Record<string, number>;
  easing?: string;
  /**
   * 自定义贝塞尔缓动（CSS `cubic-bezier(x1,y1,x2,y2)` 的两个控制点）。
   *
   * 有它时**优先于** `easing` 名称——曲线编辑器拖出来的结果不能被名字覆盖掉。
   * x 必须在 [0,1]（时间轴单调，否则曲线会折返）；y 不限（允许过冲/回弹）。
   */
  bezier?: BezierHandles;
}

/** 三次贝塞尔的两个控制点（P0=(0,0)、P3=(1,1) 固定）。 */
export interface BezierHandles {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/** 常用预设（曲线编辑器的快捷按钮） */
export const BEZIER_PRESETS: Array<{ name: string; label: string; handles: BezierHandles }> = [
  { name: 'linear', label: '线性', handles: { x1: 0.33, y1: 0.33, x2: 0.67, y2: 0.67 } },
  { name: 'ease-in-out', label: '缓入缓出', handles: { x1: 0.42, y1: 0, x2: 0.58, y2: 1 } },
  { name: 'ease-out', label: '快出', handles: { x1: 0, y1: 0, x2: 0.58, y2: 1 } },
  { name: 'ease-in', label: '缓入', handles: { x1: 0.42, y1: 0, x2: 1, y2: 1 } },
  { name: 'snappy', label: '干脆', handles: { x1: 0.2, y1: 0, x2: 0.1, y2: 1 } },
  { name: 'overshoot', label: '过冲', handles: { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 } },
];

export const DEFAULT_BEZIER: BezierHandles = { x1: 0.33, y1: 0.33, x2: 0.67, y2: 0.67 };

/** 三次贝塞尔分量：P0=0、P3=1 → B(t) = 3(1-t)²t·p1 + 3(1-t)t²·p2 + t³ */
export function bezierComponent(t: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
}

/** 参数 t 处的导数（Newton 迭代用） */
function bezierSlope(t: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * p1 + 6 * mt * t * (p2 - p1) + 3 * t * t * (1 - p2);
}

/**
 * 求 CSS 意义下的缓动值：给定时间进度 x，返回曲线上的 y。
 *
 * 与浏览器 `cubic-bezier()` 同解：先由 x 反解参数 t（Newton + 二分兜底），
 * 再取 y。Newton 在控制点靠近端点时会失稳，因此每轮都夹到 [0,1] 并在导数过小时切二分。
 */
export function cubicBezierEase(x: number, handles: BezierHandles): number {
  const x1 = clamp01(handles.x1);
  const x2 = clamp01(handles.x2);
  const y1 = Number.isFinite(handles.y1) ? handles.y1 : 0;
  const y2 = Number.isFinite(handles.y2) ? handles.y2 : 1;
  if (x <= 0) return 0;
  if (x >= 1) return 1;

  let t = x;
  for (let i = 0; i < 8; i += 1) {
    const currentX = bezierComponent(t, x1, x2) - x;
    if (Math.abs(currentX) < 1e-6) return bezierComponent(t, y1, y2);
    const slope = bezierSlope(t, x1, x2);
    if (Math.abs(slope) < 1e-6) break;
    t = clamp01(t - currentX / slope);
  }
  // 二分兜底（单调保证有唯一解）
  let lo = 0;
  let hi = 1;
  t = x;
  for (let i = 0; i < 24; i += 1) {
    const currentX = bezierComponent(t, x1, x2);
    if (Math.abs(currentX - x) < 1e-6) break;
    if (currentX < x) lo = t; else hi = t;
    t = (lo + hi) / 2;
  }
  return bezierComponent(t, y1, y2);
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}

/**
 * 归一化贝塞尔控制点。
 *
 * 非法输入（缺字段/非数值）返回 null → 回退到 `easing` 名字；
 * x 夹到 [0,1]（时间必须单调），y 保持原值以允许过冲（`overshoot` 预设）。
 */
export function normalizeBezier(value: unknown): BezierHandles | null {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Partial<BezierHandles>;
  const numbers = [raw.x1, raw.y1, raw.x2, raw.y2];
  if (numbers.some((n) => typeof n !== 'number' || !Number.isFinite(n))) return null;
  return {
    x1: clamp01(raw.x1 as number),
    y1: raw.y1 as number,
    x2: clamp01(raw.x2 as number),
    y2: raw.y2 as number,
  };
}

/** 采样曲线（曲线编辑器画图用）：返回 [x,y] 点列 */
export function sampleBezier(handles: BezierHandles, samples = 32): Array<[number, number]> {
  const points: Array<[number, number]> = [];
  for (let i = 0; i <= samples; i += 1) {
    const x = i / samples;
    points.push([x, cubicBezierEase(x, handles)]);
  }
  return points;
}

/** 转成 CSS 字符串（写进 `transition-timing-function` 或展示） */
export function bezierToCss(handles: BezierHandles): string {
  return `cubic-bezier(${handles.x1}, ${handles.y1}, ${handles.x2}, ${handles.y2})`;
}

/**
 * Interpolate keyframe properties at a given progress (0-1).
 * Uses binary search to find the surrounding keyframes, then applies the
 * segment's easing function per-property.
 */
export function interpolateProperties(
  keyframes: KeyframeLike[],
  progress: number,
  defaultEasing: EasingName = 'linear',
): Record<string, number> {
  if (keyframes.length === 0) return {};
  if (keyframes.length === 1) return { ...keyframes[0].properties };

  const sorted = [...keyframes].sort((a, b) => a.time - b.time);
  if (progress <= sorted[0].time) return { ...sorted[0].properties };
  if (progress >= sorted[sorted.length - 1].time) return { ...sorted[sorted.length - 1].properties };

  let lo = 0, hi = sorted.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid].time <= progress) lo = mid; else hi = mid;
  }

  const prev = sorted[lo];
  const next = sorted[hi];
  const segDur = next.time - prev.time;
  const localT = segDur > 0 ? (progress - prev.time) / segDur : 0;
  // 自定义贝塞尔优先于名字：曲线编辑器的结果不该被 easing 名覆盖
  const handles = normalizeBezier(next.bezier);
  const easingName = (next.easing as EasingName) || defaultEasing;
  const easedT = handles
    ? cubicBezierEase(localT, handles)
    : (EasingFunctions[easingName] ?? EasingFunctions.linear)(localT);

  const result: Record<string, number> = {};
  const allProps = new Set([
    ...Object.keys(prev.properties),
    ...Object.keys(next.properties),
  ]);
  for (const prop of allProps) {
    const a = prev.properties[prop] ?? next.properties[prop] ?? 0;
    const b = next.properties[prop] ?? prev.properties[prop] ?? 0;
    result[prop] = a + (b - a) * easedT;
  }
  return result;
}
