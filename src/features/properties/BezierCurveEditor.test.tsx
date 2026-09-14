// @vitest-environment jsdom
/**
 * 关键帧缓动曲线编辑器（O-曲线编辑）。
 *
 * 覆盖：初始渲染（曲线 + 两个控制点 + 预设按钮 + 中点读数）、预设点击写入、
 * 拖拽控制点写回、拖拽中不写历史（由调用方 commit 决定）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { BezierCurveEditor } from './BezierCurveEditor';
import { DEFAULT_BEZIER, cubicBezierEase } from '@/features/timeline/engine/easing';

afterEach(cleanup);

describe('BezierCurveEditor', () => {
  it('渲染曲线、两个控制点与预设按钮', () => {
    render(<BezierCurveEditor value={DEFAULT_BEZIER} onChange={() => {}} />);
    expect(screen.getByTestId('bezier-editor')).toBeTruthy();
    expect(screen.getByTestId('bezier-canvas')).toBeTruthy();
    expect(screen.getByTestId('bezier-handle-p1')).toBeTruthy();
    expect(screen.getByTestId('bezier-handle-p2')).toBeTruthy();
    for (const name of ['linear', 'ease-in-out', 'ease-in', 'ease-out', 'snappy', 'overshoot']) {
      expect(screen.getByTestId(`bezier-preset-${name}`)).toBeTruthy();
    }
  });

  it('缺省值回退到默认控制点', () => {
    render(<BezierCurveEditor onChange={() => {}} />);
    // 明显是 linear 预设附近的曲线：中点读数接近 50%
    expect(screen.getByText(/中点进度 50%/)).toBeTruthy();
  });

  it('显示 CSS 表达式与区段标签', () => {
    render(
      <BezierCurveEditor
        value={{ x1: 0, y1: 0, x2: 0.58, y2: 1 }}
        segmentLabel="1.00s → 3.50s"
        onChange={() => {}}
      />,
    );
    expect(screen.getByText('cubic-bezier(0, 0, 0.58, 1)')).toBeTruthy();
    expect(screen.getByText(/1\.00s → 3\.50s/)).toBeTruthy();
    // ease-out 在中点已走过约 68%（线性为 50%）
    expect(screen.getByText(/中点进度 68%/)).toBeTruthy();
  });

  it('点预设按钮回写控制点（onPreset 优先）', () => {
    const onPreset = vi.fn();
    render(<BezierCurveEditor value={DEFAULT_BEZIER} onChange={() => {}} onPreset={onPreset} />);
    fireEvent.click(screen.getByTestId('bezier-preset-overshoot'));
    expect(onPreset).toHaveBeenCalledWith({ x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 });
  });

  it('没有 onPreset 时预设走 onChange', () => {
    const onChange = vi.fn();
    render(<BezierCurveEditor value={DEFAULT_BEZIER} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('bezier-preset-ease-in'));
    expect(onChange).toHaveBeenCalledWith({ x1: 0.42, y1: 0, x2: 1, y2: 1 });
  });

  it('拖拽控制点实时回写（pointerMove 时值变化）', () => {
    const onChange = vi.fn();
    render(<BezierCurveEditor value={{ x1: 0.42, y1: 0, x2: 0.58, y2: 1 }} onChange={onChange} />);
    const handle = screen.getByTestId('bezier-handle-p1');
    const svg = screen.getByTestId('bezier-canvas') as unknown as SVGSVGElement;

    // jsdom 没有布局：手工给出画布矩形
    svg.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 132, height: 132, right: 132, bottom: 132, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;

    fireEvent.pointerDown(handle, { pointerId: 1 });
    fireEvent.pointerMove(svg, { clientX: 40, clientY: 100, pointerId: 1 });

    expect(onChange).toHaveBeenCalled();
    const next = onChange.mock.calls[0][0];
    // x 是时间方向：落在画布左侧 → 更小的 x1
    expect(next.x1).toBeLessThan(0.42);
    // y 越大越靠上（画布 y 越小）→ 向下拖得到更小的 y
    expect(next.y1).toBeLessThan(0);
    // p2 不受影响
    expect(next.x2).toBe(0.58);
  });

  it('未按下时移动指针不会回写', () => {
    const onChange = vi.fn();
    render(<BezierCurveEditor value={DEFAULT_BEZIER} onChange={onChange} />);
    const svg = screen.getByTestId('bezier-canvas');
    fireEvent.pointerMove(svg, { clientX: 40, clientY: 100, pointerId: 1 });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('拖拽后抬起指针停止回写', () => {
    const onChange = vi.fn();
    render(<BezierCurveEditor value={DEFAULT_BEZIER} onChange={onChange} />);
    const svg = screen.getByTestId('bezier-canvas') as unknown as SVGSVGElement;
    svg.getBoundingClientRect = () => ({
      left: 0, top: 0, width: 132, height: 132, right: 132, bottom: 132, x: 0, y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
    fireEvent.pointerDown(screen.getByTestId('bezier-handle-p2'), { pointerId: 2 });
    fireEvent.pointerMove(svg, { clientX: 60, clientY: 60, pointerId: 2 });
    const callsAfterDrag = onChange.mock.calls.length;
    fireEvent.pointerUp(svg, { pointerId: 2 });
    fireEvent.pointerMove(svg, { clientX: 80, clientY: 80, pointerId: 2 });
    expect(onChange.mock.calls.length).toBe(callsAfterDrag);
  });

  it('过冲预设的曲线确实越出 0-1（视觉与求解一致）', () => {
    const overshoot = { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1 };
    const ys = Array.from({ length: 21 }, (_, i) => cubicBezierEase(i / 20, overshoot));
    expect(Math.max(...ys)).toBeGreaterThan(1);
    render(<BezierCurveEditor value={overshoot} onChange={() => {}} />);
    // 中点读数超过 100%（曲线在 0-1 之上）
    expect(screen.getByText(/中点进度 1[0-9][0-9]%/)).toBeTruthy();
  });
});
