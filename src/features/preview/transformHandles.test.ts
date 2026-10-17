// @vitest-environment jsdom
/**
 * 预览变换手柄纯几何测试（O-变换手柄）。
 *
 * 覆盖：布局（含旋转后的角点）、命中优先级（手柄 > 本体）、平移/缩放/旋转的数学、
 * 吸附到画面中心/边缘/三分线并产出参考线、Shift 旋转吸附 15°。
 */
import { describe, it, expect } from 'vitest';
import {
  applyTransformDrag, elementRect, hitTestTransform, snapTransform,
  transformHandleLayout, HANDLE_HIT_RADIUS, ROTATE_OFFSET,
  type DragContext, type Transform2D,
} from './transformHandles';

const FRAME = { fx: 100, fy: 50, fw: 800, fh: 450 };
const IDENTITY: Transform2D = { x: 0, y: 0, scale: 1, rotation: 0 };

describe('elementRect', () => {
  it('恒等变换 = 铺满画幅', () => {
    const rect = elementRect(FRAME, IDENTITY);
    expect(rect.left).toBeCloseTo(100);
    expect(rect.top).toBeCloseTo(50);
    expect(rect.width).toBeCloseTo(800);
    expect(rect.height).toBeCloseTo(450);
    expect(rect.cx).toBeCloseTo(500);
  });

  it('缩放绕中心、平移按归一化偏移', () => {
    const rect = elementRect(FRAME, { x: 0.25, y: -0.5, scale: 0.5, rotation: 0 });
    expect(rect.width).toBeCloseTo(400);
    expect(rect.cx).toBeCloseTo(500 + 0.25 * 800);   // 700
    expect(rect.cy).toBeCloseTo(275 - 0.5 * 450);    // 50
  });

  it('scale 非法值被夹到下限而不是画出负尺寸', () => {
    const rect = elementRect(FRAME, { x: 0, y: 0, scale: 0, rotation: 0 });
    expect(rect.width).toBeGreaterThan(0);
  });
});

describe('transformHandleLayout', () => {
  it('恒等变换下 8 个手柄在四角与四边中点', () => {
    const layout = transformHandleLayout(FRAME, IDENTITY);
    const byAnchor = Object.fromEntries(layout.handles.map((h) => [h.anchor, h]));
    expect(byAnchor.nw.x).toBeCloseTo(100);
    expect(byAnchor.nw.y).toBeCloseTo(50);
    expect(byAnchor.se.x).toBeCloseTo(900);
    expect(byAnchor.se.y).toBeCloseTo(500);
    expect(byAnchor.n.x).toBeCloseTo(500);
    expect(byAnchor.e.y).toBeCloseTo(275);
    expect(layout.handles).toHaveLength(9);   // 8 + 旋转
  });

  it('旋转手柄在顶边中点上方的元素坐标系里（随旋转一起转）', () => {
    const layout = transformHandleLayout(FRAME, IDENTITY);
    const rotate = layout.handles.find((h) => h.anchor === 'rotate')!;
    expect(rotate.y).toBeCloseTo(50 - ROTATE_OFFSET);

    const rotated = transformHandleLayout(FRAME, { ...IDENTITY, rotation: 90 });
    const rotatedHandle = rotated.handles.find((h) => h.anchor === 'rotate')!;
    // 旋转 90° 后，原本"上方"的手柄跑到右侧
    expect(rotatedHandle.x).toBeGreaterThan(rotated.center[0]);
  });

  it('旋转 90° 后左上角跑到"右上"（与 canvas ctx.rotate 同为顺时针）', () => {
    const layout = transformHandleLayout(FRAME, { x: 0, y: 0, scale: 0.5, rotation: 90 });
    const nw = layout.corners[0];
    expect(nw[0]).toBeGreaterThan(layout.center[0]);
    expect(nw[1]).toBeLessThan(layout.center[1]);
  });
});

describe('hitTestTransform', () => {
  const layout = transformHandleLayout(FRAME, IDENTITY);

  it('命中角点 → resize（带 anchor）', () => {
    const hit = hitTestTransform(100, 50, layout);
    expect(hit).toEqual({ kind: 'resize', anchor: 'nw' });
  });

  it('命中旋转手柄 → rotate', () => {
    const hit = hitTestTransform(500, 50 - ROTATE_OFFSET, layout);
    expect(hit).toEqual({ kind: 'rotate', anchor: 'rotate' });
  });

  it('命中本体内部 → move', () => {
    const hit = hitTestTransform(500, 275, layout);
    expect(hit).toEqual({ kind: 'move', anchor: null });
  });

  it('本体外（远离）→ null', () => {
    expect(hitTestTransform(20, 20, layout)).toBeNull();
  });

  it('手柄优先于本体（角点附近不会退化成 move）', () => {
    const hit = hitTestTransform(100 + HANDLE_HIT_RADIUS - 1, 50, layout);
    expect(hit?.kind).toBe('resize');
  });
});

function drag(kind: DragContext['kind'], anchor: DragContext['anchor'], at: [number, number], tf = IDENTITY): DragContext {
  return { kind, anchor, startPointer: at, startTransform: tf, frame: FRAME };
}

describe('applyTransformDrag · 平移', () => {
  it('像素位移换算成归一化偏移', () => {
    const out = applyTransformDrag(drag('move', null, [400, 200]), 400 + 80, 200 + 45);
    // 80/800 = 0.1；45/450 = 0.1（且被吸附到三分线附近？1/10 不在阈值内）
    expect(out.transform.x).toBeCloseTo(0.1, 3);
    expect(out.transform.y).toBeCloseTo(0.1, 3);
  });

  it('靠近画面中心时吸附并给出参考线', () => {
    const out = applyTransformDrag(drag('move', null, [400, 200]), 400 + 3, 200 + 2);
    expect(out.transform.x).toBe(0);
    expect(out.transform.y).toBe(0);
    const axes = out.guides.map((g) => g.axis).sort();
    expect(axes).toEqual(['h', 'v']);
    expect(out.guides[0].label).toContain('中心');
  });
});

