import { useEffect, useMemo } from 'react';
import {
  Crop, Diamond, Group, History, Import, Move, PenLine, Scissors, SlidersHorizontal,
  Sparkles, Trash2, Volume2, X,
} from 'lucide-react';
import type { Timeline } from '@/types/timeline';
import { useHistoryStore } from '@/stores/historyStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { formatTimeShort } from '@/lib/utils';
import { historyIconKey, historyLabel, relativeTime } from './labels';

interface HistoryPanelProps {
  open: boolean;
  onClose: () => void;
}

const ICONS: Record<string, typeof History> = {
  import: Import,
  trash: Trash2,
  scissors: Scissors,
  trim: Crop,
  move: Move,
  group: Group,
  volume: Volume2,
  sliders: SlidersHorizontal,
  keyframe: Diamond,
  agent: Sparkles,
  edit: PenLine,
};

/** 时间线小结：轨道数 / 片段数 / 时长 */
function summarize(timeline: Timeline | null): { tracks: number; clips: number; duration: string } {
  const tracks = timeline?.tracks?.length ?? 0;
  let clips = 0;
  for (const track of timeline?.tracks ?? []) clips += track.clips.length;
  return { tracks, clips, duration: formatTimeShort(timeline?.duration_sec ?? 0) };
}

function Icon({ label }: { label: string }) {
  const Component = ICONS[historyIconKey(label)] ?? History;
  return <Component className="w-3.5 h-3.5 shrink-0 text-on-surface-variant/70" />;
}

/**
 * 历史面板（O3）。
 *
 * 与工具栏上原来那个「只列 label + 时间」的小下拉相比，这里补上：
 * - 中文动作名（`historyLabel` 映射，不改 40 处调用点的键名）；
 * - 每一步的**时间线小结与选中片段数**——知道「撤销会回到什么状态」；
 * - 可重做段（跳到旧状态后仍能一步步重做回来，见 `historyStore.jumpTo`）；
 * - 点击任一步即回到该状态，且**选择一并恢复到当时**（`historyStore` 负责）。
 */
export function HistoryPanel({ open, onClose }: HistoryPanelProps) {
  const undoStack = useHistoryStore((s) => s.undoStack);
  const redoStack = useHistoryStore((s) => s.redoStack);
  const timeline = useTimelineStore((s) => s.timeline);
  const clear = useHistoryStore((s) => s.clear);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const current = useMemo(() => summarize(timeline), [timeline]);

  if (!open) return null;

  // 跳转/重做由 historyStore 完成时间线切换与选择恢复（见 swapTimeline），
  // 这里不要再 setTimeline——默认参数会把刚恢复的选择清掉
  const handleJump = (index: number) => {
    useHistoryStore.getState().jumpTo(index);
  };

  const handleRedoTo = (index: number) => {
    useHistoryStore.getState().redoTo(index);
  };

  // 撤销列表按「最近的可撤销步骤」在上的顺序展示（栈尾 = 下一次撤销到的状态）
  const undoRows = undoStack.map((entry, i) => ({ entry, index: i })).reverse();

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} data-testid="history-scrim" />
      <div
        role="dialog"
        aria-label="历史记录"
        data-testid="history-panel"
        className="absolute left-0 top-full mt-1.5 z-50 w-[320px] bg-surface-container-high border border-outline-variant/50
          rounded-cw-md shadow-2xl shadow-black/50 overflow-hidden"
      >
        <div className="flex items-center justify-between px-3 py-2 border-b border-outline-variant/30">
          <span className="text-label font-medium text-on-surface-variant uppercase tracking-wide">
            历史记录 ({undoStack.length})
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => clear()}
              disabled={undoStack.length === 0 && redoStack.length === 0}
              className="text-caption px-1.5 py-0.5 rounded-cw-xs text-on-surface-variant hover:text-on-surface
                disabled:opacity-30 transition-colors cursor-pointer"
            >
              清空
            </button>
            <button
              onClick={onClose}
              aria-label="关闭历史记录"
              className="p-1 rounded-cw-xs text-on-surface-variant hover:text-on-surface transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        <div className="max-h-[320px] overflow-y-auto p-1.5 space-y-0.5">
          {/* 当前状态 */}
          <div
            data-testid="history-current"
            className="flex items-center gap-2 px-2 py-1.5 rounded-cw-sm bg-primary/10 border border-primary/30"
          >
            <History className="w-3.5 h-3.5 shrink-0 text-primary" />
            <span className="text-label-sm text-on-surface flex-1">当前状态</span>
            <span className="text-caption text-on-surface-variant/70 font-mono shrink-0">
              {current.tracks} 轨 · {current.clips} 片段 · {current.duration}
            </span>
          </div>

          {/* 可重做（跳到旧状态后仍能回来） */}
          {redoStack.length > 0 && (
            <div className="pt-1">
              <div className="px-2 pb-0.5 text-caption text-on-surface-variant/60 uppercase tracking-wide">
                可重做 ({redoStack.length})
              </div>
              {redoStack.map((entry, i) => ({ entry, index: i })).reverse().map(({ entry, index }) => {
                const info = summarize(entry.timeline);
                return (
                  <button
                    key={`redo-${index}`}
                    onClick={() => handleRedoTo(index)}
                    data-testid={`history-redo-${index}`}
                    className="w-full flex items-center gap-2 px-2 py-1.5 rounded-cw-sm text-left
                      hover:bg-surface transition-colors cursor-pointer opacity-80"
                  >
                    <Icon label={entry.label} />
                    <span className="text-label-sm text-on-surface truncate flex-1">
                      {historyLabel(entry.label)}
                    </span>
                    <span className="text-caption text-on-surface-variant/60 font-mono shrink-0">
                      {info.clips} 片段
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {/* 撤销列表 */}
          <div className="pt-1">
            {undoRows.length === 0 && (
              <p className="text-caption text-on-surface-variant text-center py-3">暂无历史</p>
            )}
            {undoRows.map(({ entry, index }) => {
              const info = summarize(entry.timeline);
              const selected = entry.selection?.clipIds?.length ?? 0;
              const isNext = index === undoStack.length - 1;
              return (
                <button
                  key={`undo-${index}`}
                  onClick={() => handleJump(index)}
                  data-testid={`history-undo-${index}`}
                  title={isNext ? '撤销将回到这一步' : '回到这一步'}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-cw-sm text-left transition-colors cursor-pointer
                    ${isNext ? 'bg-surface-container hover:bg-surface' : 'hover:bg-surface'}`}
                >
                  <span className="font-mono text-caption text-on-surface-variant/50 w-6 shrink-0 text-right">
                    {undoStack.length - index}
                  </span>
                  <Icon label={entry.label} />
                  <span className="text-label-sm text-on-surface truncate flex-1">
                    {historyLabel(entry.label)}
                  </span>
                  {selected > 0 && (
                    <span className="text-caption text-on-surface-variant/60 shrink-0">
                      选中 {selected}
                    </span>
                  )}
                  <span className="text-caption text-on-surface-variant/60 font-mono shrink-0">
                    {info.clips} 片段
                  </span>
                  <span className="text-caption text-on-surface-variant/50 font-mono shrink-0 w-14 text-right">
                    {relativeTime(entry.timestamp)}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="px-3 py-1.5 border-t border-outline-variant/30 text-caption text-on-surface-variant/60">
          点击任意一步回到该状态；选择会一并恢复，之后仍可重做回来
        </div>
      </div>
    </>
  );
}
