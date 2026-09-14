import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useProjectStore } from '@/stores/projectStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useMediaQuery } from '@/hooks/useMediaQuery';
import { toast } from '@/stores/toastStore';
import { Button, Tooltip } from '@/components/ui';
import { formatTimecode, uid } from '@/lib/utils';
import { usePluginSlots } from '@/features/plugins/usePluginSlots';
import { HistoryPanel } from '@/features/history/HistoryPanel';
import {
  alignCuesToFrames, parseSubtitles, summarizeParse,
  type SubtitleCue, type SubtitleWarning,
} from '@/features/subtitles/parse';
import { getApiClient } from '@/services/api';
import type { Clip } from '@/types/timeline';
import type { ClipKind } from '@/types/timeline';
import { createEmptyTimeline } from '@/types/timeline';
import {
  Play, Pause, SkipBack, SkipForward, StepBack, StepForward,
  Undo2, Redo2, Save, PanelLeft, PanelRight, Bot, Film,
  FileText, ArrowLeft, Check, Loader2, Mic, Download,
  Copy, ClipboardPaste, FileUp, Keyboard, FileJson, Upload,
  History as HistoryIcon,
} from 'lucide-react';

/**
 * EditorToolbar — top transport + panel toggles + project actions.
 */

/** In-memory clip clipboard (shared with keyboard shortcuts). */
export const clipClipboard: { clips: Clip[] } = { clips: [] };

/** 导入类操作错误归类：400 → 格式错误，422 → 数据校验失败，其他 → 后端不可达。 */
export function extractImportError(err: unknown, actionLabel: string): string {
  const status = (err as { response?: { status?: number } } | null)?.response?.status;
  if (status === 400) return `${actionLabel} — 格式错误：请检查文件内容后重试`;
  if (status === 422) return `${actionLabel} — 数据校验失败，请检查文件`;
  return `${actionLabel} — 后端不可达`;
}

/** D-3d：插件贡献的工具栏按钮（payload {icon,label,action}；受控 API 调用，无任意 JS）。 */
function PluginToolbarButtons() {
  const items = usePluginSlots('editor.toolbar');
  if (items.length === 0) return null;
  return (
    <>
      {items.map((c) => {
        const action = (c.payload as { action?: { endpoint?: string; method?: string; body?: Record<string, unknown> } } | undefined)?.action;
        if (!action?.endpoint) return null;
        return (
          <Button
            key={c.id}
            size="sm"
            variant="outline"
            title={c.title}
            onClick={() => {
              const method = String(action.method ?? 'POST').toUpperCase();
              const client = getApiClient();
              const req = method === 'GET'
                ? client.get(action.endpoint!)
                : client.request({ url: action.endpoint!, method, data: action.body ?? {} });
              req.catch(() => toast(`插件操作失败：${c.title}`, 'error'));
            }}
          >
            {c.title}
          </Button>
        );
      })}
    </>
  );
}

