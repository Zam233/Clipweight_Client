import { describe, it, expect, beforeEach } from 'vitest';
import { useTimelineStore } from './timelineStore';
import { createEmptyTimeline } from '@/types/timeline';

describe('timelineStore', () => {
  beforeEach(() => {
    useTimelineStore.getState().setTimeline(createEmptyTimeline());
  });

  it('adds a track', () => {
    const id = useTimelineStore.getState().addTrack('video', 'V1');
    const tracks = useTimelineStore.getState().timeline.tracks;
    expect(tracks).toHaveLength(1);
    expect(tracks[0].id).toBe(id);
    expect(tracks[0].kind).toBe('video');
  });

  it('adds a track at a specific index (dropAssetAt insert position)', () => {
    useTimelineStore.getState().addTrack('video', 'V1');
    useTimelineStore.getState().addTrack('text', 'T1');
    // 在位置 1（两条轨道之间）插入
    const id = useTimelineStore.getState().addTrack('video', 'V2', 1);
    const tracks = useTimelineStore.getState().timeline.tracks;
    expect(tracks.map((t) => t.id)).toEqual([tracks[0].id, id, tracks[2].id]);
    expect(tracks.map((t) => t.index)).toEqual([0, 1, 2]);
    expect(tracks[1].name).toBe('V2');
  });

  it('adds a track with an out-of-range index clamped', () => {
    useTimelineStore.getState().addTrack('video');
    useTimelineStore.getState().addTrack('audio', 'A1', 99);
    const tracks = useTimelineStore.getState().timeline.tracks;
    expect(tracks).toHaveLength(2);
    expect(tracks[1].kind).toBe('audio');
  });

  it('keeps clips sorted by start_sec after addClip/moveClip', () => {
    const tid = useTimelineStore.getState().addTrack('video');
    useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 10, duration_sec: 2 });
    const mid = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 2 });
    const clips = useTimelineStore.getState().timeline.tracks[0].clips;
    expect(clips.map((c) => c.start_sec)).toEqual([0, 10]);
    // moveClip 也保持有序
    useTimelineStore.getState().moveClip(mid, tid, 5);
    const after = useTimelineStore.getState().timeline.tracks[0].clips;
    expect(after.map((c) => c.start_sec)).toEqual([5, 10]);
  });

  it('adds a clip to a track', () => {
    const tid = useTimelineStore.getState().addTrack('video');
    const cid = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 5 });
    const track = useTimelineStore.getState().timeline.tracks[0];
    expect(track.clips).toHaveLength(1);
    expect(track.clips[0].id).toBe(cid);
    expect(track.clips[0].duration_sec).toBe(5);
  });

  it('removes a clip', () => {
    const tid = useTimelineStore.getState().addTrack('video');
    const cid = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 5 });
    useTimelineStore.getState().removeClip(cid);
    expect(useTimelineStore.getState().timeline.tracks[0].clips).toHaveLength(0);
  });

  it('splits a clip into two', () => {
    const tid = useTimelineStore.getState().addTrack('video');
    const cid = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 10 });
    useTimelineStore.getState().splitClip(cid, 4);
    const clips = useTimelineStore.getState().timeline.tracks[0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[0].duration_sec).toBeCloseTo(4, 5);
    expect(clips[1].start_sec).toBeCloseTo(4, 5);
    expect(clips[1].duration_sec).toBeCloseTo(6, 5);
  });

  it('does not split outside clip bounds', () => {
    const tid = useTimelineStore.getState().addTrack('video');
    const cid = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 10 });
    useTimelineStore.getState().splitClip(cid, 20);
    expect(useTimelineStore.getState().timeline.tracks[0].clips).toHaveLength(1);
  });

  it('ripple delete closes the gap', () => {
    const tid = useTimelineStore.getState().addTrack('video');
    const a = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 5 });
    useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 5, duration_sec: 5 });
    useTimelineStore.getState().rippleDelete(a);
    const clips = useTimelineStore.getState().timeline.tracks[0].clips;
    expect(clips).toHaveLength(1);
    expect(clips[0].start_sec).toBeCloseTo(0, 5); // shifted left to close gap
  });

  it('P1-31: 波纹删除联动其它轨道（音频/字幕同步前移）', () => {
    const vid = useTimelineStore.getState().addTrack('video');
    const aud = useTimelineStore.getState().addTrack('audio');
    useTimelineStore.getState().addClip(vid, { kind: 'video', start_sec: 0, duration_sec: 5 });
    useTimelineStore.getState().addClip(vid, { kind: 'video', start_sec: 5, duration_sec: 5 });
    useTimelineStore.getState().addClip(aud, { kind: 'audio', start_sec: 5, duration_sec: 4 });
    useTimelineStore.getState().addClip(aud, { kind: 'audio', start_sec: 10, duration_sec: 2 });
    const before = useTimelineStore.getState().timeline;
    const videoFirst = before.tracks.find((t) => t.id === vid)!.clips[0];
    useTimelineStore.getState().rippleDelete(videoFirst.id);
    const after = useTimelineStore.getState().timeline;
    const audioClips = after.tracks.find((t) => t.id === aud)!.clips;
    // 窗口 [0,5) 之后的音频片段各左移 5s（5→0、10→5）
    expect(audioClips[0].start_sec).toBeCloseTo(0, 5);
    expect(audioClips[1].start_sec).toBeCloseTo(5, 5);
  });

  it('P1-31: 锁定轨不参与波纹删除联动', () => {
    const vid = useTimelineStore.getState().addTrack('video');
    const locked = useTimelineStore.getState().addTrack('audio');
    useTimelineStore.getState().addClip(vid, { kind: 'video', start_sec: 0, duration_sec: 5 });
    useTimelineStore.getState().addClip(locked, { kind: 'audio', start_sec: 5, duration_sec: 3 });
    useTimelineStore.getState().toggleTrackLock(locked);
    useTimelineStore.getState().rippleDelete(
      useTimelineStore.getState().timeline.tracks.find((t) => t.id === vid)!.clips[0].id,
    );
    const lockedClips = useTimelineStore.getState().timeline.tracks.find((t) => t.id === locked)!.clips;
    expect(lockedClips[0].start_sec).toBeCloseTo(5, 5); // 保持原位
  });

  /**
   * TL-06 验收第二句（PRD §5C）：「窗口内未删片段有明确处理」。
   * 跨轨删除组的波纹窗口可能覆盖**其它轨**未删片段——当前口径（PRD 未裁定期）：
   * 窗口内非删除组片段保持原位（不裁切不移动），只有窗口**之后**的片段统一左移。
   * 这里固定该行为，产品若改口径再更新。
   */
  it('TL-06: 波纹窗口内的未删片段保持原位（明确口径）', () => {
    const vid = useTimelineStore.getState().addTrack('video');
    const aud = useTimelineStore.getState().addTrack('audio');
    useTimelineStore.getState().addClip(vid, { kind: 'video', start_sec: 0, duration_sec: 5 });
    useTimelineStore.getState().addClip(vid, { kind: 'video', start_sec: 5, duration_sec: 5 });
    // 音频轨有一个片段横跨删除窗口 [0,5)
    useTimelineStore.getState().addClip(aud, { kind: 'audio', start_sec: 3, duration_sec: 4 });
    const before = useTimelineStore.getState().timeline;
    const videoFirst = before.tracks.find((t) => t.id === vid)!.clips[0];
    useTimelineStore.getState().rippleDelete(videoFirst.id);
    const audioClips = useTimelineStore.getState().timeline.tracks.find((t) => t.id === aud)!.clips;
    // 横跨窗口的片段保持原位（未被吞掉、未被移动）
    expect(audioClips).toHaveLength(1);
    expect(audioClips[0].start_sec).toBeCloseTo(3, 5);
    expect(audioClips[0].duration_sec).toBeCloseTo(4, 5);
  });

  it('ripple insert shifts later clips right', () => {
    const tid = useTimelineStore.getState().addTrack('video');
    useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 5, duration_sec: 5 });
    useTimelineStore.getState().rippleInsert(tid, { kind: 'video', duration_sec: 3 }, 0);
    const clips = useTimelineStore.getState().timeline.tracks[0].clips;
    expect(clips).toHaveLength(2);
    const shifted = clips.find((c) => c.start_sec > 0);
    expect(shifted?.start_sec).toBeCloseTo(8, 5); // 5 + 3
  });

  it('toggles track lock and mute', () => {
    const tid = useTimelineStore.getState().addTrack('video');
    useTimelineStore.getState().toggleTrackLock(tid);
    expect(useTimelineStore.getState().timeline.tracks[0].locked).toBe(true);
    useTimelineStore.getState().toggleTrackMute(tid);
    expect(useTimelineStore.getState().timeline.tracks[0].muted).toBe(true);
  });

  it('computes total duration from clips', () => {
    const tid = useTimelineStore.getState().addTrack('video');
    useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 12 });
    expect(useTimelineStore.getState().timeline.duration_sec).toBeCloseTo(12, 5);
  });

  it('re-reading getState after addTrack sees the new track (stale-state guard)', () => {
    // Simulate the stale-state pattern: capture snapshot BEFORE mutation
    const staleSnapshot = useTimelineStore.getState();

    // Mutate via live API (which calls set() internally)
    const tid = useTimelineStore.getState().addTrack('audio', 'A1');

    // Stale snapshot is frozen in time — its tracks array is still empty
    expect(staleSnapshot.timeline.tracks).toHaveLength(0);

    // Live re-read sees the new track
    const freshTracks = useTimelineStore.getState().timeline.tracks;
    expect(freshTracks).toHaveLength(1);
    expect(freshTracks[0].id).toBe(tid);
    expect(freshTracks[0].kind).toBe('audio');
  });

  it('finds a track by id via fresh getState (the fix)', () => {
    // This mirrors the actual code pattern after the fix:
    //   const store = useTimelineStore.getState();
    //   const tid = store.addTrack('video');
    //   const track = useTimelineStore.getState().timeline.tracks.find(t => t.id === tid);
    const store = useTimelineStore.getState();
    const tid = store.addTrack('video', 'V1');
    const track = useTimelineStore.getState().timeline.tracks.find((t) => t.id === tid);
    expect(track).toBeDefined();
    expect(track!.kind).toBe('video');
  });
});

