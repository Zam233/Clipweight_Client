// @vitest-environment jsdom
/**
 * TL-11（PRD §5C P2）：旧项目/脏数据里 `clip.keyframes` 可能是 undefined，
 * 旧实现直接 `.map`/`.length` → 属性面板整体崩溃。
 * 这里用真实 store 造一个 keyframes 缺失的片段，渲染属性面板断言不抛。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

vi.mock('@/services/api', () => ({
  animationApi: { catalog: vi.fn(async () => []) },
  personaApi: {
    get: vi.fn(async () => ({})),
    list: vi.fn(async () => []),
  },
  voiceApi: { list: vi.fn(async () => []) },
}));

vi.mock('@/features/plugins/Slot', () => ({
  Slot: () => null,
}));

import { PropertiesPanel } from './PropertiesPanel';
import { useTimelineStore } from '@/stores/timelineStore';
import { useSelectionStore } from '@/stores/selectionStore';
import { createEmptyTimeline } from '@/types/timeline';

beforeEach(() => {
  useTimelineStore.getState().setTimeline(createEmptyTimeline());
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('TL-11 keyframes 缺省不崩', () => {
  it('片段 keyframes 为 undefined 时属性面板正常渲染（不抛 React 错误）', () => {
    const tid = useTimelineStore.getState().addTrack('video', 'V1');
    const cid = useTimelineStore.getState().addClip(
      tid, { kind: 'video', start_sec: 0, duration_sec: 4 })!;
    // 模拟旧项目：显式把 keyframes 抹成 undefined
    useTimelineStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        tracks: s.timeline.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => (
            c.id === cid ? ({ ...c, keyframes: undefined } as unknown as typeof c) : c
          )),
        })),
      },
    }));
    useSelectionStore.setState({
      selectedClipIds: [cid], selectedTrackId: tid, rangeStart: null, rangeEnd: null,
    });

    expect(() => render(<PropertiesPanel />)).not.toThrow();
    // 面板标题/基础字段仍在
    expect(document.body.textContent).toBeTruthy();
  });

  it('keyframes 非数组的脏值同样按空处理', () => {
    const tid = useTimelineStore.getState().addTrack('video', 'V1');
    const cid = useTimelineStore.getState().addClip(
      tid, { kind: 'video', start_sec: 0, duration_sec: 3 })!;
    useTimelineStore.setState((s) => ({
      timeline: {
        ...s.timeline,
        tracks: s.timeline.tracks.map((t) => ({
          ...t,
          clips: t.clips.map((c) => (
            c.id === cid ? ({ ...c, keyframes: { bad: true } } as unknown as typeof c) : c
          )),
        })),
      },
    }));
    useSelectionStore.setState({
      selectedClipIds: [cid], selectedTrackId: tid, rangeStart: null, rangeEnd: null,
    });
    expect(() => render(<PropertiesPanel />)).not.toThrow();
  });
});
