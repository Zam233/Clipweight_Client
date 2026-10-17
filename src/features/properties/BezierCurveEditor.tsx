import { useCallback, useMemo, useRef, useState } from 'react';
import {
  BEZIER_PRESETS, bezierToCss, cubicBezierEase, DEFAULT_BEZIER,
  normalizeBezier, sampleBezier, type BezierHandles,
} from '@/features/timeline/engine/easing';

interface BezierCurveEditorProps {
  /** 当前控制点（缺省用默认 ease-in-out 附近的值） */
  value?: BezierHandles | null;
  /** 拖拽/选预设后回调（实时，调用方自行防抖写历史） */
  onChange: (handles: BezierHandles) => void;
  /** 快速预设按钮 */
  onPreset?: (handles: BezierHandles) => void;
  /** 当前关键帧所属区段名（展示用，如 "0.25s → 0.60s"） */
  segmentLabel?: string;
  size?: number;
}

const SIZE = 132;
const PAD = 14;

/**
 * 关键帧缓动曲线编辑器（O-曲线编辑）。
 *
 * 拖两个控制点调整 `cubic-bezier(x1,y1,x2,y2)`；曲线与预览用**同一个求解器**
 * （`cubicBezierEase`），所以这里看到的形状就是动画真正走的形状。
 * x 方向夹在 [0,1]（时间必须单调），y 方向允许越出 0-1（过冲/回弹）。
 */
export function BezierCurveEditor({
  value, onChange, onPreset, segmentLabel, size = SIZE,
}: BezierCurveEditorProps) {
  const handles = normalizeBezier(value) ?? DEFAULT_BEZIER;
  const svgRef = useRef<SVGSVGElement>(null);
  const [dragging, setDragging] = useState<'p1' | 'p2' | null>(null);

  const toSvg = useCallback((x: number, y: number): [number, number] => {
    // 纵向留出过冲空间：y 的 [-0.4, 1.4] 映射到画布高度
    const inner = size - PAD * 2;
    const yMin = -0.4;
    const yMax = 1.4;
    return [PAD + x * inner, PAD + (1 - (y - yMin) / (yMax - yMin)) * inner];
  }, [size]);

  const fromSvg = useCallback((px: number, py: number): { x: number; y: number } => {
    const inner = size - PAD * 2;
    const yMin = -0.4;
    const yMax = 1.4;
    const x = (px - PAD) / inner;
    const y = yMin + (1 - (py - PAD) / inner) * (yMax - yMin);
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(yMax, Math.max(yMin, y)) };
  }, [size]);

  const curve = useMemo(() => {
    const pts = sampleBezier(handles, 40);
    return pts.map(([x, y], i) => {
      const [sx, sy] = toSvg(x, y);
      return `${i === 0 ? 'M' : 'L'}${sx.toFixed(2)},${sy.toFixed(2)}`;
    }).join(' ');
  }, [handles, toSvg]);

  const [p0x, p0y] = toSvg(0, 0);
  const [p3x, p3y] = toSvg(1, 1);
  const [p1x, p1y] = toSvg(handles.x1, handles.y1);
  const [p2x, p2y] = toSvg(handles.x2, handles.y2);

  const handlePointer = useCallback((which: 'p1' | 'p2') => (e: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const { x, y } = fromSvg(
      ((e.clientX - rect.left) / rect.width) * size,
      ((e.clientY - rect.top) / rect.height) * size,
    );
    const next: BezierHandles = { ...handles };
    if (which === 'p1') { next.x1 = x; next.y1 = y; } else { next.x2 = x; next.y2 = y; }
    onChange(next);
  }, [fromSvg, handles, onChange, size]);

  const midEase = cubicBezierEase(0.5, handles);

  return (
    <div className="space-y-1.5" data-testid="bezier-editor">
      <div className="flex items-center justify-between">
        <span className="text-caption text-on-surface-variant">
          缓动曲线{segmentLabel ? ` · ${segmentLabel}` : ''}
        </span>
        <span className="text-caption font-mono text-on-surface-variant/70">
          {bezierToCss(handles)}
        </span>
      </div>

      <svg
        ref={svgRef}
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="rounded-cw-sm bg-surface-container border border-outline-variant/30 touch-none select-none"
        data-testid="bezier-canvas"
        onPointerMove={(e) => { if (dragging) handlePointer(dragging)(e); }}
        onPointerUp={(e) => {
          if (dragging) { e.currentTarget.releasePointerCapture?.(e.pointerId); setDragging(null); }
        }}
        onPointerLeave={() => setDragging(null)}
      >
        {/* 单位框与 0.5 参考线 */}
        <rect x={PAD} y={PAD} width={size - PAD * 2} height={size - PAD * 2}
              fill="none" stroke="rgba(141,141,153,0.35)" strokeDasharray="3 3" />
        {[0.25, 0.5, 0.75].map((g) => {
          const [gx, gy] = toSvg(g, g);
          return (
            <g key={g}>
              <line x1={gx} y1={PAD} x2={gx} y2={size - PAD} stroke="rgba(141,141,153,0.12)" />
              <line x1={PAD} y1={gy} x2={size - PAD} y2={gy} stroke="rgba(141,141,153,0.12)" />
            </g>
          );
        })}
        {/* 控制线 */}
        <line x1={p0x} y1={p0y} x2={p1x} y2={p1y} stroke="#4F8CFF" strokeWidth="1" opacity="0.6" />
        <line x1={p3x} y1={p3y} x2={p2x} y2={p2y} stroke="#4F8CFF" strokeWidth="1" opacity="0.6" />
        {/* 曲线本体 */}
        <path d={curve} fill="none" stroke="#4F8CFF" strokeWidth="2" />
        {/* 端点 */}
        <circle cx={p0x} cy={p0y} r="3" fill="#8D8D99" />
        <circle cx={p3x} cy={p3y} r="3" fill="#8D8D99" />
        {/* 控制点（可拖） */}
        <circle
          cx={p1x} cy={p1y} r="6" fill="#4F8CFF" stroke="#0E101A" strokeWidth="1.5"
          className="cursor-grab"
          data-testid="bezier-handle-p1"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            setDragging('p1');
          }}
        />
        <circle
          cx={p2x} cy={p2y} r="6" fill="#34D399" stroke="#0E101A" strokeWidth="1.5"
          className="cursor-grab"
          data-testid="bezier-handle-p2"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture?.(e.pointerId);
            setDragging('p2');
          }}
        />
      </svg>

      <div className="flex flex-wrap gap-1">
        {BEZIER_PRESETS.map((preset) => (
          <button
            key={preset.name}
            type="button"
            onClick={() => (onPreset ?? onChange)({ ...preset.handles })}
            data-testid={`bezier-preset-${preset.name}`}
            className="px-1.5 py-0.5 text-caption rounded-cw-xs bg-surface-container text-on-surface-variant
              hover:text-primary border border-outline-variant/30 transition-colors cursor-pointer"
          >
            {preset.label}
          </button>
        ))}
      </div>
      <p className="text-caption text-on-surface-variant/60">
        中点进度 {Math.round(midEase * 100)}%（线性为 50%）；纵向可拖出 0-1 区间做过冲
      </p>
    </div>
  );
}
