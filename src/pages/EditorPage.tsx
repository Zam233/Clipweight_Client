import { useCallback, useEffect, useRef } from 'react';
import { useParams } from '@tanstack/react-router';
import { EditorLayout } from '@/layouts/EditorLayout';
import { useTimelineStore } from '@/stores/timelineStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAgentStore, clearRequirementsDraft } from '@/stores/agentStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { usePreviewStore } from '@/stores/previewStore';
import { projectApi, getApiClient } from '@/services/api';
import { mediaManager } from '@/services/media/mediaManager';
import { useGlobalKeybindings } from '@/features/keyboard/useGlobalKeybindings';
import { ShortcutCheatSheet } from '@/features/keyboard/ShortcutCheatSheet';
import { createEmptyTimeline } from '@/types/timeline';

/**
 * EditorPage — hosts the 4-panel editor. Loads project from backend by id
 * (strict: no IndexedDB fallback). Auto-saves to backend on timeline change.
 */
export function EditorPage() {
  const { projectId } = useParams({ from: '/editor/$projectId' });
  const { cheatSheetOpen, setCheatSheetOpen } = useGlobalKeybindings();
  const dirtyRef = useRef(false);

  // Load project from backend on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // Reset all stores before loading the new project to prevent
        // stale state from the previous project leaking through.
        // resetProject() first — it nulls projectId, which makes
        // autosave's `if (!st.projectId) return;` guard skip any
        // in-flight writes to the old project.
        useProjectStore.getState().resetProject();
        useTimelineStore.getState().resetTimeline();
        useAgentStore.getState().resetPipeline();
        useAgentStore.getState().resetRequirements();
        clearRequirementsDraft();
        useHistoryStore.getState().clear();
        useSelectionStore.getState().deselectAll();
        usePreviewStore.getState().setPlaying(false);
        usePreviewStore.getState().setCurrentTime(0);
        // 释放上一个项目的媒体资源（object URL / media element / 缓存）
        mediaManager.clear();

        const project = await projectApi.load(projectId);
        if (!alive) return;
        useProjectStore.getState().setProjectId(project.id);
        useProjectStore.getState().setProjectName(project.name);
        if (project.persona_id) useProjectStore.getState().setPersonaId(project.persona_id);
        if (project.plugin_id) useProjectStore.getState().setPluginId(project.plugin_id);
        useTimelineStore.getState().setTimeline(project.timeline ?? createEmptyTimeline());
      } catch (err) {
        console.error('[EditorPage] Failed to load project:', err);
        // The beforeLoad guard should have caught this, but as fallback:
        window.location.href = '/';
      }
    })();
    return () => { alive = false; };
  }, [projectId]);

  // Save helper — used by autosave, manual save, and pagehide flush
  const doSave = useCallback(async () => {
    const st = useProjectStore.getState();
    if (!st.projectId) return;
    st.setSaving(true);
    st.setSaveError(false);
    try {
      await projectApi.save(st.projectId, {
        name: st.projectName,
        timeline: useTimelineStore.getState().timeline,
        persona_id: st.personaId ?? undefined,
        plugin_id: st.pluginId ?? undefined,
      });
      st.setSaving(false);
      st.setLastSaved(new Date().toISOString());
      dirtyRef.current = false;
    } catch {
      st.setSaving(false);
      st.setSaveError(true);
    }
  }, []);

  // Server-side auto-save (debounced)
  const serverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsub = useTimelineStore.subscribe((_state, _prev) => {
      dirtyRef.current = true;
      const st = useProjectStore.getState();
      if (!st.projectId) return;
      if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
      serverSaveTimer.current = setTimeout(() => {
        doSave();
      }, 5000);
    });
    return () => {
      unsub();
      if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
    };
  }, [doSave]);

  // Manual save trigger via saveNonce
  const saveNonce = useProjectStore((s) => s.saveNonce);
  useEffect(() => {
    if (saveNonce > 0) void doSave();
  }, [saveNonce, doSave]);

  // Page-hide save flush — best-effort immediate save when leaving
  useEffect(() => {
    const flush = () => {
      if (!dirtyRef.current) return;
      const st = useProjectStore.getState();
      if (!st.projectId) return;
      const base = getApiClient().defaults.baseURL || 'http://localhost:8000';
      const payload = JSON.stringify({
        name: st.projectName,
        timeline: useTimelineStore.getState().timeline,
        persona_id: st.personaId ?? undefined,
        plugin_id: st.pluginId ?? undefined,
      });
      try {
        navigator.sendBeacon(
          `${base}/api/project/${st.projectId}`,
          new Blob([payload], { type: 'application/json' }),
        );
      } catch { /* best effort */ }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);

  return (
    <>
      <EditorLayout />
      <ShortcutCheatSheet open={cheatSheetOpen} onClose={() => setCheatSheetOpen(false)} />
    </>
  );
}
