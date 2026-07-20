import { useMemo, useState } from 'react';
import { computeTimelineDiff, mergeTimeline } from './timelineDiff';
import { useTimelineStore } from '@/stores/timelineStore';
import { useHistoryStore } from '@/stores/historyStore';
import { TRACK_COLORS } from '@/types/timeline';
import type { Timeline, ClipKind } from '@/types/timeline';
import { Button, Badge } from '@/components/ui';
import { Check, GitCompare, Plus, Minus, Pencil, X, Merge } from 'lucide-react';

/**
 * TimelineDiffView — reviews an Agent-proposed timeline against the current
 * one. Supports Accept All, selective Merge, and Ignore.
 */
export function TimelineDiffView({
  agentTimeline,
  onDone,
}: {
  agentTimeline: Timeline;
  onDone: () => void;
}) {
  const currentTimeline = useTimelineStore((s) => s.timeline);
  const setTimeline = useTimelineStore((s) => s.setTimeline);

  const diff = useMemo(
    () => computeTimelineDiff(currentTimeline, agentTimeline),
    [currentTimeline, agentTimeline],
  );

  // Selection state for merge mode
  const [mergeMode, setMergeMode] = useState(false);
  const [accepted, setAccepted] = useState<Set<string>>(new Set());
  const [removals, setRemovals] = useState<Set<string>>(new Set());

  const toggle = (set: Set<string>, id: string, fn: (s: Set<string>) => void) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    fn(next);
  };

  const acceptAll = () => {
    useHistoryStore.getState().pushState(currentTimeline, 'accept-agent');
    setTimeline(agentTimeline);
    onDone();
  };

  const mergeSelected = () => {
    const merged = mergeTimeline(currentTimeline, diff, accepted, removals);
    useHistoryStore.getState().pushState(currentTimeline, 'merge-agent');
    setTimeline(merged);
    onDone();
  };

  const ignore = () => onDone();

  if (diff.isEmpty) {
    return (
      <div className="bg-surface-container border border-outline-variant/30 rounded-cw-md p-4 text-center">
        <GitCompare className="w-6 h-6 text-on-surface-variant/50 mx-auto mb-2" />
        <p className="text-body-sm text-on-surface-variant">Agent 时间线与当前一致，无差异。</p>
        <Button size="sm" variant="outline" className="mt-3" onClick={ignore}>关闭</Button>
      </div>
    );
  }

  return (
    <div className="bg-surface-container border border-primary/40 rounded-cw-md overflow-hidden">
      {/* header */}
      <div className="flex items-center gap-2 px-3.5 py-2.5 bg-primary/10 border-b border-primary/25">
        <GitCompare className="w-4 h-4 text-primary" />
        <span className="text-body-sm font-semibold text-on-surface">Agent 建议的修改</span>
        <div className="ml-auto flex items-center gap-1.5">
          {diff.summary.added > 0 && <Badge variant="success">+{diff.summary.added}</Badge>}
          {diff.summary.modified > 0 && <Badge variant="info">~{diff.summary.modified}</Badge>}
          {diff.summary.removed > 0 && <Badge variant="error">-{diff.summary.removed}</Badge>}
        </div>
      </div>

      <div className="p-3 space-y-2 max-h-64 overflow-y-auto">
        {/* added */}
        {diff.addedClips.map((c) => (
          <DiffRow key={`add-${c.id}`} kind={c.kind} verb="add" label={clipName(c)}
            detail={`+${c.duration_sec.toFixed(1)}s @ ${c.start_sec.toFixed(1)}s`}
            mergeMode={mergeMode} checked={accepted.has(c.id)}
            onToggle={() => toggle(accepted, c.id, setAccepted)} />
        ))}
        {/* modified */}
        {diff.modifiedClips.map((m) => (
          <DiffRow key={`mod-${m.proposed.id}`} kind={m.proposed.kind} verb="modify" label={clipName(m.proposed)}
            detail={m.fields.slice(0, 3).join(', ') + (m.fields.length > 3 ? '…' : '')}
            mergeMode={mergeMode} checked={accepted.has(m.proposed.id)}
            onToggle={() => toggle(accepted, m.proposed.id, setAccepted)} />
        ))}
        {/* removed */}
        {diff.removedClips.map((c) => (
          <DiffRow key={`rem-${c.id}`} kind={c.kind} verb="remove" label={clipName(c)}
            detail={`-${c.duration_sec.toFixed(1)}s`}
            mergeMode={mergeMode} checked={removals.has(c.id)}
            onToggle={() => toggle(removals, c.id, setRemovals)} />
        ))}
      </div>

      {/* actions */}
      <div className="px-3 pb-3 space-y-2">
        {!mergeMode ? (
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={acceptAll}>
              <Check className="w-3.5 h-3.5" /> 全部接受
            </Button>
            <Button size="sm" variant="outline" onClick={() => setMergeMode(true)}>
              <Merge className="w-3.5 h-3.5" /> 选择合并
            </Button>
            <Button size="sm" variant="ghost" onClick={ignore}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : (
          <div className="flex gap-2">
            <Button size="sm" className="flex-1" onClick={mergeSelected}
              disabled={accepted.size + removals.size === 0}>
              <Merge className="w-3.5 h-3.5" /> 合并所选 ({accepted.size + removals.size})
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMergeMode(false)}>返回</Button>
          </div>
        )}
      </div>
    </div>
  );
}

function DiffRow({
  kind, verb, label, detail, mergeMode, checked, onToggle,
}: {
  kind: ClipKind; verb: 'add' | 'modify' | 'remove'; label: string; detail: string;
  mergeMode: boolean; checked: boolean; onToggle: () => void;
}) {
  const color = TRACK_COLORS[kind] ?? '#4F8CFF';
  const icon = verb === 'add' ? <Plus className="w-3 h-3" /> : verb === 'remove' ? <Minus className="w-3 h-3" /> : <Pencil className="w-3 h-3" />;
  const tone = verb === 'add' ? 'text-track-audio' : verb === 'remove' ? 'text-error' : 'text-primary';

  return (
    <button
      onClick={mergeMode ? onToggle : undefined}
      disabled={!mergeMode}
      className={`w-full flex items-center gap-2.5 px-2.5 py-2 rounded-cw-sm text-left transition-all duration-short3
        ${mergeMode ? 'cursor-pointer hover:bg-surface-container-high' : 'cursor-default'}
        ${mergeMode && checked ? 'bg-primary/10 border border-primary/40' : 'bg-surface border border-transparent'}`}
    >
      {mergeMode && (
        <span className={`w-4 h-4 rounded-cw-xs border flex items-center justify-center shrink-0 transition-colors
          ${checked ? 'bg-primary border-primary text-on-primary' : 'border-outline-variant'}`}>
          {checked && <Check className="w-3 h-3" />}
        </span>
      )}
      <span className={`shrink-0 ${tone}`}>{icon}</span>
      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
      <span className="text-label-sm text-on-surface truncate flex-1">{label}</span>
      <span className="text-caption font-mono text-on-surface-variant shrink-0">{detail}</span>
    </button>
  );
}

function clipName(c: { kind: ClipKind; text?: string | null; asset_id?: string; metadata?: Record<string, unknown> }): string {
  if ((c.kind === 'text' || c.kind === 'caption') && c.text) return c.text;
  if (c.metadata && typeof c.metadata.title === 'string') return c.metadata.title as string;
  return c.asset_id || c.kind;
}