describe('timelineStore × selectionStore 联动', () => {
  beforeEach(() => {
    useTimelineStore.getState().resetTimeline();
  });

  it('removeClip 清理对应选择，不遗留悬空引用', async () => {
    const { useSelectionStore } = await import('./selectionStore');
    const tid = useTimelineStore.getState().addTrack('video');
    const cid = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 5 });
    useSelectionStore.getState().selectClip(cid);
    expect(useSelectionStore.getState().selectedClipIds).toContain(cid);

    useTimelineStore.getState().removeClip(cid);
    expect(useSelectionStore.getState().selectedClipIds).not.toContain(cid);
  });

  it('removeTrack 清理该轨道全部 clip 的选择与 selectedTrackId', async () => {
    const { useSelectionStore } = await import('./selectionStore');
    const tid = useTimelineStore.getState().addTrack('video');
    const cid = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 5 });
    useSelectionStore.getState().selectClip(cid);
    useSelectionStore.getState().selectTrack(tid);

    useTimelineStore.getState().removeTrack(tid);
    expect(useSelectionStore.getState().selectedClipIds).toHaveLength(0);
    expect(useSelectionStore.getState().selectedTrackId).toBeNull();
  });

  it('rippleDelete 清理对应选择', async () => {
    const { useSelectionStore } = await import('./selectionStore');
    const tid = useTimelineStore.getState().addTrack('video');
    const cid = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 5 });
    useSelectionStore.getState().selectClip(cid);

    useTimelineStore.getState().rippleDelete(cid);
    expect(useSelectionStore.getState().selectedClipIds).not.toContain(cid);
  });

  it('setTimeline 同步预览时长并清空选择', async () => {
    const { useSelectionStore } = await import('./selectionStore');
    const { usePreviewStore } = await import('./previewStore');
    const tid = useTimelineStore.getState().addTrack('video');
    const cid = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 5 });
    useSelectionStore.getState().selectClip(cid);

    const tl = useTimelineStore.getState().timeline;
    useTimelineStore.getState().setTimeline({ ...tl, duration_sec: 42 });
    expect(usePreviewStore.getState().durationSec).toBe(42);
    expect(useSelectionStore.getState().selectedClipIds).toHaveLength(0);
  });
});

