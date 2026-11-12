import { useEffect } from 'react';
import { keybindingEngine } from './KeybindingEngine';

/**
 * 模态/覆盖层登记（P2-19）。
 *
 * 弹层打开时单键快捷键（Space/J/K/Delete…）不该继续作用于时间线；
 * 引擎侧只提供计数与判定，弹层需要在自己的生命周期里显式登记。
 * `active=false`（或组件卸载）会释放计数。
 */
export function useModalKeybindingGuard(active = true): void {
  useEffect(() => {
    if (!active) return;
    keybindingEngine.setModalOpen(true);
    return () => keybindingEngine.setModalOpen(false);
  }, [active]);
}
