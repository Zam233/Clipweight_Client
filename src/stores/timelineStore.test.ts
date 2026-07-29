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
