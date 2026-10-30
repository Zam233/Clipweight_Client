import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useBlocker } from '@tanstack/react-router';
import { EditorLayout } from '@/layouts/EditorLayout';
import { useTimelineStore } from '@/stores/timelineStore';
import { useProjectStore } from '@/stores/projectStore';
import { useAgentStore, clearRequirementsDraft, loadRequirementsDraft } from '@/stores/agentStore';
import { useTaskStore } from '@/stores/taskStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useAssetStore } from '@/stores/assetStore';
import { useVoiceStore } from '@/stores/voiceStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { toast } from '@/stores/toastStore';
import { projectApi, requirementsApi, taskApi, getApiClient } from '@/services/api';
import { session } from '@/services/api/session';
import { mediaManager } from '@/services/media/mediaManager';
import { useGlobalKeybindings } from '@/features/keyboard/useGlobalKeybindings';
import { usePluginShortcuts } from '@/features/plugins/usePluginShortcuts';
import { keybindingEngine } from '@/features/keyboard/KeybindingEngine';
import { ShortcutCheatSheet } from '@/features/keyboard/ShortcutCheatSheet';
import { useRequirementsAutoStart } from '@/features/agent/useRequirementsAutoStart';
import { tabSync } from '@/services/tabSync';
import { uid } from '@/lib/utils';
import { createEmptyTimeline } from '@/types/timeline';
import { Loader2 } from 'lucide-react';
import { decideFlushPayload } from './flushPayload';
import {
  draftAge, getDraftRepository, isDraftNewer, type DraftRecord,
} from '@/services/storage/drafts';

/**
 * EditorPage — hosts the 4-panel editor. Loads project from backend by id
 * (strict: no IndexedDB fallback). Auto-saves to backend on timeline change.
 */
