import { describe, it, expect } from 'vitest';
import { sanitizePluginPreset } from './exportPreset';

/**
 * C4 导出预设消毒：非法数值**拒绝该预设**（null），可选字段按契约回落，
 * 不把插件给的任意值直接送进渲染参数。
 */
describe('sanitizePluginPreset（C4 导出预设校验）', () => {
  const ok = { width: 1080, height: 1920, fps: 30, bitrate: 'cq26', icon: 'x' };
  const fallback = { id: 'plugin_preset', title: '插件预设', icon: '🎬' };

  it('合法预设保留宽高与码率', () => {
    const out = sanitizePluginPreset(ok, fallback);
    expect(out).toMatchObject({ width: 1080, height: 1920, fps: 30, bitrate: 'cq26' });
    expect(out?.name).toBe('插件预设');
    expect(out?.icon).toBe('🎬');
  });

  it('拒绝非正整数宽高', () => {
    expect(sanitizePluginPreset({ ...ok, width: 0 }, fallback)).toBeNull();
    expect(sanitizePluginPreset({ ...ok, width: -2 }, fallback)).toBeNull();
    expect(sanitizePluginPreset({ ...ok, width: 10.5 }, fallback)).toBeNull();
    expect(sanitizePluginPreset({ ...ok, height: Number.NaN }, fallback)).toBeNull();
  });

  it('非法 fps/bitrate 按契约回落，而不是把坏值透传', () => {
    const out = sanitizePluginPreset({ ...ok, fps: Number.NaN, bitrate: 5000 }, fallback);
    expect(out?.fps).toBe(30);
    expect(out?.bitrate).toBe('6M');
  });

  it('容器非白名单时忽略该字段（不报错、不透传）', () => {
    const out = sanitizePluginPreset({ ...ok, container: 'exe' }, fallback);
    expect(out).not.toBeNull();
    expect(out?.container).toBeUndefined();
  });

  it('缺字段或非对象一律拒绝（不猜默认尺寸）', () => {
    expect(sanitizePluginPreset(null, fallback)).toBeNull();
    expect(sanitizePluginPreset({ width: 1080 }, fallback)).toBeNull();
    expect(sanitizePluginPreset([], fallback)).toBeNull();
  });
});