describe('updateTrackClips (字幕样式整层级联)', () => {
  // 状态隔离：每个用例从干净的初始状态开始，防止 store 状态泄漏
  beforeEach(() => {
    useTimelineStore.setState({ timeline: createEmptyTimeline(), isDirty: false });
  });

  it('级联：updates 应用到轨道上的全部 clip', () => {
    const tid = useTimelineStore.getState().addTrack('caption');
    useTimelineStore.getState().addClip(tid, { kind: 'caption', start_sec: 0, duration_sec: 2 });
    useTimelineStore.getState().addClip(tid, { kind: 'caption', start_sec: 2, duration_sec: 3 });

    useTimelineStore.getState().updateTrackClips(tid, { stroke_width: 4, font_weight: 'bold' });

    const clips = useTimelineStore.getState().timeline.tracks[0].clips;
    expect(clips).toHaveLength(2);
    for (const c of clips) {
      expect(c.stroke_width).toBe(4);
      expect(c.font_weight).toBe('bold');
    }
  });

  it('无该轨道：幂等且不抛错，其他轨道不受影响', () => {
    const tid = useTimelineStore.getState().addTrack('caption');
    useTimelineStore.getState().addClip(tid, { kind: 'caption', start_sec: 0, duration_sec: 5 });

    expect(() => {
      useTimelineStore.getState().updateTrackClips('no_such_track', { stroke_width: 4 });
    }).not.toThrow();

    const track = useTimelineStore.getState().timeline.tracks[0];
    expect(track.clips[0].stroke_width).toBeNull();
    expect(useTimelineStore.getState().timeline.duration_sec).toBeCloseTo(5, 5);
  });

  it('仅更新目标轨道，不影响其他轨道 clip', () => {
    const captionTid = useTimelineStore.getState().addTrack('caption');
    const textTid = useTimelineStore.getState().addTrack('text');
    useTimelineStore.getState().addClip(captionTid, { kind: 'caption', start_sec: 0, duration_sec: 2 });
    useTimelineStore.getState().addClip(textTid, { kind: 'text', start_sec: 0, duration_sec: 2 });

    useTimelineStore.getState().updateTrackClips(captionTid, { stroke_width: 4 });

    const captionClip = useTimelineStore.getState().timeline.tracks.find((t) => t.id === captionTid)!.clips[0];
    const textClip = useTimelineStore.getState().timeline.tracks.find((t) => t.id === textTid)!.clips[0];
    expect(captionClip.stroke_width).toBe(4);
    expect(textClip.stroke_width).toBeNull();
  });

  it('时长重算：更新 duration_sec 后 timeline.duration_sec 随之更新，且置 isDirty', () => {
    const tid = useTimelineStore.getState().addTrack('caption');
    useTimelineStore.getState().addClip(tid, { kind: 'caption', start_sec: 0, duration_sec: 2 });
    useTimelineStore.getState().addClip(tid, { kind: 'caption', start_sec: 2, duration_sec: 3 });
    expect(useTimelineStore.getState().timeline.duration_sec).toBeCloseTo(5, 5);

    useTimelineStore.getState().updateTrackClips(tid, { duration_sec: 8 });

    // max(0+8, 2+8) = 10
    expect(useTimelineStore.getState().timeline.duration_sec).toBeCloseTo(10, 5);
    expect(useTimelineStore.getState().isDirty).toBe(true);
  });

  it('M8 setTimelineMarkers 写入标记并置 isDirty（引擎变更回调持久化路径）', () => {
    const before = useTimelineStore.getState().isDirty;
    useTimelineStore.getState().setTimelineMarkers([{ time: 1.5, name: '片头' }, { time: 12 }]);
    const st = useTimelineStore.getState();
    expect(st.timeline.markers).toEqual([{ time: 1.5, name: '片头' }, { time: 12 }]);
    expect(st.isDirty).toBe(true);
    // reset 后回到空列表
    useTimelineStore.getState().resetTimeline();
    expect(useTimelineStore.getState().timeline.markers).toEqual([]);
    expect(before).toBe(false);
  });

  it('M8 createEmptyTimeline 默认含空 markers（兼容旧数据加载）', () => {
    const tl = useTimelineStore.getState().timeline;
    expect(tl.markers).toEqual([]);
  });
});

