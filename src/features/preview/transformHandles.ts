/**
 * 预览画布变换手柄（O-变换手柄）——纯几何/数学，便于单测。
 *
 * 交互语义（与常见剪辑器一致）：
 * - 拖**元素本体** → 平移（`metadata.transform.x/y`，按画幅归一化）；
 * - 拖**四角/四边手柄** → 缩放（本项目的变换模型只有统一 `scale`，
 *   因此边手柄也按主轴计算统一缩放，拖角更直观）；
 * - 拖**旋转手柄** → 旋转（按住 Shift 吸附到 15°）；
 * - 拖拽时吸附到**画面中心 / 四边齐平 / 三分线**，并返回参考线供绘制。
 *
 * 坐标系：`transform.x/y` 是**相对画面中心的归一化偏移**（与 `drawCover` 一致），
 * `scale` 是统一缩放，`rotation` 为度。手柄位置在画布像素坐标系里计算。
 */

/**
 * 变换（与 `PreviewPanel` 的 `Transform2D` 同构）。
 *
 * 这里**重复声明**而不是从 PreviewPanel 导入：`transformHandles` 是纯几何模块，
 * 若反向依赖渲染组件，单测会连带拉进整棵组件依赖树（canvas、媒体、store）。
 * 结构完全一致，赋值处无需转换。
 */
export interface Transform2D {
  /** 相对画面中心的归一化偏移 */
  x: number;
  y: number;
  /** 统一缩放 */
  scale: number;
  /** 旋转（度） */
  rotation: number;
}

export interface HandleFrameRect {
  fx: number;
  fy: number;
  fw: number;
  fh: number;
}

export type HandleAnchor = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';
export type DragKind = 'move' | 'resize' | 'rotate';

export interface HandleLayout {
  /** 元素（经变换后）的四角，顺序 nw→ne→se→sw */
  corners: Array<[number, number]>;
  /** 手柄中心点（像素） */
  handles: Array<{ anchor: HandleAnchor; x: number; y: number }>;
  /** 元素中心（像素） */
  center: [number, number];
  /** 元素四边（未旋转矩形，用于命中判定与绘制辅助线） */
  rect: { left: number; top: number; width: number; height: number };
}

export interface SnapGuide {
  axis: 'v' | 'h';
  /** 画布坐标（像素） */
  at: number;
  label: string;
}

export interface SnapOutcome {
  transform: Transform2D;
  guides: SnapGuide[];
}

export const HANDLE_RADIUS = 5;
export const HANDLE_HIT_RADIUS = 11;
export const ROTATE_OFFSET = 26;
/** 吸附阈值（像素） */
export const SNAP_THRESHOLD_PX = 8;

/**
 * 绕 (cx,cy) 旋转一点。
 *
 * 方向约定与 canvas `ctx.rotate(θ)` **完全一致**（canvas 规范：正值顺时针）：
 * 在 y 轴向下的坐标系里套标准旋转矩阵 [[cos,-sin],[sin,cos]]，
 * 视觉上即顺时针——左上角会转到右上角。手柄必须与画面里的元素同步转动，
 * 否则"手柄在左上、元素转到右上"的错位会让拖拽手感完全错乱。
 */
function rotatePoint(x: number, y: number, cx: number, cy: number, rad: number): [number, number] {
  const dx = x - cx;
  const dy = y - cy;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return [cx + dx * cos - dy * sin, cy + dx * sin + dy * cos];
}

/** 元素矩形（画布像素）——变换后的位置与尺寸，未旋转 */
export function elementRect(frame: HandleFrameRect, tf: Transform2D) {
  const scale = Math.max(0.05, Math.abs(tf.scale || 1));
  const width = frame.fw * scale;
  const height = frame.fh * scale;
  const cx = frame.fx + frame.fw / 2 + (tf.x || 0) * frame.fw;
  const cy = frame.fy + frame.fh / 2 + (tf.y || 0) * frame.fh;
  return { cx, cy, width, height, left: cx - width / 2, top: cy - height / 2 };
}

