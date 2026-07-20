import React, { useCallback, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useWorkspaceStore } from '@/stores/workspaceStore';
import { AssetPanel } from '@/features/assets/AssetPanel';
import { PreviewPanel } from '@/features/preview/PreviewPanel';
import { TimelinePanel } from '@/features/timeline/components/TimelinePanel';
import { PropertiesPanel } from '@/features/properties/PropertiesPanel';
import { AgentPanel } from '@/features/agent/AgentPanel';
import { EditorToolbar } from '@/features/timeline/components/EditorToolbar';

/**
 * EditorLayout — 4-panel Premiere-style layout
 *
 * ┌──────────────────────────────────────────────────────────┐
 * │                    EditorToolbar                          │
 * ├──────────┬───────────────────────────┬───────────────────┤
 * │          │                           │                   │
 * │  Assets  │      Preview Window       │   Properties      │
 * │  Panel   │                           │   Panel           │
 * │          ├───────────────────────────┤                   │
 * │          │      Timeline Panel       │                   │
 * │          │                           │                   │
 * ├──────────┴───────────────────────────┴───────────────────┤
 * │                    Status Bar                             │
 * └──────────────────────────────────────────────────────────┘
 *
 * Agent panel docks to the right of Properties or as overlay.
 */
export function EditorLayout() {
  const { panels, panelWidths, timelineHeight, setPanelWidth, setTimelineHeight } =
    useWorkspaceStore();

  const [dragging, setDragging] = useState<'assets' | 'properties' | 'timeline' | null>(null);
  const dragStartRef = useRef({ x: 0, y: 0, w: 0, h: 0 });

  const handleDividerMouseDown = useCallback(
    (panel: 'assets' | 'properties' | 'timeline', e: React.MouseEvent) => {
      e.preventDefault();
      setDragging(panel);
      dragStartRef.current = {
        x: e.clientX,
        y: e.clientY,
        w: panel === 'assets' ? panelWidths.assets : panelWidths.properties,
        h: timelineHeight,
      };

      const handleMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - dragStartRef.current.x;
        const dy = ev.clientY - dragStartRef.current.y;
        if (panel === 'assets') {
          setPanelWidth('assets', dragStartRef.current.w + dx);
        } else if (panel === 'properties') {
          setPanelWidth('properties', dragStartRef.current.w - dx);
        } else if (panel === 'timeline') {
          setTimelineHeight(dragStartRef.current.h - dy);
        }
      };

      const handleMouseUp = () => {
        setDragging(null);
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [panelWidths, timelineHeight, setPanelWidth, setTimelineHeight],
  );

  return (
    <div className="flex flex-col h-full w-full bg-surface overflow-hidden">
      {/* Top Toolbar */}
      <EditorToolbar />

      {/* Main Content Area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Assets Panel */}
        {panels.assets && (
          <>
            <div
              className="h-full overflow-hidden shrink-0"
              style={{ width: panelWidths.assets }}
            >
              <AssetPanel />
            </div>
            <div
              className={cn('panel-divider shrink-0', dragging === 'assets' && 'bg-primary')}
              onMouseDown={(e) => handleDividerMouseDown('assets', e)}
            />
          </>
        )}

        {/* Center: Preview + Timeline */}
        <div className="flex flex-col flex-1 overflow-hidden min-w-0">
          {/* Preview */}
          <div className="flex-1 overflow-hidden min-h-0">
            <PreviewPanel />
          </div>

          {/* Timeline divider */}
          <div
            className={cn('panel-divider-h shrink-0', dragging === 'timeline' && 'bg-primary')}
            onMouseDown={(e) => handleDividerMouseDown('timeline', e)}
          />

          {/* Timeline */}
          <div
            className="shrink-0 overflow-hidden"
            style={{ height: timelineHeight }}
          >
            <TimelinePanel />
          </div>
        </div>

        {/* Right: Properties + Agent */}
        {panels.properties && (
          <>
            <div
              className={cn('panel-divider shrink-0', dragging === 'properties' && 'bg-primary')}
              onMouseDown={(e) => handleDividerMouseDown('properties', e)}
            />
            <div
              className="h-full overflow-hidden shrink-0 flex flex-col"
              style={{ width: panelWidths.properties }}
            >
              <PropertiesPanel />
            </div>
          </>
        )}

        {panels.agent && (
          <>
            <div className="panel-divider shrink-0" />
            <div
              className="h-full overflow-hidden shrink-0"
              style={{ width: panelWidths.agent }}
            >
              <AgentPanel />
            </div>
          </>
        )}
      </div>

      {/* Status Bar */}
      <StatusBar />
    </div>
  );
}

function StatusBar() {
  return (
    <div className="flex items-center justify-between px-3 py-1 bg-surface-dim border-t border-outline-variant/30 text-caption text-on-surface-variant shrink-0">
      <span>ClipWright v0.1.0</span>
      <span className="font-mono">Ready</span>
    </div>
  );
}