describe('timelineStore M1 (rolling/slip/slide 编辑族)', () => {
  beforeEach(() => {
    useTimelineStore.getState().setTimeline(createEmptyTimeline());
  });

  function threeClips() {
    const tid = useTimelineStore.getState().addTrack('video', 'V1');
    const c1 = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 4 });
    const c2 = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 4, duration_sec: 5 });
    const c3 = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 9, duration_sec: 3 });
    return { tid, c1, c2, c3 };
  }

  it('rollingTrim edge=start：边界此消彼长，总时长不变', () => {
    const { c1, c2 } = threeClips();
    useTimelineStore.getState().rollingTrim(c2, -1, 'start');
    const clips = useTimelineStore.getState().timeline.tracks[0].clips;
    const a = clips.find((c) => c.id === c1)!;
    const b = clips.find((c) => c.id === c2)!;
    expect(b.start_sec).toBeCloseTo(3, 5); // 前移 1s
    expect(b.duration_sec).toBeCloseTo(6, 5); // 加长 1s
    expect(a.duration_sec).toBeCloseTo(3, 5); // 前片段缩短 1s
    expect(useTimelineStore.getState().timeline.duration_sec).toBeCloseTo(12, 5); // 总长不变
  });

  it('rollingTrim edge=end：后片段起点对向移动', () => {
    const { c2, c3 } = threeClips();
    useTimelineStore.getState().rollingTrim(c2, 1, 'end');
    const clips = useTimelineStore.getState().timeline.tracks[0].clips;
    const b = clips.find((c) => c.id === c2)!;
    const d = clips.find((c) => c.id === c3)!;
    expect(b.duration_sec).toBeCloseTo(6, 5); // 加长 1s
    expect(d.start_sec).toBeCloseTo(10, 5); // 后片段起点后移 1s
    expect(d.duration_sec).toBeCloseTo(2, 5); // 后片段缩短 1s
  });

  it('rollingTrim 边界钳制：不能把片段缩到 <0.1s', () => {
    const { c2 } = threeClips();
    useTimelineStore.getState().rollingTrim(c2, 99, 'end'); // 后片段仅 3s，最多缩 2.9s
    const clips = useTimelineStore.getState().timeline.tracks[0].clips;
    const b = clips.find((c) => c.id === c2)!;
    expect(b.duration_sec).toBeCloseTo(5 + 2.9, 5); // c2 原时长 5s
  });

  it('slipClip：位置时长不变，素材偏移平移', () => {
    const { c2 } = threeClips();
    const before = useTimelineStore.getState().getClip(c2)!;
    useTimelineStore.getState().slipClip(c2, 0.5);
    const after = useTimelineStore.getState().getClip(c2)!;
    expect(after.start_sec).toBe(before.start_sec);
    expect(after.duration_sec).toBe(before.duration_sec);
    expect(after.source_offset_sec).toBeCloseTo(before.source_offset_sec + 0.5, 5);
    // 负方向钳制到 0
    useTimelineStore.getState().slipClip(c2, -999);
    expect(useTimelineStore.getState().getClip(c2)!.source_offset_sec).toBe(0);
  });

  it('slideClip：移动片段 + 相邻伸缩补位，总时长不变', () => {
    const { c1, c2, c3 } = threeClips();
    useTimelineStore.getState().slideClip(c2, -1);
    const clips = useTimelineStore.getState().timeline.tracks[0].clips;
    const a = clips.find((c) => c.id === c1)!;
    const b = clips.find((c) => c.id === c2)!;
    const d = clips.find((c) => c.id === c3)!;
    expect(b.start_sec).toBeCloseTo(3, 5); // 自身左移 1s
    expect(b.duration_sec).toBeCloseTo(5, 5); // 自身时长不变
    expect(a.duration_sec).toBeCloseTo(3, 5); // 前片段缩短 1s
    expect(d.start_sec).toBeCloseTo(8, 5); // 后片段整体左移 1s
    expect(d.duration_sec).toBeCloseTo(4, 5); // 后片段加长 1s
    expect(useTimelineStore.getState().timeline.duration_sec).toBeCloseTo(12, 5);
  });

  it('slideClip 边界钳制：首片段无前邻时后移受限', () => {
    const { c1 } = threeClips();
    useTimelineStore.getState().slideClip(c1, 1);
    const b = useTimelineStore.getState().getClip(c1)!;
    // 首片段前移 1s → 被 0 边界钳制
    expect(b.start_sec).toBeCloseTo(0, 5);
  });

  /**
   * TL-02（PRD §5C P1）：旧实现把 prev/next 的可压缩量对调，
   * A(0s,10s) / B(10s,1s) / C(11s,1s) 把 B 大幅右移时 C 会变成负时长。
   * 修正后：右移受 next 可压缩量限制，任意方向邻居时长恒 ≥0.1s。
   */
  it('slideClip TL-02：大幅右移不会把后邻居压成负时长', () => {
    const tid = useTimelineStore.getState().addTrack('video', 'V1');
    const A = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 10 });
    const B = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 10, duration_sec: 1 });
    const C = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 11, duration_sec: 1 });

    useTimelineStore.getState().slideClip(B, 9.9);

    const a = useTimelineStore.getState().getClip(A)!;
    const b = useTimelineStore.getState().getClip(B)!;
    const c = useTimelineStore.getState().getClip(C)!;
    // C 最多被压缩到 0.1s，绝不出现负时长
    expect(c.duration_sec).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(a.duration_sec).toBeGreaterThan(0);
    expect(b.duration_sec).toBeCloseTo(1, 5);
    // 同轨片段不得重叠
    expect(b.start_sec + b.duration_sec).toBeLessThanOrEqual(c.start_sec + 1e-9);
  });

  it('slideClip TL-02：大幅左移不会把前邻居压成负时长', () => {    const tid = useTimelineStore.getState().addTrack('video', 'V1');
    const A = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 1 });
    const B = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 1, duration_sec: 1 });
    const C = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 2, duration_sec: 10 });

    useTimelineStore.getState().slideClip(B, -9.9);

    const a = useTimelineStore.getState().getClip(A)!;
    expect(a.duration_sec).toBeGreaterThanOrEqual(0.1 - 1e-9);
    const all = useTimelineStore.getState().timeline.tracks[0].clips;
    for (const clip of all) expect(clip.duration_sec).toBeGreaterThanOrEqual(0.1 - 1e-9);
    // 左移的位移由 prev 缩短 + next 加长共同吸收，总时长保持 12s 不变
    const total = all.reduce((m, c) => Math.max(m, c.start_sec + c.duration_sec), 0);
    expect(total).toBeCloseTo(12, 5);
  });
});

