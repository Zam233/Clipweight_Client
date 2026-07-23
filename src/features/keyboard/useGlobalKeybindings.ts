import { useEffect, useState } from 'react';
import { keybindingEngine } from './KeybindingEngine';
import { useTimelineStore } from '@/stores/timelineStore';
import { useHistoryStore } from '@/stores/historyStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useSelectionStore } from '@/stores/selectionStore';

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

    const splitSelected = () => {
      const sel = useSelectionStore.getState().selectedClipIds;
      const store = useTimelineStore.getState();
      const t = usePreviewStore.getState().currentTimeSec;
      for (const cid of sel) {
        for (const tr of store.timeline.tracks) {
          const clip = tr.clips.find((c) => c.id === cid);
          if (clip && t > clip.start_sec && t < clip.start_sec + clip.duration_sec) {
            useHistoryStore.getState().pushState(useTimelineStore.getState().timeline, 'split');
            store.splitClip(clip.id, t);
            break;
          }
        }
      }
    };

    const toggleLoop = () => usePreviewStore.getState().toggleLoop();

    const deleteSelected = () => {
      const sel = useSelectionStore.getState().selectedClipIds;
      if (sel.length === 0) return;
      useHistoryStore.getState().pushState(useTimelineStore.getState().timeline, 'delete');
      const store = useTimelineStore.getState();
      sel.forEach((id) => store.removeClip(id));
      useSelectionStore.getState().deselectAll();
    };

    const toggleMuteSelectedTrack = () => {
      const sel = useSelectionStore.getState().selectedClipIds;
      if (sel.length === 0) return;
      const store = useTimelineStore.getState();
      const cid = sel[0];
      for (const tr of store.timeline.tracks) {
        if (tr.clips.some((c) => c.id === cid)) {
          store.toggleTrackMute(tr.id);
          break;
        }
      }
    };

    const toggleLockSelectedTrack = () => {
      const sel = useSelectionStore.getState().selectedClipIds;
      if (sel.length === 0) return;
      const store = useTimelineStore.getState();
      const cid = sel[0];
      for (const tr of store.timeline.tracks) {
        if (tr.clips.some((c) => c.id === cid)) {
          store.toggleTrackLock(tr.id);
          break;
        }
      }
    };

    const unsub = keybindingEngine.registerMany([
      { id: 'undo', combo: 'ctrl+z', label: '撤销', category: '通用',
        when: () => useHistoryStore.getState().undoStack.length > 0, handler: undo },
      { id: 'redo', combo: 'ctrl+shift+z', label: '重做', category: '通用',
        when: () => useHistoryStore.getState().redoStack.length > 0, handler: redo },
      { id: 'play', combo: 'space', label: '播放 / 暂停', category: '传输控制',
        handler: () => usePreviewStore.getState().togglePlay() },
      { id: 'step-back', combo: 'arrowleft', label: '上一帧', category: '传输控制',
        handler: () => { usePreviewStore.getState().setPlaying(false); usePreviewStore.getState().stepBackward(); } },
      { id: 'step-fwd', combo: 'arrowright', label: '下一帧', category: '传输控制',
        handler: () => { usePreviewStore.getState().setPlaying(false); usePreviewStore.getState().stepForward(); } },
      { id: 'seek-start', combo: 'home', label: '跳到开头', category: '传输控制',
        handler: () => usePreviewStore.getState().seekToStart() },
      { id: 'seek-end', combo: 'end', label: '跳到结尾', category: '传输控制',
        handler: () => usePreviewStore.getState().seekToEnd() },
      { id: 'shuttle-rev', combo: 'j', label: '倒放 (J)', category: '传输控制',
        when: () => !usePreviewStore.getState().isPlaying || usePreviewStore.getState().shuttleSpeed !== -1,
        handler: () => usePreviewStore.getState().shuttleReverse() },
      { id: 'shuttle-stop', combo: 'k', label: '暂停 (K)', category: '传输控制',
        handler: () => usePreviewStore.getState().shuttleStop() },
      { id: 'shuttle-fwd', combo: 'l', label: '播放 (L)', category: '传输控制',
        when: () => !usePreviewStore.getState().isPlaying || usePreviewStore.getState().shuttleSpeed !== 1,
        handler: () => usePreviewStore.getState().shuttleForward() },
      { id: 'loop', combo: '/', label: '循环播放开关', category: '传输控制',
        handler: toggleLoop },
      { id: 'marker-in', combo: 'i', label: '设置入点 (I)', category: '标记',
        handler: () => usePreviewStore.getState().setMarkerIn() },
      { id: 'marker-out', combo: 'o', label: '设置出点 (O)', category: '标记',
        handler: () => usePreviewStore.getState().setMarkerOut() },
      { id: 'split', combo: 's', label: '分割片段 (S)', category: '编辑',
        when: () => useSelectionStore.getState().selectedClipIds.length > 0,
        handler: splitSelected },
      { id: 'delete', combo: 'delete', label: '删除片段', category: '编辑',
        when: () => useSelectionStore.getState().selectedClipIds.length > 0,
        handler: deleteSelected },
      { id: 'mute-track', combo: 'm', label: '静音轨道 (M)', category: '轨道',
        when: () => useSelectionStore.getState().selectedClipIds.length > 0,
        handler: toggleMuteSelectedTrack },
      { id: 'lock-track', combo: 'shift+l', label: '锁定轨道', category: '轨道',
        when: () => useSelectionStore.getState().selectedClipIds.length > 0,
        handler: toggleLockSelectedTrack },
      { id: 'cheatsheet', combo: 'ctrl+/', label: '快捷键速查表', category: '通用',
        handler: () => setCheatSheetOpen((v) => !v) },
    ]);

    keybindingEngine.attach();
    return () => { unsub(); keybindingEngine.detach(); };
  }, []);

  return { cheatSheetOpen, setCheatSheetOpen };
}
