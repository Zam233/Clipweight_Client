/** MotionSpec 前端阶段开关；默认全部关闭，按发布计划逐阶段启用。 */
const env = import.meta.env as Record<string, string | undefined>;

export const textMotionFlags = {
  ui: env.VITE_TEXT_MOTION_SPEC_UI === '1' || import.meta.env.DEV,
  preview: env.VITE_TEXT_MOTION_SPEC_PREVIEW === '1',
  editor: env.VITE_TEXT_MOTION_SPEC_EDITOR === '1',
  /** 暂停态 CSS 3D 覆盖层（CP-3）；默认关，灰度验证后开 */
  overlay3d: env.VITE_TEXT_MOTION_OVERLAY_3D === '1' || import.meta.env.DEV,
  /** 服务端 Hyperframes 精确抽帧按钮（CP-5） */
  overlayServerFrame: env.VITE_TEXT_MOTION_SERVER_FRAME === '1' || import.meta.env.DEV,
  /** blur 半径标定表通过验收后才置 1（CP-1） */
  blurCalibrated: env.VITE_TEXT_MOTION_BLUR_CALIBRATED === '1',
} as const;

export function textMotionEditorAvailable(): boolean {
  return textMotionFlags.ui && textMotionFlags.preview && textMotionFlags.editor;
}
