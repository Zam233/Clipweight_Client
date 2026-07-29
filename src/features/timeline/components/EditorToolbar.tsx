import { useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useProjectStore } from '@/stores/projectStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { Button, Tooltip } from '@/components/ui';
import { formatTimecode, uid } from '@/lib/utils';
import {
  Play, Pause, SkipBack, SkipForward, StepBack, StepForward,
  Undo2, Redo2, Save, PanelLeft, PanelRight, Bot, Settings, Film,
  FileText, ArrowLeft, Check, Loader2, Mic,
} from 'lucide-react';

/**
 * EditorToolbar — top transport + panel toggles + project actions.
 */
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

  const undo = useHistoryStore((s) => s.undo);
  const redo = useHistoryStore((s) => s.redo);
  const canUndo = useHistoryStore((s) => s.undoStack.length > 0);
  const canRedo = useHistoryStore((s) => s.redoStack.length > 0);

  const handleUndo = () => {
    const tl = undo();
    if (tl) useTimelineStore.getState().setTimeline(tl);
  };
  const handleRedo = () => {
    const tl = redo();
    if (tl) useTimelineStore.getState().setTimeline(tl);
  };

  const handleSrtImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.srt,.vtt';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      const entries = parseSrt(text);
      if (entries.length === 0) return;
      const store = useTimelineStore.getState();
      useHistoryStore.getState().pushState(store.timeline, 'import srt');
      let subTrack = store.timeline.tracks.find((t) => t.kind === 'caption' || t.kind === 'text');
      if (!subTrack) {
        const tid = store.addTrack('caption', '字幕');
        subTrack = store.timeline.tracks.find((t) => t.id === tid)!;
      }
      for (const e of entries) {
        store.addClip(subTrack!.id, {
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
    };
    input.click();
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
          subTrack = store.timeline.tracks.find((t) => t.id === tid)!;
        }
        for (const c of clips) {
          store.addClip(subTrack!.id, {
            kind: 'caption' as const,
            asset_id: '',
            start_sec: (c.start_sec as number) ?? 0,
            duration_sec: Math.max(0.5, (c.duration_sec as number) ?? 1),
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
      } catch {
        /* 离线或后端不可达时静默失败 */
      }
    };
    input.click();
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-surface-dim border-b border-outline-variant/30 shrink-0">
      {/* Back + Logo + project name */}
      <div className="flex items-center gap-2 mr-2">
        <Tooltip content="返回首页">
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
      <Tooltip content="撤销 (Ctrl+Z)">
        <button onClick={handleUndo} disabled={!canUndo}
          className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors cursor-pointer">
          <Undo2 className="w-4 h-4" />
        </button>
      </Tooltip>
      <Tooltip content="重做 (Ctrl+Shift+Z)">
        <button onClick={handleRedo} disabled={!canRedo}
          className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors cursor-pointer">
          <Redo2 className="w-4 h-4" />
        </button>
      </Tooltip>

      <div className="w-px h-6 bg-outline-variant/40" />

      {/* Transport controls (centered) */}
      <div className="flex-1 flex items-center justify-center gap-1">
        <Tooltip content="跳到开头 (Home)">
          <button onClick={seekToStart}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <SkipBack className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip content="上一帧 (←)">
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
        <Tooltip content="下一帧 (→)">
          <button onClick={stepForward}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <StepForward className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip content="跳到结尾 (End)">
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
        <Tooltip content="导入字幕 (SRT)">
          <button onClick={handleSrtImport}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <FileText className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip content="音频转字幕">
          <button onClick={handleAudioTranscribe}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <Mic className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip content="素材面板">
          <button onClick={() => togglePanel('assets')}
            className={`p-1.5 rounded-cw-xs transition-colors cursor-pointer ${panels.assets ? 'text-primary bg-primary/10' : 'text-on-surface-variant hover:text-on-surface'}`}>
            <PanelLeft className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip content="Agent 副驾驶">
          <button onClick={() => togglePanel('agent')}
            className={`p-1.5 rounded-cw-xs transition-colors cursor-pointer ${panels.agent ? 'text-primary bg-primary/10' : 'text-on-surface-variant hover:text-on-surface'}`}>
            <Bot className="w-4 h-4" />
          </button>
        </Tooltip>
        <Tooltip content="属性面板">
          <button onClick={() => togglePanel('properties')}
            className={`p-1.5 rounded-cw-xs transition-colors cursor-pointer ${panels.properties ? 'text-primary bg-primary/10' : 'text-on-surface-variant hover:text-on-surface'}`}>
            <PanelRight className="w-4 h-4" />
          </button>
        </Tooltip>

        <div className="w-px h-6 bg-outline-variant/40 mx-1" />

        {/* Save status indicator */}
        <SaveStatusIndicator />

        <Button size="sm" variant="outline" onClick={() => useProjectStore.getState().requestSave()}>
          <Save className="w-3.5 h-3.5" />
          保存
        </Button>
        <Button size="sm" variant="default" onClick={() => navigate({ to: '/export' })}>
          导出
        </Button>
      </div>
    </div>
  );
}

interface SrtEntry { index: number; start: number; end: number; text: string; }

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

function parseSrt(raw: string): SrtEntry[] {
  const normalized = raw.replace(/\r\n/g, '\n').trim();
  const blocks = normalized.split(/\n\n+/);
  const entries: SrtEntry[] = [];
  for (const block of blocks) {
    const lines = block.trim().split('\n');
    if (lines.length < 2) continue;
    const timeLine = lines[1];
    const timeMatch = timeLine.match(/(\d+):(\d+):(\d+)[.,](\d+)\s*-->\s*(\d+):(\d+):(\d+)[.,](\d+)/);
    if (!timeMatch) continue;
    const start = +timeMatch[1] * 3600 + +timeMatch[2] * 60 + +timeMatch[3] + +timeMatch[4] / 1000;
    const end = +timeMatch[5] * 3600 + +timeMatch[6] * 60 + +timeMatch[7] + +timeMatch[8] / 1000;
    const text = lines.slice(2).join('\n').replace(/<[^>]+>/g, '').trim();
    if (text) entries.push({ index: +lines[0] || entries.length + 1, start, end, text });
  }
  return entries;
}
