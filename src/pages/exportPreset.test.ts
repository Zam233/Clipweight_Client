/**
 * B12 测试：导出容器扩展名的解析优先级（预设声明 > 编码推断 > 默认）。
 */
import { describe, it, expect } from 'vitest';
import { resolveContainerExt, type ExportPresetDef } from './exportPreset';

const preset = (over: Partial<ExportPresetDef> = {}): ExportPresetDef => ({
  name: 'P', width: 1920, height: 1080, fps: 30, bitrate: '6M', ...over,
});

describe('B12 resolveContainerExt', () => {
  it('预设显式声明容器时以声明为准（插件 export_preset 能表达容器）', () => {
    expect(resolveContainerExt('plugin:my_master', preset({ container: 'mov' }))).toBe('mov');
    expect(resolveContainerExt('plugin:web', preset({ container: 'webm' }))).toBe('webm');
    expect(resolveContainerExt('plugin:mp4x', preset({ container: 'MP4' }))).toBe('mp4');
  });

  it('兼容 ext 写法并去掉前导点', () => {
    expect(resolveContainerExt('plugin:a', preset({ ext: '.mkv' }))).toBe('mkv');
  });

  it('未声明时按编码推断：ProRes → mov，其余 → mp4', () => {
    expect(resolveContainerExt('prores422hq', preset())).toBe('mov');
    expect(resolveContainerExt('h265_10bit', preset())).toBe('mp4');
    expect(resolveContainerExt('bilibili', preset())).toBe('mp4');
  });

  it('非法声明被忽略并回退推断（防目录穿越/怪扩展名）', () => {
    for (const bad of ['../../etc/passwd', 'm', 'a'.repeat(9), 'm p4', 'mp4/../mov', '中文']) {
      expect(resolveContainerExt('prores422hq', preset({ container: bad }))).toBe('mov');
      expect(resolveContainerExt('bilibili', preset({ container: bad }))).toBe('mp4');
    }
  });

  it('无预设定义时不抛异常', () => {
    expect(resolveContainerExt('bilibili')).toBe('mp4');
    expect(resolveContainerExt('prores422hq')).toBe('mov');
  });
});
