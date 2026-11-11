/**
 * P-02/P-03（PRD §2）：画布单击/双击交互决策（纯函数，便于测试与后续调口径）。
 *
 * 旧行为：单击（pointerup 未拖拽）一律 `togglePlay()` →
 * - P-02：双击编辑文字前画面先播放/暂停闪一下；
 * - P-03：点空白取消选中会把视频播起来。
 *
 * 新口径（coding plan §1 默认，产品可推翻后只需改这里）：
 * - 单击 = 选中（命中文字片段）或取消选中（空白），**不**切播放；
 * - 双击 = 命中文字进入编辑；空白双击无动作；
 * - 播放由播放按钮 / 空格快捷键控制（KeybindingEngine 已有）。
 */
export interface CanvasClickInput {
  /** pointerdown 命中了文字片段（双击编辑/单击选中的目标） */
  hitsText: boolean;
  /** 双击判定窗口内的第二次 up */
  isDouble: boolean;
  /** pointerdown→up 之间发生了拖拽（scrub）则不是点击 */
  dragging?: boolean;
  /** 按下时命中的是变换手柄（拖拽生命周期由 transformDragRef 管理） */
  hitHandle?: boolean;
}

export type CanvasClickAction =
  | { action: 'select'; togglePlay: false }
  | { action: 'edit-text'; togglePlay: false }
  | { action: 'none'; togglePlay: false };

export function resolveCanvasClickAction(input: CanvasClickInput): CanvasClickAction {
  // 拖拽/手柄拖动不是"点击"，交给各自的拖拽生命周期
  if (input.dragging || input.hitHandle) return { action: 'none', togglePlay: false };
  if (input.isDouble) {
    return input.hitsText
      ? { action: 'edit-text', togglePlay: false }
      : { action: 'none', togglePlay: false };
  }
  return input.hitsText
    ? { action: 'select', togglePlay: false }
    : { action: 'none', togglePlay: false };
}
