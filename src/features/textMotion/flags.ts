/** MotionSpec 前端阶段开关；默认全部关闭，按发布计划逐阶段启用。 */
const env = import.meta.env as Record<string, string | undefined>;

export const textMotionFlags = {
  ui: env.VITE_TEXT_MOTION_SPEC_UI === '1' || import.meta.env.DEV,
  preview: env.VITE_TEXT_MOTION_SPEC_PREVIEW === '1',
  editor: env.VITE_TEXT_MOTION_SPEC_EDITOR === '1',
} as const;

export function textMotionEditorAvailable(): boolean {
  return textMotionFlags.ui && textMotionFlags.preview && textMotionFlags.editor;
}