export function EditorToolbar() {
  const navigate = useNavigate();
  const projectName = useProjectStore((s) => s.projectName);
  const setProjectName = useProjectStore((s) => s.setProjectName);
  const [editingName, setEditingName] = useState(false);
  const [draftName, setDraftName] = useState('');
  const isPlaying = usePreviewStore((s) => s.isPlaying);
  const togglePlay = usePreviewStore((s) => s.togglePlay);
  const currentTimeSec = usePreviewStore((s) => s.currentTimeSec);
  const durationSec = usePreviewStore((s) => s.durationSec);
  const fps = usePreviewStore((s) => s.fps);
  const stepForward = usePreviewStore((s) => s.stepForward);
  const stepBackward = usePreviewStore((s) => s.stepBackward);
  const seekToStart = usePreviewStore((s) => s.seekToStart);
  const seekToEnd = usePreviewStore((s) => s.seekToEnd);

  const panels = useWorkspaceStore((s) => s.panels);
  const togglePanel = useWorkspaceStore((s) => s.togglePanel);
  // 轮69 响应式 3b：<lg 时面板改为折叠抽屉，开关按钮转为抽屉开合
  const mobilePanel = useWorkspaceStore((s) => s.mobilePanel);
  const setMobilePanel = useWorkspaceStore((s) => s.setMobilePanel);
  const isDesktop = useMediaQuery('(min-width: 1024px)');
  // B10：timeline 也是可切换面板（插件下栏随之显隐）
  const panelActive = (p: 'assets' | 'properties' | 'agent' | 'timeline') =>
    isDesktop ? panels[p] : mobilePanel === p;
  const handlePanelToggle = (p: 'assets' | 'properties' | 'agent' | 'timeline') => {
    // 时间线没有抽屉形态：窄屏下也直接切可见性开关
    if (isDesktop || p === 'timeline') togglePanel(p);
    else setMobilePanel(mobilePanel === p ? null : p);
  };

  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const canUndo = useHistoryStore((s) => s.undoStack.length > 0);
  const canRedo = useHistoryStore((s) => s.redoStack.length > 0);

  // O3：undo/redo/跳转由 historyStore 自己切换时间线并恢复当时的选择，
  // 调用方不要再 setTimeline（那会用默认参数把刚恢复的选择清掉）
  const handleUndo = () => { undo(); };
  const handleRedo = () => { redo(); };

  // W7/O3: 撤销历史面板（跳转到任意历史快照 + 中文动作名 + 选中片段数 + 可重做段）
  const [historyOpen, setHistoryOpen] = useState(false);
  // 字幕导入预览（解析后先看清单与告警，再确认插入）
  const [srtPreview, setSrtPreview] = useState<{
    filename: string;
    cues: SubtitleCue[];
    warnings: SubtitleWarning[];
    summary: string;
  } | null>(null);

  const handleCopy = () => {
    const sel = useSelectionStore.getState().selectedClipIds;
    if (sel.length === 0) return;
    const store = useTimelineStore.getState();
    const found: Clip[] = [];
    for (const tr of store.timeline.tracks) {
      for (const c of tr.clips) {
        if (sel.includes(c.id)) found.push(c);
      }
    }
    if (found.length > 0) {
      // 按起始时间排序：粘贴偏移以最早的片段为锚点
      clipClipboard.clips = [...found].sort((a, b) => a.start_sec - b.start_sec);
    }
  };

  // C7: 代理工作流（生成代理 / 切换代理·原片）
  const [proxyBusy, setProxyBusy] = useState(false);
  // P2-42: 代理态持久化——旧实现每次挂载重置为 full（刷新后与实际素材不符）
  const [proxyMode, setProxyMode] = useState<'full' | 'proxy'>(() => {
    try {
      const v = localStorage.getItem('clipwright_proxy_mode');
      return v === 'proxy' ? 'proxy' : 'full';
    } catch {
      return 'full';
    }
  });
  const [proxyNotice, setProxyNotice] = useState<string | null>(null);

  const handleGenerateProxy = async () => {
    // V6: 覆盖全部视频/图片素材（原实现只取第一个 clip → 其余素材无代理 404）
    const store = useTimelineStore.getState();
    const inputPaths = new Set<string>();
    for (const tr of store.timeline.tracks) {
      for (const c of tr.clips) {
        if (c.asset_id && (c.kind === 'video' || c.kind === 'image')) inputPaths.add(c.asset_id);
      }
    }
    if (inputPaths.size === 0) { setProxyNotice('时间轴中没有视频片段，无法生成代理'); return; }
    setProxyBusy(true);
    setProxyNotice(null);
    try {
      const { proxyApi } = await import('@/services/api');
      const results = await Promise.allSettled([...inputPaths].map((p) => proxyApi.generate(p)));
      const ok = results.filter((r) => r.status === 'fulfilled').length;
      const failed = results.length - ok;
      setProxyNotice(failed > 0 ? `代理生成：${ok} 成功 / ${failed} 失败` : `已为 ${ok} 个素材生成代理`);
    } catch {
      setProxyNotice('代理生成失败（后端离线或文件不可达）');
    } finally {
      setProxyBusy(false);
    }
  };

  const handleToggleProxy = async () => {
    const store = useTimelineStore.getState();
    const tl = store.timeline;
    setProxyBusy(true);
    setProxyNotice(null);
    try {
      const { proxyApi } = await import('@/services/api');
      const next = proxyMode === 'full' ? 'proxy' : 'full';
      const result = next === 'proxy'
        ? await proxyApi.switchToProxy(tl as unknown as Record<string, unknown>)
        : await proxyApi.switchToFull(tl as unknown as Record<string, unknown>);
      useHistoryStore.getState().pushState(tl, 'proxy-switch');
      const nextTl = result as unknown as ReturnType<typeof createEmptyTimeline>;
      useTimelineStore.getState().setTimeline(nextTl);
      setProxyMode(next);
      try { localStorage.setItem('clipwright_proxy_mode', next); } catch { /* ignore */ }
      // V6: setTimeline 内部已按 URL 变化全量重注册媒体（timelineStore 旋点），
      // 切换改写的素材路径由此获得新 URL，预览不再指向旧地址
      setProxyNotice(next === 'proxy' ? '已切换到代理素材（低分辨率）' : '已切回原始素材（全分辨率）');
    } catch {
      setProxyNotice('切换失败（后端离线）');
    } finally {
      setProxyBusy(false);
    }
  };

  const handlePaste = () => {
    if (clipClipboard.clips.length === 0) return;
    const store = useTimelineStore.getState();
    const t = usePreviewStore.getState().currentTimeSec;
    useHistoryStore.getState().pushState(store.timeline, 'paste');
    for (const src of clipClipboard.clips) {
      const newId = uid('clip');
      const track = store.timeline.tracks.find((tr) => tr.id === src.track_id || tr.kind === src.kind);
      if (!track || track.locked) continue;
      store.addClip(track.id, {
        ...src,
        id: newId,
        start_sec: t + (src.start_sec - clipClipboard.clips[0].start_sec),
        asset_id: src.asset_id,
        kind: src.kind,
        keyframes: src.keyframes?.map((kf) => ({ ...kf })),
      });
    }
  };

  /**
   * 字幕导入（SRT / VTT / ASS / SSA）。
   *
   * 解析结果**先预览再插入**：畸形 cue（时间倒挂/空文本/无时间戳）逐条列出，
   * 用户能看到"哪一句会被丢掉"而不是导入后才发现少了几句；
   * cue 起止按时间线帧率对齐（O1 的 tick 换算），与播放头步进/后端 ASS 输出对得齐。
   */
  const handleSrtImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.srt,.vtt,.ass,.ssa';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const parsed = parseSubtitles(text, file.name);
      if (parsed.cues.length === 0) {
        const first = parsed.warnings[0]?.detail ?? '请检查文件是否为标准 SRT/VTT/ASS 格式';
        toast(`未解析到字幕条目：${first}`, 'error');
        return;
      }
      setSrtPreview({
        filename: file.name,
        cues: alignCuesToFrames(parsed.cues, usePreviewStore.getState().fps || 30),
        warnings: parsed.warnings,
        summary: summarizeParse(parsed),
      });
    };
    input.click();
  };

  /** 确认导入预览里的字幕（批量插入 caption 轨） */
  const commitSrtImport = () => {
    if (!srtPreview) return;
    const store = useTimelineStore.getState();
    useHistoryStore.getState().pushState(store.timeline, 'import srt');
    // 轮74：SRT 只落 caption 轨——旧实现复用已存在的 text 轨，字幕样式级联
    // （PropertiesPanel 按 trackKind === 'caption' 判断）整层失效
    let subTrack = store.timeline.tracks.find((t) => t.kind === 'caption');
    if (!subTrack) {
      const tid = store.addTrack('caption', '字幕');
      subTrack = useTimelineStore.getState().timeline.tracks.find((t) => t.id === tid);
      if (!subTrack) return;
    }
    for (const e of srtPreview.cues) {
      store.addClip(subTrack.id, {
        kind: 'caption' as const,
        asset_id: '',
        start_sec: e.start,
        duration_sec: e.end - e.start,
        source_offset_sec: 0,
        speed: 1,
        volume: 1,
        opacity: 1,
        text: e.text,
        font_size: 28,
        font_color: '#FFFFFF',
        keyframes: [],
        metadata: { title: `字幕 ${e.index}` },
      });
    }
    toast(`已导入 ${srtPreview.cues.length} 条字幕${srtPreview.warnings.length > 0 ? `（${srtPreview.warnings.length} 条告警）` : ''}`,
          srtPreview.warnings.length > 0 ? 'info' : 'success');
    setSrtPreview(null);
  };

  const handleAudioTranscribe = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.mp3,.wav,.m4a,.mp4';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const { getApiClient } = await import('@/services/api');
        const form = new FormData();
        form.append('file', file);
        const uploadRes = await getApiClient().post('/api/asset/upload', form, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        const assetPath: string = uploadRes.data?.file_path || uploadRes.data?.local_path;
        if (!assetPath) return;

        const { data } = await getApiClient().post('/api/subtitle/transcribe', {
          audio_path: assetPath,
          language: '',
          model_size: 'base',
        });
        const clips: Record<string, unknown>[] = data?.clips ?? [];
        if (clips.length === 0) return;

        const store = useTimelineStore.getState();
        useHistoryStore.getState().pushState(store.timeline, 'transcribe');
        let subTrack = store.timeline.tracks.find((t) => t.kind === 'caption' || t.kind === 'text');
        if (!subTrack) {
          const tid = store.addTrack('caption', '字幕');
          subTrack = useTimelineStore.getState().timeline.tracks.find((t) => t.id === tid);
          if (!subTrack) return;
        }
        for (const c of clips) {
          store.addClip(subTrack!.id, {
            kind: 'caption' as const,
            asset_id: '',
            start_sec: Number(c.start_sec) || 0,
            duration_sec: Math.max(0.5, Number(c.duration_sec) || 1),
            source_offset_sec: 0,
            speed: 1,
            volume: 1,
            opacity: 1,
            text: (c.text as string) ?? '',
            font_size: 28,
            font_color: '#FFFFFF',
            keyframes: [],
            metadata: { title: '字幕' },
          });
        }
      } catch (err) {
        toast(extractImportError(err, '音频转录失败'), 'error');
      }
    };
    input.click();
  };

  const handleEdlImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.edl,.fcpxml,.xml';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const isFcp = file.name.endsWith('.fcpxml') || text.trim().startsWith('<?xml');
        const { edlApi } = await import('@/services/api/edl');
        const result = isFcp ? await edlApi.importFCPXML(text) : await edlApi.importEDL(text);
        const clips = result.clips ?? [];
        // P1-28: 0 片段明确提示（旧实现静默 return——FCP X 的 <asset-clip>
        // 语法后端暂不解析，用户完全无感知）
        if (clips.length === 0) {
          toast(
            isFcp
              ? '未解析到片段：该文件可能是 FCP X 格式（asset-clip），当前仅支持 FCP 7 xmeml 语法的 fcpxml'
              : '未在文件中解析到任何片段',
            'error',
          );
          return;
        }

        const store = useTimelineStore.getState();
        useHistoryStore.getState().pushState(store.timeline, `import ${isFcp ? 'fcpxml' : 'edl'}`);
        for (const c of clips) {
          const kind = (c.kind as ClipKind) || 'video';
          let track = store.timeline.tracks.find((t) => t.kind === kind);
          if (!track) {
            const tid = store.addTrack(kind);
            track = useTimelineStore.getState().timeline.tracks.find((t) => t.id === tid);
          }
          if (!track) continue;
          const start = (c.start_sec as number) ?? (c.start as number) ?? 0;
          const dur = (c.duration_sec as number) ?? (c.duration as number) ?? 5;
          store.addClip(track.id, {
            kind,
            asset_id: (c.asset_id as string) ?? '',
            start_sec: start,
            duration_sec: Math.max(0.1, dur),
            source_offset_sec: 0,
            speed: 1,
            volume: 1,
            opacity: 1,
            metadata: { title: (c.title as string) ?? (c.name as string) ?? `${kind} clip` },
          });
        }
      } catch (err) {
        toast(extractImportError(err, 'EDL 导入失败'), 'error');
      }
    };
    input.click();
  };

  const handleEdlExport = async () => {
    const store = useTimelineStore.getState();
    const clips = store.timeline.tracks.flatMap((t) =>
      t.clips.map((c) => ({
        id: c.id,
        start_sec: c.start_sec,
        duration_sec: c.duration_sec,
        kind: c.kind,
        // P1-29: 携带源入点与素材 id——缺失让导出的 EDL 全部 00:00:00:00，
        // 无法在 NLE 里与原始素材重新链接
        source_offset_sec: c.source_offset_sec,
        asset_id: c.asset_id,
        title: c.metadata?.title as string ?? c.asset_id,
      })),
    );
    if (clips.length === 0) {
      toast('时间线为空，没有可导出的片段', 'info'); // 待验证项修复：静默→提示
      return;
    }
    try {
      const { edlApi } = await import('@/services/api/edl');
      const result = await edlApi.exportEDL(clips, store.timeline.fps);
      const blob = new Blob([result.edl], { type: 'text/plain;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${projectName || 'timeline'}.edl`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast('EDL 导出失败 — 后端不可达', 'error');
    }
  };

  const handleJsonExport = () => {
    const store = useTimelineStore.getState();
    const json = JSON.stringify(store.timeline, null, 2);
    const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName || 'timeline'}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleJsonImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        // P2-43: 校验必需字段并确认后替换——旧实现静默整体替换（坏文件
        // 也能覆盖当前时间线，且无任何提示）
        if (!data || typeof data !== 'object' || !Array.isArray(data.tracks)) {
          toast('JSON 导入失败 — 缺少 tracks 数组（不是 ClipWright 时间线文件？）', 'error');
          return;
        }
        const clipCount = data.tracks.reduce(
          (n: number, t: { clips?: unknown[] }) => n + (Array.isArray(t?.clips) ? t.clips.length : 0), 0);
        if (!window.confirm(`将用导入文件替换当前时间线（${data.tracks.length} 轨 / ${clipCount} 片段）？此操作可撤销。`)) return;
        const store = useTimelineStore.getState();
        useHistoryStore.getState().pushState(store.timeline, 'import-json');
        store.setTimeline(data);
      } catch {
        toast('JSON 导入失败 — 文件格式无效', 'error');
      }
    };
    input.click();
  };

  const handleSrtExport = () => {
    const store = useTimelineStore.getState();
    const captions = store.timeline.tracks
      .flatMap((t) => t.clips)
      // P2-44: 仅导出 caption 轨（text 轨是标题/花字，混入字幕文件语义错误）
      .filter((c) => c.kind === 'caption' && c.text?.trim())
      .sort((a, b) => a.start_sec - b.start_sec);

    // 待验证项证实并修复：空字幕导出静默无反应——给出明确提示
    if (captions.length === 0) {
      toast('没有可导出的字幕（字幕轨为空）', 'info');
      return;
    }

    let srt = '';
    captions.forEach((c, i) => {
      const idx = i + 1;
      const start = formatSrtTime(c.start_sec);
      const end = formatSrtTime(c.start_sec + c.duration_sec);
      srt += `${idx}\n${start} --> ${end}\n${c.text}\n\n`;
    });

    // P2-44: 加 UTF-8 BOM——Windows 端播放器/NLE 依赖 BOM 识别编码
    const blob = new Blob(['﻿', srt], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName || 'captions'}.srt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-surface-dim border-b border-outline-variant/30 shrink-0 overflow-x-auto">
      {srtPreview && (
        <SrtImportPreview
          data={srtPreview}
          onConfirm={commitSrtImport}
          onCancel={() => setSrtPreview(null)}
        />
      )}
      {/* Back + Logo + project name */}
      <div className="flex items-center gap-2 mr-2">
        <Tooltip side="bottom" content="返回首页">
          <button onClick={() => navigate({ to: '/' })}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <ArrowLeft className="w-4 h-4" />
          </button>
        </Tooltip>
        <div className="w-7 h-7 rounded-cw-sm bg-primary-container flex items-center justify-center">
          <Film className="w-4 h-4 text-on-primary-container" />
        </div>
        {editingName ? (
          <div className="flex items-center gap-1">
            <input
              value={draftName}
              onChange={(e) => setDraftName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setProjectName(draftName.trim() || projectName);
                  setEditingName(false);
                  useProjectStore.getState().requestSave();
                } else if (e.key === 'Escape') {
                  setEditingName(false);
                }
              }}
              autoFocus
              className="bg-surface border border-primary rounded-cw-xs px-2 py-0.5 text-title-sm font-medium text-on-surface outline-none"
            />
            <button onClick={() => { setProjectName(draftName.trim() || projectName); setEditingName(false); useProjectStore.getState().requestSave(); }}
              className="p-0.5 rounded-cw-xs text-primary hover:bg-primary/10 cursor-pointer">
              <Check className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="flex flex-col cursor-pointer" onClick={() => { setDraftName(projectName); setEditingName(true); }}>
            <span className="text-title-sm font-medium text-on-surface leading-tight hover:text-primary transition-colors">{projectName}</span>
            <span className="text-caption text-on-surface-variant leading-tight">点击重命名</span>
          </div>
        )}
      </div>

      <div className="w-px h-6 bg-outline-variant/40" />

      {/* Undo / Redo */}
      <Tooltip side="bottom" content="撤销 (Ctrl+Z)">
        <button onClick={handleUndo} disabled={!canUndo}
          className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors cursor-pointer">
          <Undo2 className="w-4 h-4" />
        </button>
      </Tooltip>
      <Tooltip side="bottom" content="重做 (Ctrl+Shift+Z)">
        <button onClick={handleRedo} disabled={!canRedo}
          className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors cursor-pointer">
          <Redo2 className="w-4 h-4" />
        </button>
      </Tooltip>
      {/* W7/O3: 历史面板 */}
      <div className="relative">
        <Tooltip side="bottom" content="历史记录">
          <button onClick={() => setHistoryOpen(!historyOpen)} disabled={!canUndo && !canRedo}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors cursor-pointer">
            <HistoryIcon className="w-4 h-4" />
          </button>
        </Tooltip>
        {historyOpen && <HistoryPanel open onClose={() => setHistoryOpen(false)} />}
      </div>
      <Tooltip side="bottom" content="复制 (Ctrl+C)">
        <button onClick={handleCopy}
          className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
          <Copy className="w-3.5 h-3.5" />
        </button>
      </Tooltip>
      <Tooltip side="bottom" content="粘贴 (Ctrl+V)">
        <button onClick={handlePaste} disabled={clipClipboard.clips.length === 0}
          className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors cursor-pointer">
          <ClipboardPaste className="w-3.5 h-3.5" />
        </button>
      </Tooltip>

      <div className="w-px h-6 bg-outline-variant/40" />

      {/* Transport controls (centered) */}
      <div className="flex-1 flex items-center justify-center gap-1">
        <Tooltip side="bottom" content="跳到开头 (Home)">
          <button onClick={seekToStart}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <SkipBack className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip side="bottom" content="上一帧 (←)">
          <button onClick={stepBackward}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <StepBack className="w-4 h-4" />
          </button>
        </Tooltip>
        <button
          onClick={togglePlay}
          className="w-10 h-10 rounded-cw-full bg-primary text-on-primary flex items-center justify-center
            hover:scale-105 active:scale-95 transition-transform duration-short3 shadow-lg shadow-primary/25 cursor-pointer"
        >
          {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5 ml-0.5" />}
        </button>
        <Tooltip side="bottom" content="下一帧 (→)">
          <button onClick={stepForward}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <StepForward className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip side="bottom" content="跳到结尾 (End)">
          <button onClick={seekToEnd}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <SkipForward className="w-4 h-4" />
          </button>
        </Tooltip>

        {/* Timecode */}
        <div className="ml-3 font-mono text-body-sm text-on-surface bg-surface-container px-3 py-1 rounded-cw-xs border border-outline-variant/30">
          <span className="text-primary">{formatTimecode(currentTimeSec, fps)}</span>
          <span className="text-on-surface-variant"> / {formatTimecode(durationSec, fps)}</span>
        </div>
      </div>

      {/* Panel toggles */}
      <div className="flex items-center gap-1">
        <Tooltip side="bottom" content="导入字幕 (SRT)">
          <button onClick={handleSrtImport}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <FileText className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip side="bottom" content="导出字幕 (SRT)">
          <button onClick={handleSrtExport}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <Download className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip side="bottom" content="音频转字幕">
          <button onClick={handleAudioTranscribe}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <Mic className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip side="bottom" content="导入 EDL/FCPXML">
          <button onClick={handleEdlImport}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <FileUp className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip side="bottom" content="导出 EDL">
          <button onClick={handleEdlExport}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <Download className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
        <Tooltip side="bottom" content="导出 Timeline JSON">
          <button onClick={handleJsonExport}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <FileJson className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
        <Tooltip side="bottom" content="导入 Timeline JSON">
          <button onClick={handleJsonImport}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <Upload className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        {/* C7: 代理工作流 */}
        <div className="flex items-center gap-0.5 px-1.5 py-1 rounded-cw-sm bg-surface-container border border-outline-variant/30 ml-1">
          <Tooltip side="bottom" content="生成代理（首个视频片段）">
            <button onClick={handleGenerateProxy} disabled={proxyBusy}
              className="p-1 rounded-cw-xs text-on-surface-variant hover:text-primary disabled:opacity-30 transition-colors cursor-pointer"
              aria-label="生成代理">
              {proxyBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Film className="w-3.5 h-3.5" />}
            </button>
          </Tooltip>
          <Tooltip side="bottom" content={proxyMode === 'full' ? '切换到代理素材' : '切回原始素材'}>
            <button onClick={handleToggleProxy} disabled={proxyBusy}
              className={`p-1 rounded-cw-xs transition-colors cursor-pointer disabled:opacity-30 ${
                proxyMode === 'proxy' ? 'text-primary bg-primary/10' : 'text-on-surface-variant hover:text-primary'
              }`}
              aria-label="切换代理/原片">
              {proxyBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : (
                <span className="text-caption font-mono px-0.5">{proxyMode === 'full' ? '原片' : '代理'}</span>
              )}
            </button>
          </Tooltip>
          {proxyNotice && (
            <span className="max-w-[160px] truncate text-caption text-on-surface-variant/80 px-1" title={proxyNotice}>
              {proxyNotice}
            </span>
          )}
        </div>
        <Tooltip side="bottom" content="素材面板">
          <button onClick={() => handlePanelToggle('assets')}
            className={`p-1.5 rounded-cw-xs transition-colors cursor-pointer ${panelActive('assets') ? 'text-primary bg-primary/10' : 'text-on-surface-variant hover:text-on-surface'}`}>
            <PanelLeft className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip side="bottom" content="Agent 副驾驶">
          <button onClick={() => handlePanelToggle('agent')}
            className={`p-1.5 rounded-cw-xs transition-colors cursor-pointer ${panelActive('agent') ? 'text-primary bg-primary/10' : 'text-on-surface-variant hover:text-on-surface'}`}>
            <Bot className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip side="bottom" content="时间线 / 插件下栏">
          <button onClick={() => handlePanelToggle('timeline')}
            className={`p-1.5 rounded-cw-xs transition-colors cursor-pointer ${panelActive('timeline') ? 'text-primary bg-primary/10' : 'text-on-surface-variant hover:text-on-surface'}`}>
            <Film className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip side="bottom" content="属性面板">
          <button onClick={() => handlePanelToggle('properties')}
            className={`p-1.5 rounded-cw-xs transition-colors cursor-pointer ${panelActive('properties') ? 'text-primary bg-primary/10' : 'text-on-surface-variant hover:text-on-surface'}`}>
            <PanelRight className="w-4 h-4" />
          </button>
        </Tooltip>

        <div className="w-px h-6 bg-outline-variant/40 mx-1" />

        <Tooltip side="bottom" content="快捷键速查 (Ctrl+/)">
          <button onClick={() => useSettingsStore.getState().setCheatSheetOpen(true)}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <Keyboard className="w-4 h-4" />
          </button>
        </Tooltip>

        {/* D-3d：插件工具栏按钮（位于内核按钮之前） */}
        <PluginToolbarButtons />

        {/* Save status indicator */}
        <SaveStatusIndicator />

        <Button size="sm" variant="outline" onClick={() => useProjectStore.getState().requestSave()}
          disabled={useProjectStore.getState().isSaving}>
          <Save className="w-3.5 h-3.5" />
          保存
        </Button>
        <Button size="sm" variant="default" onClick={() => {
          const pid = useProjectStore.getState().projectId;
          if (pid) navigate({ to: '/export/$projectId', params: { projectId: pid } });
        }}>
          导出
        </Button>
      </div>
    </div>
  );
}

