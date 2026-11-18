import { describe, expect, it } from 'vitest';
import { anchorCss, safeImageSrc, transformCss } from './mgLayout';
import { buildOverlayPlan } from './mgDomPlan';

describe('MG CSS layout', () => {
  it('maps center anchors and transform order', () => {
    const a = anchorCss({ type: 'text', x: 'center', y: 'center' } as never, 1920, 1080);
    expect(a.style.left).toBe('50%');
    expect(a.style.transform).toContain('translateX(-50%)');
    const t = transformCss({ perspective: 800, translate_z: 20, rotate_x: 12, scale: 1.1 });
    expect(t.indexOf('perspective')).toBeLessThan(t.indexOf('translateZ'));
    expect(t.indexOf('translateZ')).toBeLessThan(t.indexOf('rotateX'));
  });
  it('rejects external/unsafe images', () => {
    expect(safeImageSrc('https://x/a.png')).toBeNull();
    expect(safeImageSrc('blob:abc')).toBe('blob:abc');
  });
  it('builds keyframe plan with 3D approx and text', () => {
    const plan = buildOverlayPlan({
      width: 1920, height: 1080, duration_sec: 2,
      elements: [{ type: 'text', content: '测试', x: 100, y: 100, font_size: 48,
        keyframes: [
          { time: 0, opacity: 0, rotate_x: 10, translate_z: 20 },
          { time: 2, opacity: 1, rotate_x: 0, translate_z: 0 },
        ] }],
    }, {}, { width: 1920, height: 1080, fps: 30 });
    expect(plan.elements).toHaveLength(1);
    expect(plan.elements[0].text).toBe('测试');
    expect(plan.elements[0].tag).toBe('div');
    expect(plan.elements[0].fidelity.approx).toContain('3d:css3d');
  });
});
