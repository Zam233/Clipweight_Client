import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from '@tanstack/react-router';
import { EditorLayout } from '@/layouts/EditorLayout';
import { useTimelineStore } from '@/stores/timelineStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAgentStore, clearRequirementsDraft } from '@/stores/agentStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useAssetStore } from '@/stores/assetStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { toast } from '@/stores/toastStore';
import { projectApi, getApiClient } from '@/services/api';
import { mediaManager } from '@/services/media/mediaManager';
import { useGlobalKeybindings } from '@/features/keyboard/useGlobalKeybindings';
import { ShortcutCheatSheet } from '@/features/keyboard/ShortcutCheatSheet';
import { useRequirementsAutoStart } from '@/features/agent/useRequirementsAutoStart';
import { createEmptyTimeline } from '@/types/timeline';
import { Loader2 } from 'lucide-react';

/**
 * EditorPage — hosts the 4-panel editor. Loads project from backend by id
 * (strict: no IndexedDB fallback). Auto-saves to backend on timeline change.
 */
export function EditorPage() {
  const { projectId } = useParams({ from: '/editor/$projectId' });
  const { cheatSheetOpen, setCheatSheetOpen } = useGlobalKeybindings();
  const dirtyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // HomePage.launch() 写入的需求数据快照。用 ref 保存以跨 StrictMode 双重挂载持久化——
  // 否则首次挂载的 resetProject 会清空 store，第二次挂载快照到的是已清空的值，导致恢复失败。
  const pendingReqRef = useRef<{ topic: string; script: string; audioDur: number; materialSourceIds: string[] } | null>(null);

  // Auto-start the requirements Agent when launched from HomePage (panel-independent).
  // Gated on !loading so it runs only after the project (and requirements data) is restored.
  useRequirementsAutoStart(!loading);

  // Load project from backend on mount
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        // 仅在首次捕获 HomePage.launch() 写入的需求数据（ref 跨 StrictMode 重挂载保留）
        if (pendingReqRef.current === null) {
          const preResetProject = useProjectStore.getState();
          pendingReqRef.current = {
            topic: preResetProject.requirementsTopic,
            script: preResetProject.requirementsScript,
            audioDur: preResetProject.requirementsAudioDuration,
            materialSourceIds: preResetProject.materialSourceIds,
          };
        }
        const pendingTopic = pendingReqRef.current.topic;

        // Reset all stores before loading the new project to prevent
        // stale state from the previous project leaking through.
        // resetProject() first — it nulls projectId, which makes
        // autosave's `if (!st.projectId) return;` guard skip any
        // in-flight writes to the old project.
        useProjectStore.getState().resetProject();
        useTimelineStore.getState().resetTimeline();
        useAgentStore.getState().resetPipeline();
        useAgentStore.getState().resetRequirements();
        // 仅在从 HomePage 启动（有 pendingTopic）时清除旧 draft；
        // 如果是页面刷新/直接导航，保留 24h 会话草稿让用户继续工作
        if (pendingTopic) clearRequirementsDraft();
        useHistoryStore.getState().clear();
        useSelectionStore.getState().deselectAll();
        usePreviewStore.getState().resetPreview();
        useAssetStore.getState().clearAssets();
        useVoiceStore.getState().resetVoices();
        // 释放上一个项目的媒体资源（object URL / media element / 缓存）
        mediaManager.clear();

        // Load from backend; on failure (offline / not found) fall back to an
        // empty local project so the editor remains usable in demo mode.
        let project: { id: string; name: string; persona_id?: string; plugin_id?: string; timeline: ReturnType<typeof createEmptyTimeline> | null; agent_state?: import('@/types/api').AgentStateSnapshot | null };
        try {
          project = await projectApi.load(projectId);
        } catch (loadErr) {
          console.warn('[EditorPage] Backend load failed, using local empty project:', loadErr);
          toast('后端离线 — 已打开本地空项目', 'info');
          project = { id: projectId, name: '未命名项目', timeline: null };
        }
        if (!alive) return;
        useProjectStore.getState().setProjectId(project.id);
        useProjectStore.getState().setProjectName(project.name);
        if (project.persona_id) useProjectStore.getState().setPersonaId(project.persona_id);
        if (project.plugin_id) useProjectStore.getState().setPluginId(project.plugin_id);
        useTimelineStore.getState().setTimeline(project.timeline ?? createEmptyTimeline());
        // 注册项目时间线中的真实媒体（video/audio/image），供预览真实渲染
        mediaManager.registerTimeline(project.timeline ?? createEmptyTimeline());
        // Restore requirements data so AgentPanel auto-start can consume it
        if (pendingTopic) {
          const pending = pendingReqRef.current!;
          useProjectStore.getState().setRequirementsTopic(pending.topic);
          useProjectStore.getState().setRequirementsScript(pending.script);
          useProjectStore.getState().setRequirementsAudioDuration(pending.audioDur);
          useProjectStore.getState().setMaterialSourceIds(pending.materialSourceIds);
        } else if (project.agent_state) {
          // 非首页新启动 → 恢复项目保存的 Agent 状态（需求对话/简报/规划书/执行日志）
          useAgentStore.getState().restoreAgentState(project.agent_state);
        }
        if (alive) setLoading(false);
      } catch (err) {
        console.error('[EditorPage] Failed to initialize editor:', err);
        if (alive) {
          setLoadError('编辑器初始化失败');
          setLoading(false);
        }
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
      // 快照 Agent 状态（需求对话/简报/规划书/执行日志），随项目持久化，加载时恢复
      const ag = useAgentStore.getState();
      const agentState = {
        requirementsSessionId: ag.requirementsSessionId,
        requirementsStatus: ag.requirementsStatus,
        requirementsMessages: ag.requirementsMessages,
        creativeBrief: ag.creativeBrief,
        productionPlan: ag.productionPlan,
        logEntries: ag.logEntries,
      };
      await projectApi.save(st.projectId, {
        name: st.projectName,
        timeline: useTimelineStore.getState().timeline,
        persona_id: st.personaId ?? undefined,
        plugin_id: st.pluginId ?? undefined,
        agent_state: agentState,
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
    const unsub = useTimelineStore.subscribe((state, prev) => {
      if (state.timeline === prev.timeline) return;
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
        fetch(`${base}/api/project/${st.projectId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: payload,
          keepalive: true,
        }).catch(() => {});
      } catch { /* best effort */ }
    };
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      window.removeEventListener('beforeunload', flush);
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-surface-dim text-on-surface-variant gap-3">
        <Loader2 className="w-5 h-5 animate-spin text-primary" />
        <span className="text-body">加载项目中…</span>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-surface-dim gap-4">
        <p className="text-error text-body">{loadError}</p>
        <button
          onClick={() => window.location.href = '/'}
          className="px-4 py-2 rounded-cw-md bg-primary text-on-primary text-body-sm hover:bg-primary/90 cursor-pointer"
        >
          返回首页
        </button>
      </div>
    );
  }

  return (
    <>
      <EditorLayout />
      <ShortcutCheatSheet open={cheatSheetOpen} onClose={() => setCheatSheetOpen(false)} />
    </>
  );
}
