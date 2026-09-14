import { create } from 'zustand';
import type { Timeline } from '@/types/timeline';
import { useSelectionStore } from './selectionStore';
import { useTimelineStore } from './timelineStore';

/** 选择快照（撤销/重做时一并恢复，O3） */
export interface SelectionSnapshot {
  clipIds: string[];
  trackId: string | null;
  rangeStart: number | null;
  rangeEnd: number | null;
}

export interface HistoryEntry {
  timestamp: number;
  label: string;
  timeline: Timeline;
  /** 该状态对应的选择（O3：撤销后选择跟着回到当时的样子） */
  selection: SelectionSnapshot;
}

interface HistoryState {
  undoStack: HistoryEntry[];
  redoStack: HistoryEntry[];
  maxSize: number;

  // Actions
  /**
   * 压入「编辑前」的时间线快照。
   *
   * `selection` 缺省时**自动抓取当前选择**（`useSelectionStore`）——所有既有调用点
   * 都是在改动之前压栈，因此在那一刻抓到的就是「改动前的选择」，撤销时原样恢复，
   * 调用方无需改动。
   */
  pushState: (timeline: Timeline, label?: string, selection?: SelectionSnapshot) => void;
  undo: () => Timeline | null;
  redo: () => Timeline | null;
  canUndo: () => boolean;
  canRedo: () => boolean;
  /** W7: 跳转到历史栈中指定索引的快照（0 = 最旧）。返回该时间线，其余状态转入可重做栈。 */
  jumpTo: (index: number) => Timeline | null;
  /** O3: 重做到可重做栈中指定索引（0 = 最远的未来状态）；返回最终时间线。 */
  redoTo: (index: number) => Timeline | null;
  clear: () => void;
}

/** 抓取当前选择（O3） */
export function captureSelection(): SelectionSnapshot {
  const s = useSelectionStore.getState();
  return {
    clipIds: [...s.selectedClipIds],
    trackId: s.selectedTrackId,
    rangeStart: s.rangeStart,
    rangeEnd: s.rangeEnd,
  };
}

/**
 * 把选择快照裁剪到目标时间线里仍然存在的片段/轨道上。
 *
 * 撤销可能会退回到「那个片段还不存在」的状态，原样恢复会让属性面板指向幽灵片段。
 */
export function pruneSelection(selection: SelectionSnapshot, timeline: Timeline | null): SelectionSnapshot {
  const clipIds = new Set<string>();
  const trackIds = new Set<string>();
  for (const track of timeline?.tracks ?? []) {
    trackIds.add(track.id);
    for (const clip of track.clips) clipIds.add(clip.id);
  }
  return {
    clipIds: (selection?.clipIds ?? []).filter((id) => clipIds.has(id)),
    trackId: selection?.trackId && trackIds.has(selection.trackId) ? selection.trackId : null,
    rangeStart: selection?.rangeStart ?? null,
    rangeEnd: selection?.rangeEnd ?? null,
  };
}

/** 把选择快照写回选择 store（裁剪后） */
export function applySelection(selection: SelectionSnapshot, timeline: Timeline | null): void {
  const pruned = pruneSelection(selection, timeline);
  useSelectionStore.setState({
    selectedClipIds: pruned.clipIds,
    selectedTrackId: pruned.trackId,
    rangeStart: pruned.rangeStart,
    rangeEnd: pruned.rangeEnd,
  });
}

/**
 * 切换时间线并把选择恢复到快照（O3）。
 *
 * 必须走 `preserveSelection`：`timelineStore.setTimeline` 默认会
 * `deselectAll()`（防悬空选择），那样刚恢复的选择会立刻被清掉。
 * 由 historyStore 自己完成切换，调用方**不要**再 `setTimeline(返回值)`——
 * 那会用默认参数再清一次选择。
 */
function swapTimeline(timeline: Timeline, selection: SelectionSnapshot): void {
  useTimelineStore.getState().setTimeline(timeline, { preserveSelection: true });
  applySelection(selection, timeline);
}

function entry(label: string, timeline: Timeline, timestamp = Date.now()): HistoryEntry {
  return { timestamp, label, timeline, selection: captureSelection() };
}

/**
 * W17: 历史快照改为引用存储（O(1)），不再每步全量 structuredClone。
 *
 * 安全前提：timelineStore 的所有变更都走不可变更新（每个 set 生成新对象，
 * 旧对象绝不被原地修改）。因此直接保存 timeline 引用即可——恢复时
 * setTimeline 会用该引用整体替换当前状态，不存在共享可变风险。
 *
 * O3 补充：每个条目同时保存**当时的选择**。undo/redo/jumpTo 会把它写回
 * selectionStore（裁剪掉已不存在的片段），因此「撤销一步」之后选框、
 * 属性面板与工具模式都回到当时的样子，而不是指向刚被撤销掉的片段。
 */
export const useHistoryStore = create<HistoryState>((set, get) => ({
  undoStack: [],
  redoStack: [],
  maxSize: 200,

  pushState: (timeline, label = 'edit', selection) => {
    // 同帧重复 push（同一引用）直接去重，避免滑杆拖动产生成百上千条历史
    const prev = get().undoStack[get().undoStack.length - 1];
    if (prev && prev.timeline === timeline) return;
    const snapshot = selection ?? captureSelection();
    set((state) => ({
      undoStack: [
        ...state.undoStack.slice(-(state.maxSize - 1)),
        { timestamp: Date.now(), label, timeline, selection: snapshot },
      ],
      redoStack: [],
    }));
  },

  undo: () => {
    const { undoStack } = get();
    if (undoStack.length === 0) return null;
    const target = undoStack[undoStack.length - 1];
    const current = useTimelineStore.getState().timeline;

    // 当前时间线引用直接入 redo 栈（引用存储，O(1)）；
    // 标签沿用目标条目——它描述的是「被撤销的那次操作」，重做/历史面板都用它显示
    set((state) => ({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, entry(target.label, current)],
    }));
    swapTimeline(target.timeline, target.selection);
    return target.timeline;
  },

  redo: () => {
    const { redoStack } = get();
    if (redoStack.length === 0) return null;
    const target = redoStack[redoStack.length - 1];
    const current = useTimelineStore.getState().timeline;

    set((state) => ({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, entry(target.label, current)],
    }));
    swapTimeline(target.timeline, target.selection);
    return target.timeline;
  },

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,

  jumpTo: (index) => {
    const { undoStack } = get();
    if (index < 0 || index >= undoStack.length) return null;
    const target = undoStack[index];
    const current = useTimelineStore.getState().timeline;
    // 跳转后，被丢弃的未来状态转入可重做栈（数组顺序「远 → 近」，redo 从尾部弹出）：
    // [当前状态, 被丢弃条目倒序] —— 因此跳到最旧之后仍能一步步重做回最新。
    const discarded = undoStack.slice(index + 1);
    const liveLabel = discarded.length > 0 ? discarded[discarded.length - 1].label : target.label;
    const future: HistoryEntry[] = [
      entry(liveLabel, current),
      ...discarded.slice().reverse(),
    ];
    set({ undoStack: undoStack.slice(0, index), redoStack: future });
    swapTimeline(target.timeline, target.selection);
    return target.timeline;
  },

  redoTo: (index) => {
    const { redoStack } = get();
    if (index < 0 || index >= redoStack.length) return null;
    let result: Timeline | null = null;
    const steps = redoStack.length - index;
    for (let i = 0; i < steps; i += 1) {
      const tl = get().redo();
      if (!tl) break;
      result = tl;
    }
    return result;
  },

  clear: () => set({ undoStack: [], redoStack: [] }),
}));