// TL-02 / W08：slide 正向按 next 可压缩量、反向按 prev 可压缩量钳制。
// 旧实现把两项对调，A(10s)/B(1s)/C(1s) 大幅右移会把 C 压成负时长。
describe('TL-02: slideClip 邻接钳制（不产生负时长/重叠）', () => {
  beforeEach(() => {
    useTimelineStore.getState().setTimeline(createEmptyTimeline());
  });

  // A(0s,10s) / B(10s,1s) / C(11s,1s)
  function abc() {
    const tid = useTimelineStore.getState().addTrack('video', 'V1');
    const a = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 10 });
    const b = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 10, duration_sec: 1 });
    const c = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 11, duration_sec: 1 });
    return { a, b, c };
  }

  it('大幅右移 B：C 恒 >=0.1s，绝不产生负时长/重叠（正向受 next 可压缩量限制）', () => {
    const { a, b, c } = abc();
    useTimelineStore.getState().slideClip(b, 99);
    const clips = useTimelineStore.getState().timeline.tracks[0].clips;
    const A = clips.find((x) => x.id === a)!;
    const B = clips.find((x) => x.id === b)!;
    const C = clips.find((x) => x.id === c)!;
    // 右移时 C 被压缩，最多压到 0.1s（next 可压缩量 = 1 - 0.1 = 0.9）
    expect(C.duration_sec).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(C.duration_sec).toBeCloseTo(0.1, 5);
    expect(C.start_sec).toBeCloseTo(B.start_sec + B.duration_sec, 5); // 紧密相邻
    expect(A.duration_sec).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(B.duration_sec).toBeCloseTo(1, 5); // 自身时长不变
    expect(B.start_sec).toBeLessThanOrEqual(10 + 0.9 + 1e-9); // 右移被 0.9s 钳住
    // 全部片段时长非负且首尾相接，无重叠
    expect(clips.every((x) => x.duration_sec >= 0.1 - 1e-9)).toBe(true);
  });

  it('大幅左移 B：A 恒 >=0.1s，绝不产生负时长/重叠（反向受 prev 可压缩量限制）', () => {
    const { a, b, c } = abc();
    useTimelineStore.getState().slideClip(b, -99);
    const clips = useTimelineStore.getState().timeline.tracks[0].clips;
    const A = clips.find((x) => x.id === a)!;
    const B = clips.find((x) => x.id === b)!;
    const C = clips.find((x) => x.id === c)!;
    // 左移时 A 被压缩，最多压到 0.1s（prev 可压缩量 = 10 - 0.1 = 9.9）
    expect(A.duration_sec).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(A.duration_sec).toBeCloseTo(0.1, 5);
    expect(B.start_sec).toBeCloseTo(A.start_sec + A.duration_sec, 5); // 紧密相邻
    expect(C.duration_sec).toBeGreaterThanOrEqual(0.1 - 1e-9);
    expect(B.duration_sec).toBeCloseTo(1, 5);
    expect(B.start_sec).toBeGreaterThanOrEqual(10 - 9.9 - 1e-9);
    expect(clips.every((x) => x.duration_sec >= 0.1 - 1e-9)).toBe(true);
  });

  it('任意方向邻居时长恒 >=0.1s（随机方向极值不产生重叠）', () => {
    const { a, b, c } = abc();
    for (const d of [99, -99, 0.5, -0.5, 9.9, -9.9]) {
      useTimelineStore.getState().setTimeline(createEmptyTimeline());
      const ids = abc();
      useTimelineStore.getState().slideClip(ids.b, d);
      const clips = useTimelineStore.getState().timeline.tracks[0].clips;
      expect(clips).toHaveLength(3);
      const sorted = [...clips].sort((x, y) => x.start_sec - y.start_sec);
      for (const x of sorted) expect(x.duration_sec).toBeGreaterThanOrEqual(0.1 - 1e-9);
      // 相邻片段首尾相接，不重叠
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i].start_sec).toBeGreaterThanOrEqual(sorted[i - 1].start_sec + sorted[i - 1].duration_sec - 1e-9);
      }
    }
    void a; void b; void c;
  });
});

