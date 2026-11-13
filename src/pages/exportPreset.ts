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

/** C4：容器白名单（插件 export_preset 的 payload.container 只接受这些值）。 */
export const PLUGIN_EXPORT_CONTAINERS: readonly string[] = [
  'mp4', 'mov', 'mkv', 'webm', 'avi', 'm4v', 'ts', 'mpg', 'mpeg', 'flv', 'wmv', 'gif',
];

/** C4：插件 export_preset 的 payload 数值/字符串校验结果（非法字段忽略，不混入预设）。 */
export interface SanitizedPluginPreset {
  name: string;
  width: number;
  height: number;
  fps: number;
  bitrate: string;
  icon: string;
  container?: string;
}

/**
 * C4：校验插件贡献的导出预设 payload，返回可直接合入预设表的安全值；
 * 非法预设（宽高不是正整数）返回 null（整条忽略）。
 *
 * - width/height：必须是正整数（有限、>0、无小数），否则整条忽略；
 * - fps：必须是有限正数，非法回退 30；
 * - bitrate：必须是字符串，非法回退 '6M'；
 * - container：必须在白名单内（大小写不敏感、去前导点），否则忽略该字段；
 * - name/icon：非字符串时回落到贡献的 title/id 与默认图标。
 *
 * 纯函数，便于单测；不引入任何 UI。
 */
export function sanitizePluginPreset(
  payload: unknown,
  fallback: { id: string; title?: string; icon?: string } ,
): SanitizedPluginPreset | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const width = p.width;
  const height = p.height;
  const isPositiveInt = (v: unknown): v is number =>
    typeof v === 'number' && Number.isInteger(v) && Number.isFinite(v) && v > 0;
  if (!isPositiveInt(width) || !isPositiveInt(height)) return null;

  const fpsRaw = p.fps;
  const fps = typeof fpsRaw === 'number' && Number.isFinite(fpsRaw) && fpsRaw > 0 ? fpsRaw : 30;
  const bitrate = typeof p.bitrate === 'string' && p.bitrate.trim() ? p.bitrate : '6M';
  const name = typeof p.name === 'string' && p.name.trim()
    ? p.name
    : (typeof fallback.title === 'string' && fallback.title.trim() ? fallback.title : fallback.id);
  const icon = typeof fallback.icon === 'string' && fallback.icon ? fallback.icon : '🧩';

  let container: string | undefined;
  const rawContainer = typeof p.container === 'string' ? p.container : typeof p.ext === 'string' ? p.ext : '';
  const normalized = rawContainer.replace(/^\./, '').toLowerCase();
  if ((PLUGIN_EXPORT_CONTAINERS as readonly string[]).includes(normalized)) container = normalized;

  return { name, width, height, fps, bitrate, icon, ...(container ? { container } : {}) };
}
