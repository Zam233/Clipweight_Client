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
});