describe('timelineStore TL-05 (锁定轨写入守卫)', () => {
  beforeEach(() => {
    useTimelineStore.getState().setTimeline(createEmptyTimeline());
  });

  function lockedTrackWithClip() {
    const tid = useTimelineStore.getState().addTrack('video', 'V1');
    const cid = useTimelineStore.getState().addClip(
      tid, { kind: 'video', start_sec: 0, duration_sec: 4 })!;
    useTimelineStore.getState().toggleTrackLock(tid);
    return { tid, cid };
  }

  /**
   * TL-05（PRD §5C P2）：锁定轨上的片段此前仍可被属性面板 updateClip、
   * 删除与切分直接改写（store 不查锁定，只靠 UI 自觉）。
   * 这里把守卫下沉到 store，UI 绕不绕都改不动。
   */
  it('updateClip 不动锁定轨上的片段', () => {
    const { cid } = lockedTrackWithClip();
    const before = useTimelineStore.getState().getClip(cid)!;
    useTimelineStore.getState().updateClip(cid, { duration_sec: 99, opacity: 0.1 });
    const after = useTimelineStore.getState().getClip(cid)!;
    expect(after.duration_sec).toBeCloseTo(before.duration_sec, 5);
    expect(after.opacity).toBe(before.opacity);
  });

  it('removeClip 不删除锁定轨上的片段', () => {
    const { cid } = lockedTrackWithClip();
    useTimelineStore.getState().removeClip(cid);
    expect(useTimelineStore.getState().getClip(cid)).toBeTruthy();
  });

  it('splitClip 不动锁定轨上的片段', () => {
    const { tid, cid } = lockedTrackWithClip();
    useTimelineStore.getState().splitClip(cid, 2);
    const track = useTimelineStore.getState().timeline.tracks.find((t) => t.id === tid)!;
    expect(track.clips).toHaveLength(1);
    expect(track.clips[0].duration_sec).toBeCloseTo(4, 5);
  });

  it('解锁后同一片段可正常编辑（守卫只针对锁定态）', () => {
    const { tid, cid } = lockedTrackWithClip();
    useTimelineStore.getState().toggleTrackLock(tid);
    useTimelineStore.getState().updateClip(cid, { duration_sec: 6 });
    expect(useTimelineStore.getState().getClip(cid)!.duration_sec).toBeCloseTo(6, 5);
  });
});

describe('timelineStore M2 (编组)', () => {
  beforeEach(() => {
    useTimelineStore.getState().setTimeline(createEmptyTimeline());
  });

  function twoClipsOnTracks() {
    const v1 = useTimelineStore.getState().addTrack('video', 'V1');
    const v2 = useTimelineStore.getState().addTrack('video', 'V2');
    const a = useTimelineStore.getState().addClip(v1, { kind: 'video', start_sec: 0, duration_sec: 3 });
    const b = useTimelineStore.getState().addClip(v2, { kind: 'video', start_sec: 0, duration_sec: 3 });
    return { a, b };
  }

  it('groupClips 赋予同一 group_id；getGroupClipIds 返回全组', () => {
    const { a, b } = twoClipsOnTracks();
    const gid = useTimelineStore.getState().groupClips([a, b])!;
    expect(gid).toBeTruthy();
    expect(useTimelineStore.getState().getClip(a)!.group_id).toBe(gid);
    expect(useTimelineStore.getState().getClip(b)!.group_id).toBe(gid);
    expect(useTimelineStore.getState().getGroupClipIds(a).sort()).toEqual([a, b].sort());
    expect(useTimelineStore.getState().getGroupClipIds(a)).toHaveLength(2);
  });

  it('少于 2 个片段不成组', () => {
    const { a } = twoClipsOnTracks();
    expect(useTimelineStore.getState().groupClips([a])).toBeNull();
    expect(useTimelineStore.getState().getClip(a)!.group_id).toBeNull();
  });

  it('ungroupClips 清除指定片段的组', () => {
    const { a, b } = twoClipsOnTracks();
    useTimelineStore.getState().groupClips([a, b]);
    useTimelineStore.getState().ungroupClips([a]);
    expect(useTimelineStore.getState().getClip(a)!.group_id).toBeNull();
    expect(useTimelineStore.getState().getClip(b)!.group_id).toBeTruthy();
    expect(useTimelineStore.getState().getGroupClipIds(b)).toEqual([b]);
  });

  it('合并组：新片段加入已有组时沿用组 id', () => {
    const { a, b } = twoClipsOnTracks();
    const v3 = useTimelineStore.getState().addTrack('video', 'V3');
    const c = useTimelineStore.getState().addClip(v3, { kind: 'video', start_sec: 5, duration_sec: 2 });
    const gid = useTimelineStore.getState().groupClips([a, b])!;
    useTimelineStore.getState().groupClips([b, c]);
    expect(useTimelineStore.getState().getClip(c)!.group_id).toBe(gid);
    expect(useTimelineStore.getState().getGroupClipIds(c)).toHaveLength(3);
  });
});