/** 手柄布局（含旋转后的角点位置） */
export function transformHandleLayout(frame: HandleFrameRect, tf: Transform2D): HandleLayout {
  const rect = elementRect(frame, tf);
  const rad = ((tf.rotation || 0) * Math.PI) / 180;
  const cornersUnrotated: Array<[number, number]> = [
    [rect.left, rect.top],
    [rect.left + rect.width, rect.top],
    [rect.left + rect.width, rect.top + rect.height],
    [rect.left, rect.top + rect.height],
  ];
  const corners = cornersUnrotated.map(([x, y]) => rotatePoint(x, y, rect.cx, rect.cy, rad));

  const mid = (a: [number, number], b: [number, number]): [number, number] =>
    [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

  const handles: HandleLayout['handles'] = [
    { anchor: 'nw', x: corners[0][0], y: corners[0][1] },
    { anchor: 'n', x: mid(corners[0], corners[1])[0], y: mid(corners[0], corners[1])[1] },
    { anchor: 'ne', x: corners[1][0], y: corners[1][1] },
    { anchor: 'e', x: mid(corners[1], corners[2])[0], y: mid(corners[1], corners[2])[1] },
    { anchor: 'se', x: corners[2][0], y: corners[2][1] },
    { anchor: 's', x: mid(corners[2], corners[3])[0], y: mid(corners[2], corners[3])[1] },
    { anchor: 'sw', x: corners[3][0], y: corners[3][1] },
    { anchor: 'w', x: mid(corners[3], corners[0])[0], y: mid(corners[3], corners[0])[1] },
  ];

  // 旋转手柄：从上边中点沿"元素向上方向"外移（随旋转一起动）
  const topMid = mid(corners[0], corners[1]);
  const [rx, ry] = rotatePoint(topMid[0], topMid[1] - ROTATE_OFFSET, rect.cx, rect.cy, rad);
  handles.push({ anchor: 'rotate', x: rx, y: ry });

  return {
    corners,
    handles,
    center: [rect.cx, rect.cy],
    rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
  };
}

/** 手柄命中（先手柄后本体；未命中返回 null） */
export function hitTestTransform(
  px: number,
  py: number,
  layout: HandleLayout,
): { kind: DragKind; anchor: HandleAnchor | null } | null {
  for (const handle of layout.handles) {
    const dist = Math.hypot(px - handle.x, py - handle.y);
    if (dist <= HANDLE_HIT_RADIUS) {
      return { kind: handle.anchor === 'rotate' ? 'rotate' : 'resize', anchor: handle.anchor };
    }
  }
  const inside = px >= layout.rect.left - HANDLE_RADIUS && px <= layout.rect.left + layout.rect.width + HANDLE_RADIUS
    && py >= layout.rect.top - HANDLE_RADIUS && py <= layout.rect.top + layout.rect.height + HANDLE_RADIUS;
  return inside ? { kind: 'move', anchor: null } : null;
}

export interface DragContext {
  kind: DragKind;
  anchor: HandleAnchor | null;
  /** 拖拽开始时的手柄中心（像素）与元素中心（像素） */
  startPointer: [number, number];
  startTransform: Transform2D;
  frame: HandleFrameRect;
  /** Shift：旋转吸附 15°、缩放保持宽高比（本项目统一缩放，天然保持） */
  shiftKey?: boolean;
}

/**
 * 应用一次拖拽位移，返回新的变换 + 吸附参考线。
 *
 * 平移：像素位移 ÷ 画幅尺寸 → 归一化偏移（可直接写 `metadata.transform.x/y`）。
 * 缩放：按"到元素中心的距离比"计算（起点距离为 0 时忽略，避免除零）。
 * 旋转：按"相对元素中心的角度差"计算；Shift 吸附 15°。
 */
export function applyTransformDrag(ctx: DragContext, px: number, py: number): SnapOutcome {
  const { frame, startTransform } = ctx;
  const layout = transformHandleLayout(frame, startTransform);
  const [cx, cy] = layout.center;
  const next: Transform2D = { ...startTransform };

  if (ctx.kind === 'move') {
    next.x = (startTransform.x || 0) + (px - ctx.startPointer[0]) / frame.fw;
    next.y = (startTransform.y || 0) + (py - ctx.startPointer[1]) / frame.fh;
    return snapTransform(next, frame, { pointer: [px, py], shiftKey: ctx.shiftKey });
  }

  if (ctx.kind === 'rotate') {
    const startAngle = Math.atan2(ctx.startPointer[1] - cy, ctx.startPointer[0] - cx);
    const nowAngle = Math.atan2(py - cy, px - cx);
    let deg = (startTransform.rotation || 0) + ((nowAngle - startAngle) * 180) / Math.PI;
    if (ctx.shiftKey) deg = Math.round(deg / 15) * 15;
    next.rotation = Math.round(deg * 100) / 100;
    return { transform: next, guides: [] };
  }

  // resize：距离比 → 统一缩放
  const startDist = Math.hypot(ctx.startPointer[0] - cx, ctx.startPointer[1] - cy);
  const nowDist = Math.hypot(px - cx, py - cy);
  if (startDist > 1) {
    const ratio = nowDist / startDist;
    next.scale = Math.max(0.05, Math.min(8, Math.abs((startTransform.scale || 1) * ratio)));
  }
  // 缩放后仍按元素中心对齐（不改变 x/y），符合"绕中心缩放"的手感
  return snapTransform(next, frame, { pointer: [px, py], shiftKey: ctx.shiftKey });
}

export interface SnapOptions {
  pointer?: [number, number];
  /** 吸附阈值（像素，默认 SNAP_THRESHOLD_PX） */
  thresholdPx?: number;
  shiftKey?: boolean;
  /** 是否吸附三分线（默认 true） */
  thirds?: boolean;
}

/**
 * 变换吸附：元素中心吸到画面中心 / 三分线，元素边缘吸到画面四边。
 *
 * 返回吸附后的变换与命中的参考线（参考线用画布像素坐标，直接可画）。
 */
export function snapTransform(
  tf: Transform2D,
  frame: HandleFrameRect,
  options: SnapOptions = {},
): SnapOutcome {
  const threshold = options.thresholdPx ?? SNAP_THRESHOLD_PX;
  const scale = Math.max(0.05, Math.abs(tf.scale || 1));
  const next: Transform2D = { ...tf };
  const guides: SnapGuide[] = [];

  const xTol = threshold / frame.fw;
  const yTol = threshold / frame.fh;
  const xCandidates: Array<{ value: number; label: string; guide: number }> = [
    { value: 0, label: '画面中心', guide: frame.fx + frame.fw / 2 },
    { value: (scale - 1) / 2, label: '左边缘', guide: frame.fx },
    { value: (1 - scale) / 2, label: '右边缘', guide: frame.fx + frame.fw },
  ];
  if (options.thirds !== false) {
    xCandidates.push(
      { value: -1 / 6, label: '左三分线', guide: frame.fx + frame.fw / 3 },
      { value: 1 / 6, label: '右三分线', guide: frame.fx + (frame.fw * 2) / 3 },
    );
  }
  const yCandidates: Array<{ value: number; label: string; guide: number }> = [
    { value: 0, label: '画面中心', guide: frame.fy + frame.fh / 2 },
    { value: (scale - 1) / 2, label: '顶边', guide: frame.fy },
    { value: (1 - scale) / 2, label: '底边', guide: frame.fy + frame.fh },
  ];

  let bestX: { value: number; label: string; guide: number; dist: number } | null = null;
  for (const candidate of xCandidates) {
    const dist = Math.abs((next.x || 0) - candidate.value);
    if (dist <= xTol && (!bestX || dist < bestX.dist)) bestX = { ...candidate, dist };
  }
  if (bestX) {
    next.x = bestX.value;
    guides.push({ axis: 'v', at: bestX.guide, label: bestX.label });
  }

  let bestY: { value: number; label: string; guide: number; dist: number } | null = null;
  for (const candidate of yCandidates) {
    const dist = Math.abs((next.y || 0) - candidate.value);
    if (dist <= yTol && (!bestY || dist < bestY.dist)) bestY = { ...candidate, dist };
  }
  if (bestY) {
    next.y = bestY.value;
    guides.push({ axis: 'h', at: bestY.guide, label: bestY.label });
  }

  return { transform: next, guides };
}
