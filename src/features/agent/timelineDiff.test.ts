import { describe, it, expect } from 'vitest';
import { computeTimelineDiff, mergeTimeline } from './timelineDiff';
import type { Timeline, Clip, Track } from '@/types/timeline';

function mkClip(id: string, over: Partial<Clip> = {}): Clip {
  return {
    id, kind: 'video', asset_id: `asset_${id}`, track_id: 'tr',
    start_sec: 0, duration_sec: 5, source_offset_sec: 0,
    speed: 1, volume: 1, opacity: 1, keyframes: [], metadata: {}, ...over,
  };
}

function mkTimeline(clips: Clip[]): Timeline {
  const track: Track = { id: 'tr', name: 'V1', kind: 'video', index: 0, locked: false, muted: false, clips };
  return { id: 'tl', width: 1920, height: 1080, fps: 30, duration_sec: 10, tracks: [track] };
}

describe('computeTimelineDiff', () => {
  it('detects added clips', () => {
    const current = mkTimeline([mkClip('a')]);
    const proposed = mkTimeline([mkClip('a'), mkClip('b', { start_sec: 5 })]);
    const diff = computeTimelineDiff(current, proposed);
    expect(diff.summary.added).toBe(1);
    expect(diff.addedClips[0].id).toBe('b');
  });

  it('detects removed clips', () => {
    const current = mkTimeline([mkClip('a'), mkClip('b')]);
    const proposed = mkTimeline([mkClip('a')]);
    const diff = computeTimelineDiff(current, proposed);
    expect(diff.summary.removed).toBe(1);
    expect(diff.removedClips[0].id).toBe('b');
  });

  it('detects modified clips with changed fields', () => {
    const current = mkTimeline([mkClip('a', { duration_sec: 5 })]);
    const proposed = mkTimeline([mkClip('a', { duration_sec: 8 })]);
    const diff = computeTimelineDiff(current, proposed);
    expect(diff.summary.modified).toBe(1);
    expect(diff.modifiedClips[0].fields).toContain('duration_sec');
  });

  it('ignores numerically-equal fields within epsilon', () => {
    const current = mkTimeline([mkClip('a', { start_sec: 1.0 })]);
    const proposed = mkTimeline([mkClip('a', { start_sec: 1.0001 })]);
    const diff = computeTimelineDiff(current, proposed);
    expect(diff.isEmpty).toBe(true);
  });

  it('reports empty when identical', () => {
    const tl = mkTimeline([mkClip('a'), mkClip('b', { start_sec: 5 })]);
    const diff = computeTimelineDiff(tl, JSON.parse(JSON.stringify(tl)));
    expect(diff.isEmpty).toBe(true);
  });
});

describe('mergeTimeline', () => {
  it('applies only accepted additions', () => {
    const current = mkTimeline([mkClip('a')]);
    const proposed = mkTimeline([mkClip('a'), mkClip('b', { start_sec: 5 })]);
    const diff = computeTimelineDiff(current, proposed);
    const merged = mergeTimeline(current, diff, new Set(['b']), new Set());
    const ids = merged.tracks[0].clips.map((c) => c.id);
    expect(ids).toContain('b');
  });

  it('does not apply unaccepted additions', () => {
    const current = mkTimeline([mkClip('a')]);
    const proposed = mkTimeline([mkClip('a'), mkClip('b', { start_sec: 5 })]);
    const diff = computeTimelineDiff(current, proposed);
    const merged = mergeTimeline(current, diff, new Set(), new Set());
    expect(merged.tracks[0].clips.map((c) => c.id)).not.toContain('b');
  });

  it('applies accepted removals', () => {
    const current = mkTimeline([mkClip('a'), mkClip('b')]);
    const proposed = mkTimeline([mkClip('a')]);
    const diff = computeTimelineDiff(current, proposed);
    const merged = mergeTimeline(current, diff, new Set(), new Set(['b']));
    expect(merged.tracks[0].clips.map((c) => c.id)).not.toContain('b');
  });
});
