/**
 * 导出预设的容器表达（B12）。
 *
 * 单独成模块：页面文件被 router 的 lazyPage 懒加载，只允许导出组件。
 */

/** 导出预设的展示与编码参数（页面与插件 payload 共用形状）。 */
export interface ExportPresetDef {
  name: string;
  width: number;
  height: number;
  fps: number;
  bitrate: string;
  icon?: string;
  /** B12：容器扩展名（插件 export_preset 的 payload.container 或后端预设同名键） */
  container?: string;
  /** 兼容写法：部分来源用 ext 表达容器 */
  ext?: string;
}

/**
 * B12：决定导出文件名扩展名。
 *
 * 优先级：预设显式声明的容器 > 按编码推断（ProRes 装不进 MP4） > 默认 mp4。
 * 非法声明（非 2-5 位字母数字）忽略并回退推断。
 */
export function resolveContainerExt(presetId: string, presetDef?: ExportPresetDef): string {
  const declared = String(presetDef?.container ?? presetDef?.ext ?? '')
    .replace(/^\./, '')
    .toLowerCase();
  if (/^[a-z0-9]{2,5}$/.test(declared)) return declared;
  return presetId === 'prores422hq' ? 'mov' : 'mp4';
}
