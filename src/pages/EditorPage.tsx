import { useEffect, useRef } from 'react';
import { EditorLayout } from '@/layouts/EditorLayout';
import { useTimelineStore } from '@/stores/timelineStore';
import { useProjectStore } from '@/stores/projectStore';
import { createEmptyTimeline } from '@/types/timeline';
import type { Timeline, Track, Clip } from '@/types/timeline';
import { uid } from '@/lib/utils';
import { projectCache, createAutoSaver } from '@/services/storage/projectCache';
import { projectApi } from '@/services/api';
import { useGlobalKeybindings } from '@/features/keyboard/useGlobalKeybindings';
import { ShortcutCheatSheet } from '@/features/keyboard/ShortcutCheatSheet';

const AUTOSAVE_PROJECT_ID = 'current';

/**
 * EditorPage — hosts the 4-panel editor. Restores the last auto-saved project
 * from IndexedDB (or seeds a starter timeline), and continuously auto-saves
 * timeline changes so a crash never loses work.
 */
export function EditorPage() {
  // Global shortcuts + cheat sheet (Ctrl+/)
  const { cheatSheetOpen, setCheatSheetOpen } = useGlobalKeybindings();

  // Restore or seed on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      const store = useTimelineStore.getState();
      const cached = await projectCache.load(AUTOSAVE_PROJECT_ID).catch(() => undefined);
      if (!alive) return;
      if (cached && cached.timeline && cached.timeline.tracks.length > 0) {
        store.setTimeline(cached.timeline);
        if (cached.name) useProjectStore.getState().setProjectName(cached.name);
      } else if (store.timeline.tracks.length === 0) {
        store.setTimeline(buildStarterTimeline());
      }
    })();
    return () => { alive = false; };
  }, []);

  // Auto-save on timeline change (debounced)
  useEffect(() => {
    const saver = createAutoSaver(1500);
    const unsub = useTimelineStore.subscribe((state, prev) => {
      if (state.timeline !== prev.timeline) {
        saver.schedule({
          id: AUTOSAVE_PROJECT_ID,
          name: useProjectStore.getState().projectName,
          timeline: state.timeline,
          personaId: useProjectStore.getState().personaId,
          pluginId: useProjectStore.getState().pluginId,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
    });
    // Flush on unload so the latest edit is persisted
    const onUnload = () => { saver.flush(); };
    window.addEventListener('beforeunload', onUnload);
    return () => {
      unsub();
      window.removeEventListener('beforeunload', onUnload);
      saver.flush();
    };
  }, []);

  // Server-side auto-save (debounced, only when project has an ID)
  const serverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsub = useTimelineStore.subscribe((_state, _prev) => {
      const st = useProjectStore.getState();
      if (!st.projectId) return;
      if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
      serverSaveTimer.current = setTimeout(() => {
        projectApi.save({
          id: st.projectId!,
          name: st.projectName,
          timeline: useTimelineStore.getState().timeline,
          persona_id: st.personaId ?? undefined,
          plugin_id: st.pluginId ?? undefined,
        }).catch(() => { /* offline */ });
      }, 10000);
    });
    return () => {
      unsub();
      if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
    };
  }, []);

  return (
    <>
      <EditorLayout />
      <ShortcutCheatSheet open={cheatSheetOpen} onClose={() => setCheatSheetOpen(false)} />
    </>
  );
}

/** Build a small demo timeline showcasing all clip kinds. */
function buildStarterTimeline(): Timeline {
  const tl = createEmptyTimeline(uid('tl'));
  tl.fps = 30;

  const mkClip = (over: Partial<Clip> & { kind: Clip['kind']; track_id: string; start_sec: number; duration_sec: number }): Clip => ({
    id: uid('clip'), asset_id: '', source_offset_sec: 0, speed: 1, volume: 1, opacity: 1,
    keyframes: [], metadata: {}, ...over,
  });

  const v1: Track = { id: uid('tr'), name: 'V1 · 主视频', kind: 'video', index: 0, locked: false, muted: false, clips: [] };
  const v2: Track = { id: uid('tr'), name: 'V2 · 文字', kind: 'text', index: 1, locked: false, muted: false, clips: [] };
  const a1: Track = { id: uid('tr'), name: 'A1 · 旁白', kind: 'audio', index: 2, locked: false, muted: false, clips: [] };
  const a2: Track = { id: uid('tr'), name: 'A2 · 音乐', kind: 'audio', index: 3, locked: false, muted: false, clips: [] };

  // Main video scenes
  const scenes = [
    { dur: 6, title: '开场钩子' },
    { dur: 9, title: '背景铺垫' },
    { dur: 11, title: '论点一' },
    { dur: 8, title: '论点二' },
    { dur: 7, title: '总结' },
  ];
  let cursor = 0;
  for (const s of scenes) {
    v1.clips.push(mkClip({
      kind: 'video', track_id: v1.id, start_sec: cursor, duration_sec: s.dur,
      asset_id: `${s.title}.mp4`, metadata: { title: s.title },
      transition_in: cursor === 0 ? null : 'hard_cut',
    }));
    cursor += s.dur;
  }

  // Text overlays
  v2.clips.push(mkClip({
    kind: 'text', track_id: v2.id, start_sec: 0.5, duration_sec: 4.5,
    text: '你真的了解它吗？', font_size: 64, font_color: '#FBBF24',
    keyframes: [
      { time: 0, properties: { opacity: 0 } },
      { time: 0.2, properties: { opacity: 1 } },
      { time: 0.85, properties: { opacity: 1 } },
      { time: 1, properties: { opacity: 0 } },
    ],
  }));
  v2.clips.push(mkClip({
    kind: 'caption', track_id: v2.id, start_sec: 15.5, duration_sec: 9,
    text: '关键在于这三个设计', font_size: 48, font_color: '#FFFFFF',
  }));

  // Voiceover
  a1.clips.push(mkClip({
    kind: 'audio', track_id: a1.id, start_sec: 1, duration_sec: cursor - 2,
    asset_id: '旁白配音.wav', metadata: { title: '旁白配音' }, volume: 1,
  }));

  // BGM with fade keyframes
  a2.clips.push(mkClip({
    kind: 'audio', track_id: a2.id, start_sec: 0, duration_sec: cursor,
    asset_id: '背景音乐.mp3', metadata: { title: '背景音乐' }, volume: 0.25,
    keyframes: [
      { time: 0, properties: { opacity: 0 } },
      { time: 0.05, properties: { opacity: 0.25 } },
      { time: 0.95, properties: { opacity: 0.25 } },
      { time: 1, properties: { opacity: 0 } },
    ],
  }));

  tl.tracks = [v1, v2, a1, a2];
  tl.duration_sec = cursor;
  return tl;
}
