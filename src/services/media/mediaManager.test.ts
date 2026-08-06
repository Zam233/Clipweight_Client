// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { mediaManager, resolveMediaUrl } from './mediaManager';
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

describe('mediaManager.registerTimeline', () => {
  beforeEach(() => {
    mediaManager.clear();
  });

  it('registers video/audio/image clips with resolved by-path URL', () => {
    const tl = mkTimeline([
      mkClip('v1', { kind: 'video', asset_id: 'C:\\library\\a.mp4' }),
      mkClip('a1', { kind: 'audio', asset_id: 'C:\\library\\voice.wav' }),
      mkClip('i1', { kind: 'image', asset_id: 'img_1', metadata: { local_path: 'C:\\library\\bg.png' } }),
    ]);
    mediaManager.registerTimeline(tl);

    const v = mediaManager.get('C:\\library\\a.mp4');
    expect(v).toBeDefined();
    expect(v!.kind).toBe('video');
    expect(v!.videoEl).toBeDefined();
    expect(v!.url).toContain('/api/asset/by-path?path=');

    const a = mediaManager.get('C:\\library\\voice.wav');
    expect(a).toBeDefined();
    expect(a!.kind).toBe('audio');
    expect(a!.audioEl).toBeDefined();

    const img = mediaManager.get('img_1');
    expect(img).toBeDefined();
    expect(img!.kind).toBe('image');
    expect(img!.url).toContain('/api/asset/by-path?path=');
  });

  it('prefers http metadata.url over by-path proxy', () => {
    const tl = mkTimeline([mkClip('v1', { metadata: { url: 'http://cdn.example/v.mp4' } })]);
    mediaManager.registerTimeline(tl);
    const e = mediaManager.get('asset_v1')!;
    expect(e.url).toBe('http://cdn.example/v.mp4');
  });

  it('skips text/animation/shape clips', () => {
    const tl = mkTimeline([
      mkClip('t1', { kind: 'text', asset_id: '' }),
      mkClip('an1', { kind: 'animation', asset_id: '' }),
      mkClip('s1', { kind: 'shape', asset_id: '' }),
    ]);
    mediaManager.registerTimeline(tl);
    for (const id of ['asset_t1', 'asset_an1', 'asset_s1']) {
      expect(mediaManager.get(id)).toBeUndefined();
    }
  });

  it('skips clips with no resolvable URL (empty asset_id + no metadata)', () => {
    const tl = mkTimeline([mkClip('v1', { asset_id: '' })]);
    mediaManager.registerTimeline(tl);
    expect(mediaManager.get('asset_v1')).toBeUndefined();
  });

  it('is idempotent across repeated calls', () => {
    const tl = mkTimeline([mkClip('v1', { metadata: { local_path: 'C:\\library\\a.mp4' } })]);
    mediaManager.registerTimeline(tl);
    mediaManager.registerTimeline(tl);
    mediaManager.registerTimeline(tl);
    expect(mediaManager.get('asset_v1')).toBeDefined();
  });
});

describe('resolveMediaUrl', () => {
  it('returns http url directly', () => {
    expect(resolveMediaUrl({ asset_id: 'x', metadata: { url: 'https://cdn/x.mp4' } })).toBe('https://cdn/x.mp4');
  });

  it('wraps local_path as by-path proxy', () => {
    const url = resolveMediaUrl({ asset_id: 'x', metadata: { local_path: 'C:\\library\\a.mp4' } });
    expect(url).toBe('/api/asset/by-path?path=' + encodeURIComponent('C:\\library\\a.mp4'));
  });

  it('falls back to asset_id when no metadata', () => {
    const url = resolveMediaUrl({ asset_id: 'C:\\media\\a.mp4', metadata: {} });
    expect(url).toBe('/api/asset/by-path?path=' + encodeURIComponent('C:\\media\\a.mp4'));
  });

  it('returns undefined when nothing resolvable', () => {
    expect(resolveMediaUrl({ asset_id: '', metadata: {} })).toBeUndefined();
  });
});
