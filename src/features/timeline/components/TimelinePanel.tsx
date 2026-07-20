import { useEffect, useRef } from 'react';
import { TimelineEngine } from '../engine/TimelineEngine';
import { useTimelineStore } from '@/stores/timelineStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { usePreviewStore } from '@/stores/previewStore';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { useHistoryStore } from '@/stores/historyStore';
import { Button, Tooltip } from '@/components/ui';
import { formatTimecode } from '@/lib/utils';
import type { ClipKind } from '@/types/timeline';
import {
  Magnet, Plus, ZoomIn, ZoomOut, Maximize2, Trash2, Scissors, ChevronsLeft,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * TimelinePanel — hosts the Canvas timeline engine plus transport/track controls.
 */
export function TimelinePanel() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<TimelineEngine | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const addTrack = useTimelineStore((s) => s.addTrack);
  const removeClip = useTimelineStore((s) => s.removeClip);
  const rippleDelete = useTimelineStore((s) => s.rippleDelete);
  const splitClip = useTimelineStore((s) => s.splitClip);
  const timeline = useTimelineStore((s) => s.timeline);
  const selectedClipIds = useSelectionStore((s) => s.selectedClipIds);
  const toolMode = useSelectionStore((s) => s.toolMode);
  const setToolMode = useSelectionStore((s) => s.setToolMode);
  const snapEnabled = useSettingsStore((s) => s.snapEnabled);
  const setSnapEnabled = useSettingsStore((s) => s.setSnapEnabled);
  const currentTimeSec = usePreviewStore((s) => s.currentTimeSec);
  const fps = usePreviewStore((s) => s.fps);

  // Instantiate engine
  useEffect(() => {
    if (!canvasRef.current) return;
    const engine = new TimelineEngine(canvasRef.current);
    engineRef.current = engine;

    const handleResize = () => engine.resize();
    const ro = new ResizeObserver(handleResize);
    if (containerRef.current) ro.observe(containerRef.current);

    return () => {
      ro.disconnect();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  // Keyboard shortcuts (timeline-scoped)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      const engine = engineRef.current;
      if (!engine) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = useSelectionStore.getState().selectedClipIds;
        if (e.shiftKey) {
          // Ripple delete: close the gap
          ids.forEach((id) => rippleDelete(id));
        } else {
          ids.forEach((id) => removeClip(id));
        }
        useSelectionStore.getState().deselectAll();
      } else if (e.key.toLowerCase() === 's' && !e.ctrlKey && !e.metaKey) {
        // Split selected clips at playhead
        const t = usePreviewStore.getState().currentTimeSec;
        const ids = useSelectionStore.getState().selectedClipIds;
        ids.forEach((id) => splitClip(id, t));
      } else if (e.key.toLowerCase() === 'm') {
        engine.addMarkerAtPlayhead();
      } else if (e.key === '+' || e.key === '=') {
        engine.zoomIn();
      } else if (e.key === '-') {
        engine.zoomOut();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [removeClip, splitClip]);

  const handleAddTrack = (kind: ClipKind) => addTrack(kind);

  const handleSplitAtPlayhead = () => {
    const t = currentTimeSec;
    selectedClipIds.forEach((id) => splitClip(id, t));
  };

  const handleDelete = () => {
    selectedClipIds.forEach((id) => removeClip(id));
    useSelectionStore.getState().deselectAll();
  };

  const handleRippleDelete = () => {
    useHistoryStore.getState().pushState(useTimelineStore.getState().timeline, 'ripple-delete');
    selectedClipIds.forEach((id) => rippleDelete(id));
    useSelectionStore.getState().deselectAll();
  };

  return (
    <div className="flex flex-col h-full bg-surface-container-low">
      {/* Timeline toolbar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-outline-variant/30 shrink-0">
        <span className="text-label font-medium text-on-surface-variant mr-2 uppercase tracking-wide">
          时间轴
        </span>

        {/* Tool switcher */}
        <div className="flex items-center bg-surface-container rounded-cw-sm p-0.5 mr-2">
          <Tooltip content="选择工具 (V)">
            <button
              onClick={() => setToolMode('select')}
              className={`p-1.5 rounded-cw-xs transition-colors cursor-pointer ${
                toolMode === 'select' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 24 24"><path d="M4 2l12 16-4.5-1.5L9 22l-2.5-1 2.5-5.5L4 14V2z"/></svg>
            </button>
          </Tooltip>
          <Tooltip content="剃刀工具 (B) — 点击片段分割">
            <button
              onClick={() => setToolMode('razor')}
              className={`p-1.5 rounded-cw-xs transition-colors cursor-pointer ${
                toolMode === 'razor' ? 'bg-primary-container text-on-primary-container' : 'text-on-surface-variant hover:text-on-surface'
              }`}
            >
              <Scissors className="w-3.5 h-3.5" />
            </button>
          </Tooltip>
        </div>

        {/* Snap toggle */}
        <Tooltip content={snapEnabled ? '吸附：开 (S)' : '吸附：关'}>
          <button
            onClick={() => setSnapEnabled(!snapEnabled)}
            className={`p-1.5 rounded-cw-xs transition-colors cursor-pointer ${
              snapEnabled ? 'text-snap-guide bg-snap-guide/10' : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            <Magnet className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        {/* Split / Delete */}
        <Tooltip content="在播放头处分割 (S)">
          <button onClick={handleSplitAtPlayhead} disabled={selectedClipIds.length === 0}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface disabled:opacity-30 transition-colors cursor-pointer">
            <Scissors className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="删除选中 (Del)">
          <button onClick={handleDelete} disabled={selectedClipIds.length === 0}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-error disabled:opacity-30 transition-colors cursor-pointer">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="波纹删除 (Shift+Del) — 删除并闭合间隙">
          <button onClick={handleRippleDelete} disabled={selectedClipIds.length === 0}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-tertiary disabled:opacity-30 transition-colors cursor-pointer">
            <ChevronsLeft className="w-3.5 h-3.5" />
          </button>
        </Tooltip>

        <div className="flex-1" />

        {/* Timecode readout */}
        <span className="font-mono text-mono text-primary bg-surface-container px-2 py-0.5 rounded-cw-xs mr-2">
          {formatTimecode(currentTimeSec, fps)}
        </span>

        {/* Zoom controls */}
        <Tooltip content="缩小 (-)">
          <button onClick={() => engineRef.current?.zoomOut()}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="放大 (+)">
          <button onClick={() => engineRef.current?.zoomIn()}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
        <Tooltip content="缩放至适配">
          <button onClick={() => engineRef.current?.zoomToFit(timeline.duration_sec)}
            className="p-1.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </Tooltip>
      </div>

      {/* Canvas viewport */}
      <div
        ref={containerRef}
        className="flex-1 relative overflow-hidden min-h-0"
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-clipwright-asset')) {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData('application/x-clipwright-asset');
          if (!raw || !engineRef.current || !containerRef.current) return;
          e.preventDefault();
          try {
            const asset = JSON.parse(raw);
            const rect = containerRef.current.getBoundingClientRect();
            engineRef.current.dropAssetAt(e.clientX - rect.left, e.clientY - rect.top, asset);
          } catch { /* malformed drag payload */ }
        }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block" />
      </div>

      {/* Add track bar */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-t border-outline-variant/30 shrink-0">
        <span className="text-label-sm text-on-surface-variant mr-1">添加轨道:</span>
        {(['video', 'audio', 'text', 'image', 'caption', 'animation'] as ClipKind[]).map((kind) => (
          <button
            key={kind}
            onClick={() => handleAddTrack(kind)}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-cw-full text-label-sm
              bg-surface-container text-on-surface-variant hover:bg-primary-container hover:text-on-primary-container
              transition-colors duration-short3 cursor-pointer"
          >
            <Plus className="w-3 h-3" />
            {kindLabel(kind)}
          </button>
        ))}
        <div className="flex-1" />
        <span className="text-caption text-on-surface-variant/60 font-mono">
          {timeline.tracks.length} 轨 · {timeline.duration_sec.toFixed(1)}s · {timeline.fps}fps
        </span>
      </div>
    </div>
  );
}

function kindLabel(kind: ClipKind): string {
  const map: Record<ClipKind, string> = {
    video: '视频', audio: '音频', text: '文字', image: '图片',
    caption: '字幕', shape: '形状', waveform: '波形', animation: '动画',
  };
  return map[kind];
}