describe('timelineStore C3 (嵌套序列)', () => {
  beforeEach(() => {
    useTimelineStore.getState().setTimeline(createEmptyTimeline());
  });

  function threeClips() {
    const tid = useTimelineStore.getState().addTrack('video', 'V1');
    const c1 = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 2, duration_sec: 4 });
    const c2 = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 6, duration_sec: 5 });
    const c3 = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 11, duration_sec: 3 });
    return { tid, c1, c2, c3 };
  }

  it('createNestedSequence：折叠 2+ 片段为嵌套片段（保留相对时间）', () => {
    const { tid, c1, c2, c3 } = threeClips();
    const nestId = useTimelineStore.getState().createNestedSequence([c1, c2])!;
    expect(nestId).toBeTruthy();
    const st = useTimelineStore.getState();
    const nest = st.getClip(nestId)!;
    expect(nest.nested_timeline).toBeTruthy();
    // 起点 = 最小起点（2s），时长 = 总跨度（2→11 = 9s）
    expect(nest.start_sec).toBeCloseTo(2, 5);
    expect(nest.duration_sec).toBeCloseTo(9, 5);
    // 原片段被移除
    expect(st.getClip(c1)).toBeUndefined();
    expect(st.getClip(c2)).toBeUndefined();
    // 未选中的 c3 保留
    expect(st.getClip(c3)).toBeTruthy();
    // 子时间线内的相对时间：c2 相对 2s 起点 → 4s
    const nestedClips = nest.nested_timeline!.tracks.flatMap((t) => t.clips);
    expect(nestedClips.some((c) => Math.abs(c.start_sec - 4) < 0.001)).toBe(true);
    expect(nestedClips.some((c) => Math.abs(c.start_sec - 0) < 0.001)).toBe(true);
  });

  it('createNestedSequence：少于 2 个片段返回 null', () => {
    const { c1 } = threeClips();
    expect(useTimelineStore.getState().createNestedSequence([c1])).toBeNull();
  });

  it('expandNestedSequence：子片段平铺回原轨道并删除嵌套片段', () => {
    const { c1, c2 } = threeClips();
    const nestId = useTimelineStore.getState().createNestedSequence([c1, c2])!;
    useTimelineStore.getState().expandNestedSequence(nestId);
    const st = useTimelineStore.getState();
    expect(st.getClip(nestId)).toBeUndefined();
    const clips = st.timeline.tracks.flatMap((t) => t.clips);
    // 平铺回 2 个子片段（相对时间 + 父起点）
    expect(clips.length).toBe(3); // 2 个展开 + 原 c3
    const starts = clips.map((c) => c.start_sec).sort((a, b) => a - b);
    expect(starts[0]).toBeCloseTo(2, 5);
    expect(starts[1]).toBeCloseTo(6, 5);
  });

  /**
   * TL-07（PRD §5C P2）：跨类型（视频+音频）嵌套序列展开后必须回到**各自类型
   * 的轨道**——旧实现全部平铺到父轨单轨，视频/音频混轨、同轨重叠。
   */
  it('TL-07: 跨类型嵌套展开回到各自轨道，不混轨不重叠', () => {
    const vid = useTimelineStore.getState().addTrack('video', 'V1');
    const aud = useTimelineStore.getState().addTrack('audio', 'A1');
    const v = useTimelineStore.getState().addClip(vid, { kind: 'video', start_sec: 0, duration_sec: 4 });
    const a = useTimelineStore.getState().addClip(aud, { kind: 'audio', start_sec: 2, duration_sec: 3 });

    const nestId = useTimelineStore.getState().createNestedSequence([v, a])!;
    expect(nestId).toBeTruthy();
    useTimelineStore.getState().expandNestedSequence(nestId);

    const st = useTimelineStore.getState();
    const videoTrack = st.timeline.tracks.find((t) => t.kind === 'video')!;
    const audioTrack = st.timeline.tracks.find((t) => t.kind === 'audio')!;
    // 视频轨只有视频片段、音频轨只有音频片段（不混轨）
    expect(videoTrack.clips.every((c) => c.kind === 'video')).toBe(true);
    expect(audioTrack.clips.every((c) => c.kind === 'audio')).toBe(true);
    expect(videoTrack.clips).toHaveLength(1);
    expect(audioTrack.clips).toHaveLength(1);
    // 位置正确（父起点 0 + 相对时间）
    expect(videoTrack.clips[0].start_sec).toBeCloseTo(0, 5);
    expect(audioTrack.clips[0].start_sec).toBeCloseTo(2, 5);
    // 同轨内无重叠
    for (const t of st.timeline.tracks) {
      const sorted = [...t.clips].sort((x, y) => x.start_sec - y.start_sec);
      for (let i = 1; i < sorted.length; i += 1) {
        expect(sorted[i].start_sec).toBeGreaterThanOrEqual(
          sorted[i - 1].start_sec + sorted[i - 1].duration_sec - 1e-9);
      }
    }
  });
});

describe('轮73: 修剪左边界不越过同轨前一片段', () => {
  beforeEach(() => {
    useTimelineStore.getState().setTimeline(createEmptyTimeline());
  });

  it('trimClipStart 拉向左时被前片段结尾钳制（不产生重叠）', () => {
    const tid = useTimelineStore.getState().addTrack('video', 'V1');
    useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 4 });
    const c2 = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 4, duration_sec: 5 });

    useTimelineStore.getState().trimClipStart(c2, 1); // 试图拉到 1s（越过前片段结尾 4s）

    const clip = useTimelineStore.getState().getClip(c2)!;
    expect(clip.start_sec).toBe(4);
    expect(clip.duration_sec).toBe(5);
  });

  it('无前邻片段时可正常向左扩展', () => {
    const tid = useTimelineStore.getState().addTrack('video', 'V1');
    const c1 = useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 2, duration_sec: 4 });

    useTimelineStore.getState().trimClipStart(c1, 0.5);

    const clip = useTimelineStore.getState().getClip(c1)!;
    expect(clip.start_sec).toBeCloseTo(0.5, 5);
    expect(clip.duration_sec).toBeCloseTo(5.5, 5);
  });
});

describe('轮75: 未保存标记', () => {
  beforeEach(() => {
    useTimelineStore.getState().setTimeline(createEmptyTimeline());
  });

  it('编辑后 isDirty=true，markSaved 后复位', () => {
    const tid = useTimelineStore.getState().addTrack('video', 'V1');
    expect(useTimelineStore.getState().isDirty).toBe(true);
    useTimelineStore.getState().markSaved();
    expect(useTimelineStore.getState().isDirty).toBe(false);
  });

  it('markSaved 不改变时间轴内容', () => {
    const tid = useTimelineStore.getState().addTrack('video', 'V1');
    useTimelineStore.getState().addClip(tid, { kind: 'video', start_sec: 0, duration_sec: 3 });
    const before = useTimelineStore.getState().timeline;
    useTimelineStore.getState().markSaved();
    expect(useTimelineStore.getState().timeline).toBe(before);
  });
});

