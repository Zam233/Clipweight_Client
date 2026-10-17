import { describe, it, expect, beforeEach } from 'vitest';
import { useHistoryStore } from './historyStore';
import { useSelectionStore } from './selectionStore';
import { useTimelineStore } from './timelineStore';
import { createEmptyTimeline, createDefaultClip } from '@/types/timeline';
import type { Timeline } from '@/types/timeline';

function makeTimeline(id: string): Timeline {
  return { ...createEmptyTimeline(id), duration_sec: 5 };
}

/** Timeline with a non-cloneable value (function) inside a clip's metadata. */
function makeNonCloneableTimeline(id: string): Timeline {
  const tl = makeTimeline(id);
  return {
    ...tl,
    tracks: [
      {
        id: 'track-1',
        name: 'V1',
        kind: 'video' as const,
        index: 0,
        locked: false,
        muted: false,
        clips: [
          {
            ...createDefaultClip({ id: 'clip-1', kind: 'video', track_id: 'track-1' }),
            metadata: { bad: () => {} },
          },
        ],
      },
    ],
  };
}

describe('historyStore', () => {
  beforeEach(() => {
    useHistoryStore.setState({ undoStack: [], redoStack: [] });
    useTimelineStore.setState({ timeline: createEmptyTimeline(), isDirty: false });
  });

  it('pushState then undo returns the previous timeline and pops', () => {
    const tl1 = makeTimeline('tl-1');
    const tl2 = makeTimeline('tl-2');

    // 真实用法：编辑前把当前时间线压栈
    useTimelineStore.getState().setTimeline(tl1);
    useHistoryStore.getState().pushState(tl1);
    useTimelineStore.getState().setTimeline(tl2);
    useHistoryStore.getState().pushState(tl2);
    expect(useHistoryStore.getState().undoStack).toHaveLength(2);
    expect(useHistoryStore.getState().canUndo()).toBe(true);
    expect(useHistoryStore.getState().canRedo()).toBe(false);

    const result = useHistoryStore.getState().undo();
    expect(result?.id).toBe('tl-2'); // 返回栈顶条目（最近一次编辑前的快照）
    expect(useHistoryStore.getState().undoStack).toHaveLength(1);
    expect(useHistoryStore.getState().canUndo()).toBe(true);

    const result2 = useHistoryStore.getState().undo();
    expect(result2?.id).toBe('tl-1');
    expect(useHistoryStore.getState().undoStack).toHaveLength(0);
    expect(useHistoryStore.getState().canUndo()).toBe(false);
    expect(useHistoryStore.getState().canRedo()).toBe(true); // 撤销产生的 redo 快照
  });

  it('W17: 引用存储 — 含函数等不可克隆值的时间线也能正常入栈/撤销（不再需要 clone 防护）', () => {
    const tl1 = makeTimeline('tl-1');
    const tl2 = makeTimeline('tl-2');
    const bad = makeNonCloneableTimeline('tl-bad');

    useTimelineStore.getState().setTimeline(tl1);
    useHistoryStore.getState().pushState(tl1);
    useTimelineStore.getState().setTimeline(tl2);
    useHistoryStore.getState().pushState(tl2);

    // 引用存储：不可克隆时间线照常入栈
    expect(() => useHistoryStore.getState().pushState(bad)).not.toThrow();
    expect(useHistoryStore.getState().undoStack).toHaveLength(3);

    // 把“当前”时间线换成不可克隆值后再撤销
    useTimelineStore.setState({ timeline: bad });
    let result: Timeline | null = null;
    let threw = false;
    try {
      result = useHistoryStore.getState().undo();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    // 出栈返回栈顶条目（bad 本身），redo 快照 = 当前引用（bad）也可存储
    expect(result?.id).toBe('tl-bad');
    expect(useHistoryStore.getState().undoStack).toHaveLength(2);
    expect(useHistoryStore.getState().canUndo()).toBe(true);
    expect(useHistoryStore.getState().redoStack).toHaveLength(1);
    expect(useHistoryStore.getState().canRedo()).toBe(true);
  });

  it('W17: 引用存储 — redo 同样处理不可克隆值', () => {
    const tl1 = makeTimeline('tl-1');
    const tl2 = makeTimeline('tl-2');
    const tl3 = makeTimeline('tl-3');
    const bad = makeNonCloneableTimeline('tl-bad');

    useTimelineStore.getState().setTimeline(tl1);
    useHistoryStore.getState().pushState(tl1);
    useTimelineStore.getState().setTimeline(tl2);
    useHistoryStore.getState().pushState(tl2);
    useTimelineStore.getState().setTimeline(tl3);

    expect(useHistoryStore.getState().undo()?.id).toBe('tl-2');
    useTimelineStore.setState({ timeline: tl2 });
    expect(useHistoryStore.getState().undo()?.id).toBe('tl-1');
    expect(useHistoryStore.getState().redoStack).toHaveLength(2);
    expect(useHistoryStore.getState().canRedo()).toBe(true);

    useTimelineStore.setState({ timeline: bad });
    let result: Timeline | null = null;
    let threw = false;
    try {
      result = useHistoryStore.getState().redo();
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);

    expect(result?.id).toBe('tl-2');
    expect(useHistoryStore.getState().redoStack).toHaveLength(1);
    expect(useHistoryStore.getState().canRedo()).toBe(true);
    expect(useHistoryStore.getState().undoStack).toHaveLength(1);
    expect(useHistoryStore.getState().canUndo()).toBe(true);
  });

  it('W17: 同引用重复 push 去重', () => {
    const tl1 = makeTimeline('tl-1');
    useHistoryStore.getState().pushState(tl1);
    useHistoryStore.getState().pushState(tl1);
    useHistoryStore.getState().pushState(tl1);
    expect(useHistoryStore.getState().undoStack).toHaveLength(1);
  });

  it('W7: jumpTo 返回目标快照并丢弃其后历史', () => {
    const tl1 = makeTimeline('tl-1');
    const tl2 = makeTimeline('tl-2');
    const tl3 = makeTimeline('tl-3');
    useHistoryStore.getState().pushState(tl1);
    useHistoryStore.getState().pushState(tl2);
    useHistoryStore.getState().pushState(tl3);
    expect(useHistoryStore.getState().undoStack).toHaveLength(3);

    const result = useHistoryStore.getState().jumpTo(0); // 跳到最旧
    expect(result?.id).toBe('tl-1');
    expect(useHistoryStore.getState().undoStack).toHaveLength(0);
    expect(useHistoryStore.getState().canUndo()).toBe(false);

    // 越界返回 null
    useHistoryStore.getState().pushState(tl1);
    expect(useHistoryStore.getState().jumpTo(5)).toBeNull();
    expect(useHistoryStore.getState().jumpTo(-1)).toBeNull();
  });
});

// ── O3：选择快照 + 可重做段 ────────────────────────────

/** 带指定片段的时间线 */
function timelineWithClips(id: string, clipIds: string[], duration = 5): Timeline {
  return {
    ...createEmptyTimeline(id),
    duration_sec: duration,
    tracks: [
      {
        id: 'track-1', name: 'V1', kind: 'video' as const, index: 0,
        locked: false, muted: false,
        clips: clipIds.map((cid, i) => ({
          ...createDefaultClip({ id: cid, kind: 'video', track_id: 'track-1' }),
          start_sec: i * 2,
          duration_sec: 2,
        })),
      },
    ],
  };
}

function selectClips(ids: string[], trackId: string | null = 'track-1') {
  useSelectionStore.setState({
    selectedClipIds: ids, selectedTrackId: trackId, rangeStart: null, rangeEnd: null,
  });
}

describe('historyStore O3：选择快照', () => {
  beforeEach(() => {
    useHistoryStore.setState({ undoStack: [], redoStack: [] });
    useTimelineStore.setState({ timeline: createEmptyTimeline(), isDirty: false });
    useSelectionStore.setState({ selectedClipIds: [], selectedTrackId: null, rangeStart: null, rangeEnd: null });
  });

  it('pushState 自动抓取当前选择，undo 把它恢复回来', () => {
    const tl1 = timelineWithClips('tl-1', ['a', 'b']);
    const tl2 = timelineWithClips('tl-2', ['a']);

    useTimelineStore.getState().setTimeline(tl1);
    selectClips(['a', 'b']);
    useHistoryStore.getState().pushState(tl1, 'delete');
    // 编辑后：删掉 b，选择随之变化
    useTimelineStore.getState().setTimeline(tl2);
    selectClips(['a']);

    expect(useHistoryStore.getState().undo()).toBe(tl1);
    expect(useSelectionStore.getState().selectedClipIds).toEqual(['a', 'b']);
  });

  it('redo 同样恢复选择', () => {
    const tl1 = timelineWithClips('tl-1', ['a', 'b']);
    const tl2 = timelineWithClips('tl-2', ['a']);

    useTimelineStore.getState().setTimeline(tl1);
    selectClips(['a', 'b']);
    useHistoryStore.getState().pushState(tl1, 'delete');
    useTimelineStore.getState().setTimeline(tl2);
    selectClips(['a']);

    useHistoryStore.getState().undo();
    useTimelineStore.getState().setTimeline(tl1);
    expect(useHistoryStore.getState().redo()).toBe(tl2);
    expect(useSelectionStore.getState().selectedClipIds).toEqual(['a']);
  });

  it('恢复时裁掉已不存在的片段（不留下幽灵选择）', () => {
    const tlWithB = timelineWithClips('tl-with-b', ['a', 'b', 'c']);
    const tlWithout = timelineWithClips('tl-without', ['a']);

    useTimelineStore.getState().setTimeline(tlWithB);
    selectClips(['a', 'c']);
    useHistoryStore.getState().pushState(tlWithB, 'delete');
    useTimelineStore.getState().setTimeline(tlWithout);
    // 手动塞入一个已不属于目标时间线的 id
    selectClips(['a', 'gone']);

    useHistoryStore.getState().undo(); // 回到 tlWithB（含 a/b/c）
    expect(useSelectionStore.getState().selectedClipIds).toEqual(['a', 'c']);

    // 反向：跳到 tlWithout 时 c 不存在 → 被裁掉
    useHistoryStore.setState({
      undoStack: [{ timestamp: Date.now(), label: 'x', timeline: tlWithout,
        selection: { clipIds: ['a', 'c'], trackId: 'track-1', rangeStart: null, rangeEnd: null } }],
      redoStack: [],
    });
    useHistoryStore.getState().undo();
    expect(useSelectionStore.getState().selectedClipIds).toEqual(['a']);
  });

  it('可显式传入选择快照（覆盖自动抓取）', () => {
    const tl = timelineWithClips('tl', ['a', 'b']);
    useHistoryStore.getState().pushState(tl, 'edit', {
      clipIds: ['b'], trackId: null, rangeStart: 1, rangeEnd: 2,
    });
    selectClips(['a']);
    useHistoryStore.getState().undo();
    expect(useSelectionStore.getState().selectedClipIds).toEqual(['b']);
    expect(useSelectionStore.getState().rangeStart).toBe(1);
    expect(useSelectionStore.getState().selectedTrackId).toBeNull();
  });

  it('jumpTo 把未来状态转入可重做栈，重做可以一步步走回最新', () => {
    const tl1 = timelineWithClips('tl-1', ['a']);
    const tl2 = timelineWithClips('tl-2', ['a', 'b']);
    const tl3 = timelineWithClips('tl-3', ['a', 'b', 'c']);
    const live = timelineWithClips('tl-live', ['a', 'b', 'c', 'd']);

    useHistoryStore.getState().pushState(tl1, 'add-b');
    useHistoryStore.getState().pushState(tl2, 'add-c');
    useHistoryStore.getState().pushState(tl3, 'add-d');
    useTimelineStore.setState({ timeline: live });

    expect(useHistoryStore.getState().jumpTo(0)).toBe(tl1);
    expect(useHistoryStore.getState().undoStack).toHaveLength(0);
    // 丢弃的 2 个条目 + 当前状态 = 3 个可重做
    expect(useHistoryStore.getState().redoStack).toHaveLength(3);

    expect(useHistoryStore.getState().redo()?.id).toBe('tl-2');
    expect(useHistoryStore.getState().redo()?.id).toBe('tl-3');
    expect(useHistoryStore.getState().redo()?.id).toBe('tl-live');
    expect(useHistoryStore.getState().canRedo()).toBe(false);
    expect(useHistoryStore.getState().undoStack).toHaveLength(3);
  });

  it('redoTo(index) 直接走到可重做栈里指定的那一步', () => {
    const tl1 = timelineWithClips('tl-1', ['a']);
    const tl2 = timelineWithClips('tl-2', ['a', 'b']);
    const tl3 = timelineWithClips('tl-3', ['a', 'b', 'c']);
    const live = timelineWithClips('tl-live', ['a', 'b', 'c', 'd']);

    useHistoryStore.getState().pushState(tl1, 'x');
    useHistoryStore.getState().pushState(tl2, 'y');
    useHistoryStore.getState().pushState(tl3, 'z');
    useTimelineStore.setState({ timeline: live });
    useHistoryStore.getState().jumpTo(0);

    // redoStack 数组顺序「远 → 近」：index 0 = 最远的未来状态（跳转前的当前状态）
    const stack = useHistoryStore.getState().redoStack;
    expect(stack.map((e) => e.timeline.id)).toEqual(['tl-live', 'tl-3', 'tl-2']);

    // index 2 = 最近的一步
    expect(useHistoryStore.getState().redoTo(2)?.id).toBe('tl-2');
    // index 0 = 一路重做到最新（跳转前看到的状态）
    expect(useHistoryStore.getState().redoTo(0)?.id).toBe('tl-live');
    expect(useHistoryStore.getState().canRedo()).toBe(false);
    // 越界
    expect(useHistoryStore.getState().redoTo(3)).toBeNull();
    expect(useHistoryStore.getState().redoTo(-1)).toBeNull();
  });

  it('undo 自己完成时间线切换 + 选择恢复（调用方不需要再 setTimeline）', () => {
    const tl1 = timelineWithClips('tl-1', ['a', 'b']);
    const tl2 = timelineWithClips('tl-2', ['a']);

    useTimelineStore.getState().setTimeline(tl1);
    selectClips(['a', 'b']);
    useHistoryStore.getState().pushState(tl1, 'delete');
    useTimelineStore.getState().setTimeline(tl2);
    selectClips(['a']);

    useHistoryStore.getState().undo();
    // 时间线已由 historyStore 切回，且选择没有被 setTimeline 的 deselectAll 清掉
    expect(useTimelineStore.getState().timeline).toBe(tl1);
    expect(useSelectionStore.getState().selectedClipIds).toEqual(['a', 'b']);
  });

  it('撤销不会顺手把工具模式重置为 select', () => {
    const tl1 = timelineWithClips('tl-1', ['a']);
    useTimelineStore.getState().setTimeline(tl1);
    useHistoryStore.getState().pushState(tl1, 'split');
    useSelectionStore.setState({ toolMode: 'razor', selectedClipIds: ['a'] });

    useHistoryStore.getState().undo();
    expect(useSelectionStore.getState().toolMode).toBe('razor');
  });

  it('jumpTo 同样自己切换时间线并恢复选择', () => {
    const older = timelineWithClips('older', ['a']);
    const newer = timelineWithClips('newer', ['a', 'b']);
    useHistoryStore.getState().pushState(older, 'x', { clipIds: ['a'], trackId: null, rangeStart: null, rangeEnd: null });
    useHistoryStore.getState().pushState(newer, 'y', { clipIds: ['a', 'b'], trackId: null, rangeStart: null, rangeEnd: null });
    useTimelineStore.setState({ timeline: timelineWithClips('live', ['a']) });

    useHistoryStore.getState().jumpTo(0);
    expect(useTimelineStore.getState().timeline.id).toBe('older');
    expect(useSelectionStore.getState().selectedClipIds).toEqual(['a']);
  });

  it('undo 产生的重做条目沿用原动作名（面板显示「重做 移动」而不是「重做 redo」）', () => {
    const tl = timelineWithClips('tl', ['a']);
    useHistoryStore.getState().pushState(tl, 'move');
    useHistoryStore.getState().undo();
    expect(useHistoryStore.getState().redoStack[0].label).toBe('move');
  });

  it('clear 清空两个栈', () => {
    const tl = timelineWithClips('tl', ['a']);
    useHistoryStore.getState().pushState(tl, 'move');
    useHistoryStore.getState().undo();
    useHistoryStore.getState().clear();
    expect(useHistoryStore.getState().undoStack).toHaveLength(0);
    expect(useHistoryStore.getState().redoStack).toHaveLength(0);
  });
});