export function EditorPage() {
  const { projectId } = useParams({ from: '/editor/$projectId' });
  // P2-38: 供 agentStore 草稿归属校验读取当前项目 id
  (globalThis as { __cw_getProjectId?: () => string }).__cw_getProjectId = () => projectId;
  const { cheatSheetOpen, setCheatSheetOpen } = useGlobalKeybindings();
  // D-3j：插件贡献的快捷键（挂载注册/卸载注销）
  usePluginShortcuts();
  // P2-19: 快捷键速查表打开时视为模态——单键快捷键不触发
  useEffect(() => {
    keybindingEngine.setModalOpen(cheatSheetOpen);
    return () => {
      if (cheatSheetOpen) keybindingEngine.setModalOpen(false);
    };
  }, [cheatSheetOpen]);
  const dirtyRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // O5：本地草稿恢复提示（草稿比服务端新时才出现）
  const [draftPrompt, setDraftPrompt] = useState<DraftRecord | null>(null);
  /** 本次编辑期间是否已把草稿写进 IndexedDB（用于提示文案与恢复判定） */
  const draftRef = useRef<DraftRecord | null>(null);
  // HomePage.launch() 写入的需求数据快照。用 ref 保存以跨 StrictMode 双重挂载持久化——
  // 否则首次挂载的 resetProject 会清空 store，第二次挂载快照到的是已清空的值，导致恢复失败。
  // B16: 捕获全部字段（含文稿/音色/配音/模式），resetProject 后再恢复。
  const pendingReqRef = useRef<{
    topic: string;
    script: string;
    audioDur: number;
    materialSourceIds: string[];
    scriptText: string;
    videoMode: string;
    splitMode: string;
    audioPath: string;
    audioDurationSec: number;
    voiceId: string | null;
    autoDub: boolean;
    personaId: string | null;
    pluginId: string | null;
  } | null>(null);

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
            scriptText: preResetProject.scriptText,
            videoMode: preResetProject.videoMode,
            splitMode: preResetProject.splitMode,
            audioPath: preResetProject.audioPath,
            audioDurationSec: preResetProject.audioDurationSec,
            voiceId: preResetProject.voiceId,
            autoDub: preResetProject.autoDub,
            personaId: preResetProject.personaId,
            pluginId: preResetProject.pluginId,
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
        let project: { id: string; name: string; persona_id?: string; plugin_id?: string; timeline: ReturnType<typeof createEmptyTimeline> | null; agent_state?: import('@/types/api').AgentStateSnapshot | null; updated_at?: string };
        try {
          project = await projectApi.load(projectId);
        } catch (loadErr) {
          console.warn('[EditorPage] Backend load failed, using local empty project:', loadErr);
          toast('后端加载失败 — 已打开全新的本地空项目（原项目未被修改）', 'info');
          // 批B：换新 id——旧实现沿用真实 projectId，自动保存会把本地空项目
          // PUT 回后端，覆盖/复活加载失败的项目
          project = { id: `proj_local_${Date.now().toString(36)}`, name: '未命名项目', timeline: null };
        }
        if (!alive) return;
        useProjectStore.getState().setProjectId(project.id);
        useProjectStore.getState().setProjectName(project.name);
        if (project.persona_id) useProjectStore.getState().setPersonaId(project.persona_id);
        if (project.plugin_id) useProjectStore.getState().setPluginId(project.plugin_id);
        // P2-02: 空时间线应用设置中的默认帧率/分辨率（原硬编 1920x1080@30）
        const _emptyTl = () => {
          const st = useSettingsStore.getState();
          const tl = createEmptyTimeline();
          tl.fps = st.defaultFps;
          tl.width = st.defaultResolution.width;
          tl.height = st.defaultResolution.height;
          return tl;
        };
        useTimelineStore.getState().setTimeline(project.timeline ?? _emptyTl());
        // 注册项目时间线中的真实媒体（video/audio/image），供预览真实渲染
        mediaManager.registerTimeline(project.timeline ?? _emptyTl());
        // O5：先用手上的派生数据快照补缩略图/波形/时长（刷新后不再先看到一片空白），
        // 再检查是否存在比服务端更新的本地草稿
        try {
          const repo = getDraftRepository();
          const snapshots = await repo.listMediaSnapshots();
          if (snapshots.length > 0) mediaManager.applySnapshots(snapshots);
          const draft = await repo.getDraft(project.id);
          if (isDraftNewer(draft, project.updated_at)) {
            draftRef.current = draft;
            setDraftPrompt(draft);
          }
        } catch {
          // 草稿是可选的增强：读写失败静默降级，不阻断编辑器
        }
        // Restore requirements data so AgentPanel auto-start can consume it
        if (pendingTopic) {
          const pending = pendingReqRef.current!;
          useProjectStore.getState().setRequirementsTopic(pending.topic);
          useProjectStore.getState().setRequirementsScript(pending.script);
          useProjectStore.getState().setRequirementsAudioDuration(pending.audioDur);
          useProjectStore.getState().setMaterialSourceIds(pending.materialSourceIds);
          // B16: 恢复全部启动参数（resetProject 清空后重写），保证管线收到文稿/音色/配音/模式
          useProjectStore.getState().setScriptText(pending.scriptText);
          useProjectStore.getState().setVideoMode(pending.videoMode);
          useProjectStore.getState().setSplitMode(pending.splitMode);
          useProjectStore.getState().setAudioPath(pending.audioPath);
          useProjectStore.getState().setAudioDurationSec(pending.audioDurationSec);
          useProjectStore.getState().setVoiceId(pending.voiceId);
          useProjectStore.getState().setAutoDub(pending.autoDub);
          useProjectStore.getState().setPersonaId(pending.personaId);
          useProjectStore.getState().setPluginId(pending.pluginId);
        } else {
          // 非首页新启动 → 恢复项目保存的 Agent 状态（需求对话/简报/规划书/执行日志）
          if (project.agent_state) useAgentStore.getState().restoreAgentState(project.agent_state);
          // 服务端快照可能早于需求会话（旧实现只在时间线变化时才落盘 agent_state）
          // → 回退读本地草稿，否则刷新后会话/规划书卡片整个消失
          const _draft = loadRequirementsDraft();
          if (_draft && _draft.sessionId && !useAgentStore.getState().requirementsSessionId) {
            useAgentStore.getState().restoreAgentState({
              requirementsSessionId: _draft.sessionId,
              requirementsStatus: _draft.status,
              requirementsMessages: _draft.messages,
              creativeBrief: _draft.brief,
              productionPlan: _draft.plan,
            });
          }
          // G8: 存在需求会话时从后端同步权威状态（消息/简报/规划书/status），
          // 失败静默保留本地恢复值（离线兜底）。
          const sid = useAgentStore.getState().requirementsSessionId;
          if (sid) {
            try {
              const remote = await requirementsApi.getSession(sid) as {
                status?: string;
                messages?: Array<{ role: string; content: string; timestamp: string }>;
                creative_brief?: unknown;
                production_plan?: unknown;
              };
              const ag = useAgentStore.getState();
              if (Array.isArray(remote?.messages) && remote.messages.length > 0) {
                ag.setRequirementsStatus((remote.status as never) ?? ag.requirementsStatus);
                ag.addRequirementsMessage({
                  id: uid('m'), role: 'assistant', content: '已从后端同步会话',
                  timestamp: new Date().toISOString(),
                });
                // 用后端消息覆盖本地草稿（保留现有 store action 语义）
                const restored = remote.messages.map((m) => ({
                  id: uid('m'), role: m.role as never, content: m.content, timestamp: m.timestamp,
                })) as Array<Record<string, unknown>>;
                // 卡片（简报/规划书）是**挂在消息上**渲染的：后端把 brief/plan 存在会话顶层，
                // 消息本身可能不带附件（例如规划书是流式生成完成后才落到会话）。
                // 只把 brief/plan 塞进 store 字段而不补消息，刷新后卡片与「确认并启动管线」
                // 按钮都不会出现（E2E 实测：status=plan_ready 却无法继续）。
                const hasBrief = restored.some((m) => m.creative_brief);
                const hasPlan = restored.some((m) => m.production_plan);
                if (remote?.creative_brief && !hasBrief) {
                  restored.push({
                    id: uid('m'), role: 'assistant',
                    content: '已恢复创意简报，请审阅后确认。',
                    timestamp: new Date().toISOString(),
                    creative_brief: remote.creative_brief,
                  });
                }
                if (remote?.production_plan && !hasPlan) {
                  restored.push({
                    id: uid('m'), role: 'assistant',
                    content: '已恢复制作规划书，请审阅后确认并启动管线。',
                    timestamp: new Date().toISOString(),
                    production_plan: remote.production_plan,
                  });
                }
                useAgentStore.setState({ requirementsMessages: restored as never });
              }
              if (remote?.creative_brief) useAgentStore.getState().setCreativeBrief(remote.creative_brief as never);
              if (remote?.production_plan) useAgentStore.getState().setProductionPlan(remote.production_plan as never);
            } catch {
              // 离线：保留本地草稿
            }
          }
          // 过期「管线运行中」自救：任务早就结束（成功/失败/取消）而 agent_state 里
          // 仍是 pipeline_running 时，confirmPlan 会一直拒绝启动（刷新前浏览器没收到
          // task_end 就会永久卡住）。这里按任务列表核实一次，没有在跑的任务就降级。
          if (useAgentStore.getState().requirementsStatus === 'pipeline_running') {
            try {
              const res = await taskApi.list(10);
              const active = (res?.items ?? []).some((it) =>
                ['running', 'pending', 'planning', 'paused'].includes(String(it.status)),
              );
              if (!active) useAgentStore.getState().setRequirementsStatus('pipeline_done');
            } catch {
              // 拉不到任务列表就保持原状态（宁可保守，也不谎报已完成）
            }
          }
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
      // 轮75：清除时间轴未保存标记（状态栏「未保存」指示复位）
      useTimelineStore.getState().markSaved();
      // O5: 服务端已经拿到这份改动 → 本地草稿使命完成，删掉避免下次误提示「恢复草稿」
      draftRef.current = null;
      setDraftPrompt(null);
      void getDraftRepository().deleteDraft(st.projectId).catch(() => {});
      // G3: 广播保存事件，通知其他标签页重新拉取
      tabSync.broadcastSaved(st.projectId);
    } catch {
      st.setSaving(false);
      st.setSaveError(true);
    }
  }, []);

  // Server-side auto-save (debounced) + O5 本地草稿（立即写，不等网络）
  const serverSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsub = useTimelineStore.subscribe((state, prev) => {
      if (state.timeline === prev.timeline) return;
      dirtyRef.current = true;
      const st = useProjectStore.getState();
      // O5：先把草稿写进 IndexedDB（本地、无网络、1 秒防抖），刷新/崩溃也不再丢改动；
      // 服务端自动保存仍走下面的 5 秒防抖 + 网络。
      if (st.projectId) {
        // 闭包里 TS 不做窄化保持，先取出非空 id
        const draftProjectId = st.projectId;
        if (draftTimer.current) clearTimeout(draftTimer.current);
        draftTimer.current = setTimeout(() => {
          const record: DraftRecord = {
            projectId: draftProjectId,
            name: st.projectName ?? undefined,
            timeline: useTimelineStore.getState().timeline,
            savedAt: Date.now(),
            dirty: true,
          };
          draftRef.current = record;
          void getDraftRepository().putDraft(record).then((result) => {
            if (!result.ok && result.reason === 'quota') {
              toast('本地草稿空间不足，已清理旧缓存；建议尽快手动保存', 'info');
            }
          }).catch(() => {});
        }, 1000);
      }
      // P2-02: 自动保存开关（设置页可关；关闭时仅依赖手动保存/离开冲刷）
      if (!useSettingsStore.getState().autoSave) return;
      if (!st.projectId) return;
      if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
      serverSaveTimer.current = setTimeout(() => {
        doSave();
      }, 5000);
    });
    return () => {
      unsub();
      if (serverSaveTimer.current) clearTimeout(serverSaveTimer.current);
      if (draftTimer.current) clearTimeout(draftTimer.current);
    };
  }, [doSave]);

  // O5：草稿恢复 —— 把草稿时间线装回编辑器（选择/历史清空，避免指向不存在的片段）
  const restoreDraft = useCallback(() => {
    const draft = draftPrompt;
    if (!draft) return;
    useTimelineStore.getState().setTimeline(draft.timeline as ReturnType<typeof createEmptyTimeline>);
    mediaManager.registerTimeline(draft.timeline as ReturnType<typeof createEmptyTimeline>);
    useSelectionStore.getState().deselectAll();
    useHistoryStore.getState().clear();
    dirtyRef.current = true;
    setDraftPrompt(null);
    toast('已恢复本地草稿（服务端仍是旧版本，保存后会覆盖）', 'info');
  }, [draftPrompt]);

  // O5：丢弃草稿（服务端版本为准）
  const discardDraft = useCallback(() => {
    const st = useProjectStore.getState();
    if (st.projectId) void getDraftRepository().deleteDraft(st.projectId).catch(() => {});
    draftRef.current = null;
    setDraftPrompt(null);
  }, []);

  // O5：媒体派生数据（缩略图/波形/时长）落 IndexedDB —— 变化后 2 秒防抖，best-effort
  useEffect(() => {
    const unsub = mediaManager.onChange(() => {
      const st = useProjectStore.getState();
      if (!st.projectId) return;
      const snapshots = mediaManager.exportSnapshots();
      if (snapshots.length === 0) return;
      const repo = getDraftRepository();
      void Promise.all(snapshots.map((s) => repo.putMediaSnapshot(s))).catch(() => {});
    });
    return () => { unsub(); };
  }, []);

  // 任务完成 → 重新加载项目时间线（E2E 2026-10-29）：
  // 主 Agent 跑完会把成片时间线回写项目（后端 services/task_project_sync.py），
  // 但编辑器不会自己重拉——刷新前用户看到的还是 0 轨，导出页按钮恒禁用。
  const taskStatus = useTaskStore((s) => s.task?.status);
  const taskId = useTaskStore((s) => s.task?.id);
  const reloadedTaskRef = useRef<string | null>(null);
  useEffect(() => {
    if (taskStatus !== 'done') return;
    const pid = useProjectStore.getState().projectId;
    if (!pid || !taskId) return;
    if (reloadedTaskRef.current === taskId) return;
    reloadedTaskRef.current = taskId;
    void (async () => {
      try {
        const project = await projectApi.load(pid);
        const tl = project?.timeline;
        if (!tl || !Array.isArray(tl.tracks) || tl.tracks.length === 0) return;
        useTimelineStore.getState().setTimeline(tl);
        mediaManager.registerTimeline(tl);
        toast('制作完成，成片时间线已载入编辑器', 'info');
      } catch {
        /* 拉取失败静默：用户可手动刷新 */
      }
    })();
  }, [taskStatus, taskId]);

  // Manual save trigger via saveNonce
  const saveNonce = useProjectStore((s) => s.saveNonce);
  useEffect(() => {
    if (saveNonce > 0) void doSave();
  }, [saveNonce, doSave]);

  // 需求会话落盘：doSave 会把 agent_state 随项目保存，但它此前只由 timelineStore
  // 变化触发；需求阶段（对话/简报/规划书）根本不动时间线，于是 agent_state 永远是
  // 初始空快照——刷新后会话丢失、规划书卡片与「确认并启动管线」按钮都出不来。
  // 这里单独订阅需求相关字段，变化后 4 秒防抖落盘。
  const reqSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const unsub = useAgentStore.subscribe((state, prev) => {
      if (
        state.requirementsSessionId === prev.requirementsSessionId &&
        state.requirementsStatus === prev.requirementsStatus &&
        state.requirementsMessages.length === prev.requirementsMessages.length &&
        state.creativeBrief === prev.creativeBrief &&
        state.productionPlan === prev.productionPlan
      ) return;
      if (!useProjectStore.getState().projectId) return;
      if (!useSettingsStore.getState().autoSave) return;
      if (reqSaveTimer.current) clearTimeout(reqSaveTimer.current);
      reqSaveTimer.current = setTimeout(() => { void doSave(); }, 4000);
    });
    return () => {
      unsub();
      if (reqSaveTimer.current) clearTimeout(reqSaveTimer.current);
    };
  }, [doSave]);

  // P0-02: SPA 导航守卫 —— 返回首页/导出/项目列表等路由离开前，先落盘未保存改动。
  // （SPA 跳转不触发 pagehide，原先 5s 防抖窗口内的最后一次改动会静默丢失。）
  const blocker = useBlocker({ shouldBlockFn: () => dirtyRef.current, withResolver: true });
  useEffect(() => {
    if (blocker.status !== 'blocked') return;
    void (async () => {
      await doSave();
      const failed = useProjectStore.getState().saveError || dirtyRef.current;
      if (failed && !window.confirm('当前有未保存的改动，确认仍要离开吗？')) {
        blocker.reset();
        return;
      }
      blocker.proceed();
    })();
  }, [blocker, doSave]);

  // Page-hide save flush — best-effort immediate save when leaving
  useEffect(() => {
    const flush = () => {
      if (!dirtyRef.current) return;
      const st = useProjectStore.getState();
      if (!st.projectId) return;
      const base = getApiClient().defaults.baseURL || '';
      const token = useSettingsStore.getState().authToken || session.token;
      // F3 负载大小守卫：>48KB 时退化为紧凑元数据，避免 keepalive 静默丢弃大负载
      const decision = decideFlushPayload({
        project_id: st.projectId,
        name: st.projectName,
        timeline: useTimelineStore.getState().timeline,
        persona_id: st.personaId ?? undefined,
        plugin_id: st.pluginId ?? undefined,
      });
      // 已知历史缺口（F3，记录于 docs/bug-audit.md）：doSave 会随项目保存 agent_state，
      // 而此处 pagehide 冲刷省略了 agent_state——卸载临界期避免序列化过大的 Agent 状态。
      // 本次修复不做改动，仅保留注释。
      if (decision.kind === 'metadata') {
        // P0-01：超限时不发 timeline（宁可不保存也不能写坏），只同步项目级字段
        toast('项目较大，本次离开仅保存项目信息，时间线未保存。请回到编辑器手动保存（Ctrl+S）', 'info');
      }
      const payload = JSON.stringify(decision.payload);
      try {
        fetch(`${base}/api/project/${st.projectId}`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            // P0-10: pagehide 冲刷走裸 fetch——补 Authorization 头，令牌模式下自动保存不再 401
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
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

  // G3: 多标签同步 — 其他标签保存后重新拉取本项目权威时间线
  useEffect(() => {
    const unsubAttach = tabSync.attach();
    const unsub = tabSync.subscribe(async (ev) => {
      const st = useProjectStore.getState();
      if (ev.type !== 'timeline-saved') return;
      if (!st.projectId || ev.projectId !== st.projectId) return;
      // 本地刚保存过（自己广播的）→ 跳过；用时间差粗判（<1s 视为同源回环）
      if (Date.now() - Date.parse(ev.at) < 1000) return;
      // 本地有未保存修改时跳过覆盖，但明确告知冲突（轮 89：旧实现静默
      // last-writer-wins，用户不知道另一标签页保存过、本地修改会覆盖远端）
      if (dirtyRef.current) {
        toast('另一标签页已保存此项目；本页有未保存修改，保存时将覆盖远端', 'error');
        return;
      }
      try {
        const project = await projectApi.load(ev.projectId);
        if (!project || !project.timeline) return;
        useTimelineStore.getState().setTimeline(project.timeline as ReturnType<typeof createEmptyTimeline>);
        mediaManager.registerTimeline(project.timeline as ReturnType<typeof createEmptyTimeline>);
        toast('其他标签页已更新此项目，已同步时间线', 'info');
      } catch { /* 拉取失败静默，下次保存再同步 */ }
    });
    return () => { unsub(); unsubAttach(); };
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
      {/* O5: 本地草稿恢复提示（草稿比服务端新时出现；不自动覆盖，交给用户决定） */}
      {draftPrompt && (
        <div
          data-testid="draft-restore-banner"
          className="fixed left-1/2 -translate-x-1/2 bottom-6 z-50 flex items-center gap-3
            rounded-cw-md border border-outline-variant/50 bg-surface-container-high px-4 py-2.5 shadow-2xl shadow-black/50"
        >
          <span className="text-body-sm text-on-surface">
            发现未保存的本地草稿（{draftAge(draftPrompt.savedAt)}），比服务端版本新
          </span>
          <button
            onClick={restoreDraft}
            className="px-3 py-1 rounded-cw-sm bg-primary text-on-primary text-label-sm hover:bg-primary/90 cursor-pointer"
          >
            恢复草稿
          </button>
          <button
            onClick={discardDraft}
            className="px-3 py-1 rounded-cw-sm text-on-surface-variant text-label-sm hover:text-on-surface cursor-pointer"
          >
            丢弃
          </button>
        </div>
      )}
      <ShortcutCheatSheet open={cheatSheetOpen} onClose={() => setCheatSheetOpen(false)} />
    </>
  );
}