describe('applyTransformDrag · 缩放', () => {
  it('以元素中心为基准按距离比例缩放', () => {
    const center = [500, 275] as [number, number];
    // 从离中心 100px 拖到 200px → 缩放到 2 倍
    const out = applyTransformDrag(drag('resize', 'se', [center[0] + 100, center[1]]), center[0] + 200, center[1]);
    expect(out.transform.scale).toBeCloseTo(2, 2);
  });

  it('缩放下限与上限被夹住', () => {
    const center = [500, 275] as [number, number];
    const shrink = applyTransformDrag(drag('resize', 'se', [center[0] + 300, center[1]]), center[0] + 1, center[1]);
    expect(shrink.transform.scale).toBeGreaterThanOrEqual(0.05);
    const grow = applyTransformDrag(drag('resize', 'se', [center[0] + 10, center[1]]), center[0] + 4000, center[1]);
    expect(grow.transform.scale).toBeLessThanOrEqual(8);
  });

  it('起点距中心过近时不缩放（避免除零放大）', () => {
    const out = applyTransformDrag(drag('resize', 'se', [500, 275]), 900, 500);
    expect(out.transform.scale).toBeCloseTo(1, 6);
  });

  it('缩放不改变平移量（绕中心缩放）', () => {
    const tf: Transform2D = { x: 0.2, y: -0.1, scale: 1, rotation: 0 };
    const center = elementRect(FRAME, tf);
    const out = applyTransformDrag(drag('resize', 'se', [center.cx + 120, center.cy], tf), center.cx + 240, center.cy);
    expect(out.transform.x).toBeCloseTo(0.2, 6);
    expect(out.transform.y).toBeCloseTo(-0.1, 6);
    expect(out.transform.scale).toBeGreaterThan(1);
  });
});

describe('applyTransformDrag · 旋转', () => {
  it('按相对中心的角度差旋转', () => {
    // 起点在中心正右方，拖到中心正下方 → +90°
    const out = applyTransformDrag(drag('rotate', 'rotate', [600, 275]), 500, 375);
    expect(out.transform.rotation).toBeCloseTo(90, 1);
  });

  it('Shift 吸附到 15° 整数倍', () => {
    const ctx = { ...drag('rotate', 'rotate', [600, 275]), shiftKey: true };
    const out = applyTransformDrag(ctx, 500 + 100 * Math.cos(0.55), 275 + 100 * Math.sin(0.55));
    // 0.55rad ≈ 31.5° → 吸附 30°
    expect(out.transform.rotation % 15).toBeCloseTo(0, 6);
    expect(out.transform.rotation).toBe(30);
  });

  it('旋转不做吸附、不产出参考线', () => {
    const out = applyTransformDrag(drag('rotate', 'rotate', [600, 275]), 500, 375);
    expect(out.guides).toHaveLength(0);
  });
});

describe('snapTransform', () => {
  it('元素边缘齐平画面四边', () => {
    const scale = 0.5;
    const left = snapTransform({ x: (scale - 1) / 2 + 0.002, y: 0.4, scale, rotation: 0 }, FRAME);
    expect(left.transform.x).toBeCloseTo((scale - 1) / 2, 6);
    expect(left.guides.some((g) => g.label === '左边缘')).toBe(true);

    const right = snapTransform({ x: (1 - scale) / 2 - 0.002, y: 0.4, scale, rotation: 0 }, FRAME);
    expect(right.transform.x).toBeCloseTo((1 - scale) / 2, 6);
  });

  it('三分线吸附（可关闭）', () => {
    const snapped = snapTransform({ x: 1 / 6 + 0.004, y: 0, scale: 1, rotation: 0 }, FRAME);
    expect(snapped.transform.x).toBeCloseTo(1 / 6, 6);
    expect(snapped.guides.some((g) => g.label.includes('三分线'))).toBe(true);

    const off = snapTransform({ x: 1 / 6 + 0.004, y: 0, scale: 1, rotation: 0 }, FRAME, { thirds: false });
    expect(off.transform.x).not.toBeCloseTo(1 / 6, 6);
  });

  it('参考线坐标是画布像素（可直接画）', () => {
    const out = snapTransform({ x: 0.001, y: 0, scale: 1, rotation: 0 }, FRAME);
    const vertical = out.guides.find((g) => g.axis === 'v')!;
    expect(vertical.at).toBeCloseTo(FRAME.fx + FRAME.fw / 2);
    const horizontal = out.guides.find((g) => g.axis === 'h')!;
    expect(horizontal.at).toBeCloseTo(FRAME.fy + FRAME.fh / 2);
  });

  it('阈值外不吸附、无参考线', () => {
    const out = snapTransform({ x: 0.2, y: 0.2, scale: 1, rotation: 0 }, FRAME);
    expect(out.guides).toHaveLength(0);
    expect(out.transform.x).toBe(0.2);
  });

  it('阈值可调（更小的阈值不吸附）', () => {
    const tf = { x: 0.004, y: 0, scale: 1, rotation: 0 };
    expect(snapTransform(tf, FRAME).transform.x).toBe(0);
    expect(snapTransform(tf, FRAME, { thresholdPx: 1 }).transform.x).toBeCloseTo(0.004, 6);
  });
});
