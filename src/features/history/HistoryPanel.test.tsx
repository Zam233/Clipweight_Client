// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { HistoryPanel } from './HistoryPanel';
import { useHistoryStore } from '@/stores/historyStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { useTimelineStore } from '@/stores/timelineStore';
import { createEmptyTimeline, createDefaultClip } from '@/types/timeline';
import type { Timeline } from '@/types/timeline';

function timelineWithClips(id: string, clipIds: string[], duration = 4): Timeline {
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

function entry(label: string, timeline: Timeline, clipIds: string[] = []) {
  return {
    label,
    timeline,
    timestamp: Date.now() - 30_000,
    selection: { clipIds, trackId: 'track-1', rangeStart: null, rangeEnd: null },
  };
}

describe('HistoryPanel', () => {
  afterEach(cleanup);

  beforeEach(() => {
    useHistoryStore.setState({ undoStack: [], redoStack: [] });
    useTimelineStore.setState({ timeline: timelineWithClips('live', ['a', 'b']), isDirty: true });
    useSelectionStore.setState({ selectedClipIds: [], selectedTrackId: null, rangeStart: null, rangeEnd: null });
  });

  it('未打开时不渲染', () => {
    render(<HistoryPanel open={false} onClose={() => {}} />);
    expect(screen.queryByTestId('history-panel')).toBeNull();
  });

  it('空历史显示提示，并展示当前状态小结', () => {
    render(<HistoryPanel open onClose={() => {}} />);
    expect(screen.getByText('暂无历史')).toBeTruthy();
    const current = screen.getByTestId('history-current');
    expect(current.textContent).toContain('1 轨');
    expect(current.textContent).toContain('2 片段');
  });

  it('列出中文动作名、片段数与选中数', () => {
    useHistoryStore.setState({
      undoStack: [
        entry('move', timelineWithClips('s1', ['a'])),
        entry('delete', timelineWithClips('s2', ['a', 'b']), ['a', 'b']),
      ],
      redoStack: [],
    });
    render(<HistoryPanel open onClose={() => {}} />);

    expect(screen.getByText('移动片段')).toBeTruthy();
    expect(screen.getByText('删除')).toBeTruthy();
    expect(screen.getByText('历史记录 (2)')).toBeTruthy();
    expect(screen.getByTestId('history-undo-1').textContent).toContain('选中 2');
    // 栈尾（下一步撤销到的状态）标记
    expect(screen.getByTestId('history-undo-1').getAttribute('title')).toBe('撤销将回到这一步');
    expect(screen.getByTestId('history-undo-0').getAttribute('title')).toBe('回到这一步');
  });

  it('点击某一步 → 时间线切回该快照，且选择一并恢复', () => {
    const target = timelineWithClips('old', ['a']);
    useHistoryStore.setState({
      undoStack: [entry('split', target, ['a'])],
      redoStack: [],
    });
    render(<HistoryPanel open onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('history-undo-0'));
    expect(useTimelineStore.getState().timeline.id).toBe('old');
    expect(useSelectionStore.getState().selectedClipIds).toEqual(['a']);
  });

  it('可重做段列出未来状态，点击可前进', () => {
    const future = timelineWithClips('future', ['a', 'b', 'c']);
    useHistoryStore.setState({
      undoStack: [entry('trim', timelineWithClips('past', ['a']))],
      redoStack: [entry('trim', future)],
    });
    render(<HistoryPanel open onClose={() => {}} />);
    expect(screen.getByText('可重做 (1)')).toBeTruthy();
    fireEvent.click(screen.getByTestId('history-redo-0'));
    expect(useTimelineStore.getState().timeline.id).toBe('future');
  });

  it('清空按钮清掉两个栈', () => {
    useHistoryStore.setState({
      undoStack: [entry('move', timelineWithClips('s1', ['a']))],
      redoStack: [entry('trim', timelineWithClips('s2', ['a']))],
    });
    render(<HistoryPanel open onClose={() => {}} />);
    fireEvent.click(screen.getByText('清空'));
    expect(useHistoryStore.getState().undoStack).toHaveLength(0);
    expect(useHistoryStore.getState().redoStack).toHaveLength(0);
  });

  it('Esc 与遮罩点击都会关闭', () => {
    const onClose = vi.fn();
    render(<HistoryPanel open onClose={onClose} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId('history-scrim'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