interface SrtEntry { index: number; start: number; end: number; text: string; }

/**
 * 字幕导入预览弹窗（O-字幕导入）：解析后先给清单——总条数/总时长、前若干条的时间与文本、
 * 以及逐条告警（时间倒挂/空文本/无时间戳/被剥离的标签）。
 * 用户确认后才写入时间线，避免"导进去才发现少了几句"。
 */
function SrtImportPreview({
  data, onConfirm, onCancel,
}: {
  data: { filename: string; cues: SubtitleCue[]; warnings: SubtitleWarning[]; summary: string };
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const preview = data.cues.slice(0, 12);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50" data-testid="srt-preview">
      <div className="w-[520px] max-h-[70vh] flex flex-col rounded-cw-md border border-outline-variant/50 bg-surface-container-high shadow-2xl">
        <div className="px-4 py-3 border-b border-outline-variant/30">
          <p className="text-body-sm font-medium text-on-surface">导入字幕预览</p>
          <p className="text-caption text-on-surface-variant">{data.filename} · {data.summary}</p>
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1">
          {preview.map((cue) => (
            <div key={`${cue.index}-${cue.start}`} className="flex gap-2 text-caption">
              <span className="font-mono text-on-surface-variant/70 w-8 shrink-0 text-right">{cue.index}</span>
              <span className="font-mono text-primary shrink-0">
                {formatSrtTime(cue.start)} → {formatSrtTime(cue.end)}
              </span>
              <span className="text-on-surface truncate">{cue.text.replace(/\n/g, ' / ')}</span>
            </div>
          ))}
          {data.cues.length > preview.length && (
            <p className="text-caption text-on-surface-variant/60">…… 其余 {data.cues.length - preview.length} 条</p>
          )}
          {data.warnings.length > 0 && (
            <div className="mt-2 pt-2 border-t border-outline-variant/30 space-y-0.5" data-testid="srt-warnings">
              {data.warnings.slice(0, 8).map((w, i) => (
                <p key={`${w.kind}-${i}`} className="text-caption text-warn">
                  ⚠ {w.detail}
                </p>
              ))}
              {data.warnings.length > 8 && (
                <p className="text-caption text-on-surface-variant/60">…… 另有 {data.warnings.length - 8} 条告警</p>
              )}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 px-4 py-3 border-t border-outline-variant/30">
          <Button size="sm" variant="outline" onClick={onCancel}>取消</Button>
          <Button size="sm" onClick={onConfirm}>导入 {data.cues.length} 条</Button>
        </div>
      </div>
    </div>
  );
}

function SaveStatusIndicator() {
  const isSaving = useProjectStore((s) => s.isSaving);
  const lastSavedAt = useProjectStore((s) => s.lastSavedAt);
  const saveError = useProjectStore((s) => s.saveError);

  if (isSaving) {
    return (
      <span className="flex items-center gap-1 text-caption text-on-surface-variant">
        <Loader2 className="w-3 h-3 animate-spin" />
        保存中…
      </span>
    );
  }
  if (saveError) {
    return <span className="text-caption text-error">保存失败</span>;
  }
  if (lastSavedAt) {
    const time = new Date(lastSavedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    return <span className="text-caption text-on-surface-variant">已保存 {time}</span>;
  }
  return null;
}

function formatSrtTime(sec: number): string {
  // P2-44: 先整体取整毫秒再拆分——旧实现分秒各自舍入，.9999 会产出 ",1000"
  let totalMs = Math.round(sec * 1000);
  const h = Math.floor(totalMs / 3600000);
  totalMs -= h * 3600000;
  const m = Math.floor(totalMs / 60000);
  totalMs -= m * 60000;
  const s = Math.floor(totalMs / 1000);
  const ms = totalMs - s * 1000;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}