describe('P1-04: 关键帧时间基归一化', () => {
  // 复刻真实工程 proj_7d3a69b9eae8/tc_1b89e9d0 的绝对秒关键帧
  const absTimeline = () => ({
    ...createEmptyTimeline(),
    tracks: [{
      id: 'v1', name: 'V1', kind: 'text' as const, index: 0, locked: false, muted: false,
      clips: [{
        id: 'tc_1', kind: 'text' as const, track_id: 'v1',
        start_sec: 240, duration_sec: 60,
        keyframes: [
          { time: 240, properties: { opacity: 0 } },
          { time: 300, properties: { opacity: 1 } },
        ],
      }],
    }],
  });

  it('setTimeline 把绝对秒关键帧归一化为 clip_local 并写标记', () => {
    useTimelineStore.getState().setTimeline(absTimeline() as never);
    const clip = useTimelineStore.getState().timeline.tracks[0].clips[0];
    expect(clip.keyframes!.map((k) => k.time)).toEqual([0, 1]);
    expect(clip.metadata?.kf_time_base).toBe('clip_local');
  });

  it('已是归一化基的关键帧保持不变（幂等）', () => {
    useTimelineStore.getState().setTimeline(absTimeline() as never);
    const once = useTimelineStore.getState().timeline.tracks[0].clips[0];
    useTimelineStore.getState().setTimeline(useTimelineStore.getState().timeline);
    const twice = useTimelineStore.getState().timeline.tracks[0].clips[0];
    expect(twice.keyframes!.map((k) => k.time)).toEqual(once.keyframes!.map((k) => k.time));
  });

  it('exportTimeline 不再盲目标记绝对秒关键帧', () => {
    const store = useTimelineStore.getState();
    // 绕过 setTimeline 的归一化：直接构造带绝对秒关键帧的当前时间线
    const raw = absTimeline();
    useTimelineStore.setState({ timeline: raw as never });
    const exported = useTimelineStore.getState().exportTimeline();
    const clip = exported.tracks[0].clips[0];
    // 绝对秒保持原样、无 clip_local 标记（后端启发式可正确识别 absolute）
    expect(clip.keyframes![0].time).toBe(240);
    expect(clip.metadata?.kf_time_base).toBeUndefined();
  });
});

// W07 (TL-01/TL-03): setTimeline 区分来源，history 与「落盘基线」比较决定脏标记。
describe('W07: setTimeline 来源 / 落盘基线 / isDirty (TL-01/TL-03)', () => {
  beforeEach(() => {
    // resetTimeline 清基线 + 清脏，保证用例之间互不污染
    useTimelineStore.getState().resetTimeline();
  });

  it('server 水合不误标脏，并记录落盘基线', () => {
    const srv = createEmptyTimeline();
    useTimelineStore.getState().addTrack('video', 'V1'); // 先制造一个「旧状态」脏标记
    expect(useTimelineStore.getState().isDirty).toBe(true);

    useTimelineStore.getState().setTimeline(srv, { source: 'server' });
    expect(useTimelineStore.getState().isDirty).toBe(false);

    // 基线 = srv：history 恢复到该快照 → 不脏；恢复到一个不同快照 → 脏
    useTimelineStore.getState().setTimeline(srv, { source: 'history' });
    expect(useTimelineStore.getState().isDirty).toBe(false);
    useTimelineStore.getState().setTimeline(createEmptyTimeline(), { source: 'history' });
    expect(useTimelineStore.getState().isDirty).toBe(true);
  });

  it('local 来源（JSON 导入 / 代理切换 / Agent 产物替换）→ isDirty=true', () => {
    useTimelineStore.getState().setTimeline(createEmptyTimeline(), { source: 'server' });
    expect(useTimelineStore.getState().isDirty).toBe(false);

    useTimelineStore.getState().setTimeline(createEmptyTimeline(), { source: 'local' });
    expect(useTimelineStore.getState().isDirty).toBe(true);
  });

  it('history 来源：恢复的时间线与落盘基线不同 → 保持 isDirty=true', () => {
    const srv = createEmptyTimeline();
    useTimelineStore.getState().setTimeline(srv, { source: 'server' });
    const edited = createEmptyTimeline();
    useTimelineStore.getState().setTimeline(edited, { source: 'history' });
    expect(useTimelineStore.getState().isDirty).toBe(true);
  });

  it('markSaved 后清脏，并把落盘基线更新为当前 timeline', () => {
    const srv = createEmptyTimeline();
    useTimelineStore.getState().setTimeline(srv, { source: 'server' });
    useTimelineStore.getState().setTimeline(createEmptyTimeline(), { source: 'local' });
    expect(useTimelineStore.getState().isDirty).toBe(true);

    const saved = useTimelineStore.getState().timeline;
    useTimelineStore.getState().markSaved();
    expect(useTimelineStore.getState().isDirty).toBe(false);
    // 基线已更新为 saved：history 回到 saved 不脏，回到旧 server 快照脏
    useTimelineStore.getState().setTimeline(saved, { source: 'history' });
    expect(useTimelineStore.getState().isDirty).toBe(false);
    useTimelineStore.getState().setTimeline(srv, { source: 'history' });
    expect(useTimelineStore.getState().isDirty).toBe(true);
  });

  it('缺省（无 source）行为保持不变：isDirty=false 且同样建立落盘基线', () => {
    useTimelineStore.getState().addTrack('video', 'V1');
    expect(useTimelineStore.getState().isDirty).toBe(true);
    const legacy = createEmptyTimeline();
    useTimelineStore.getState().setTimeline(legacy); // 既有调用点不传来源
    expect(useTimelineStore.getState().isDirty).toBe(false);
    useTimelineStore.getState().setTimeline(legacy, { source: 'history' });
    expect(useTimelineStore.getState().isDirty).toBe(false);
  });
});
