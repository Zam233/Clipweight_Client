import { useProjectStore } from '@/stores/projectStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { Button, Tooltip } from '@/components/ui';
import { formatTimecode } from '@/lib/utils';
import {
  Play, Pause, SkipBack, SkipForward, StepBack, StepForward,
  Undo2, Redo2, Save, PanelLeft, PanelRight, Bot, Settings, Film,
} from 'lucide-react';

/**
 * EditorToolbar — top transport + panel toggles + project actions.
 */
export function EditorToolbar() {
  const projectName = useProjectStore((s) => s.projectName);
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

  return (
    <div className="flex items-center gap-2 px-3 py-2 bg-surface-dim border-b border-outline-variant/30 shrink-0">
      {/* Logo + project name */}
      <div className="flex items-center gap-2 mr-2">
        <div className="w-7 h-7 rounded-cw-sm bg-primary-container flex items-center justify-center">
          <Film className="w-4 h-4 text-on-primary-container" />
        </div>
        <div className="flex flex-col">
          <span className="text-title-sm font-medium text-on-surface leading-tight">{projectName}</span>
          <span className="text-caption text-on-surface-variant leading-tight">ClipWright 编辑器</span>
        </div>
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

        <Button size="sm" variant="outline">
          <Save className="w-3.5 h-3.5" />
          保存
        </Button>
        <Button size="sm" variant="default">
          导出
        </Button>
      </div>
    </div>
  );
}
