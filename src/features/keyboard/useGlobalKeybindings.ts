import { useEffect, useState } from 'react';
import { keybindingEngine } from './KeybindingEngine';
import { useTimelineStore } from '@/stores/timelineStore';
import { useHistoryStore } from '@/stores/historyStore';
import { usePreviewStore } from '@/stores/previewStore';

/**
 * useGlobalKeybindings — registers the editor-wide shortcuts on the
 * centralized engine and attaches the listener for the component's lifetime.
 * Returns a `cheatSheetOpen` flag toggled by Ctrl+/.
 */
export function useGlobalKeybindings() {
  const [cheatSheetOpen, setCheatSheetOpen] = useState(false);

  useEffect(() => {
    const undo = () => {
      const tl = useHistoryStore.getState().undo();
      if (tl) useTimelineStore.getState().setTimeline(tl);
    };
    const redo = () => {
      const tl = useHistoryStore.getState().redo();
      if (tl) useTimelineStore.getState().setTimeline(tl);
    };

    const unsub = keybindingEngine.registerMany([
      {
        id: 'undo', combo: 'ctrl+z', label: '撤销', category: '通用',
        when: () => useHistoryStore.getState().undoStack.length > 0,
        handler: undo,
      },
      {
        id: 'redo', combo: 'ctrl+shift+z', label: '重做', category: '通用',
        when: () => useHistoryStore.getState().redoStack.length > 0,
        handler: redo,
      },
      {
        id: 'play', combo: 'space', label: '播放 / 暂停', category: '传输控制',
        handler: () => usePreviewStore.getState().togglePlay(),
      },
      {
        id: 'step-back', combo: 'arrowleft', label: '上一帧', category: '传输控制',
        handler: () => { usePreviewStore.getState().setPlaying(false); usePreviewStore.getState().stepBackward(); },
      },
      {
        id: 'step-fwd', combo: 'arrowright', label: '下一帧', category: '传输控制',
        handler: () => { usePreviewStore.getState().setPlaying(false); usePreviewStore.getState().stepForward(); },
      },
      {
        id: 'seek-start', combo: 'home', label: '跳到开头', category: '传输控制',
        handler: () => usePreviewStore.getState().seekToStart(),
      },
      {
        id: 'seek-end', combo: 'end', label: '跳到结尾', category: '传输控制',
        handler: () => usePreviewStore.getState().seekToEnd(),
      },
      {
        id: 'cheatsheet', combo: 'ctrl+/', label: '快捷键速查表', category: '通用',
        handler: () => setCheatSheetOpen((v) => !v),
      },
    ]);

    keybindingEngine.attach();
    return () => {
      unsub();
      keybindingEngine.detach();
    };
  }, []);

  return { cheatSheetOpen, setCheatSheetOpen };
}
