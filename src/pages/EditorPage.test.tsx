// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { decideFlushPayload, FLUSH_PAYLOAD_LIMIT } from './flushPayload';
import { createEmptyTimeline, createDefaultClip, type Timeline, type Track } from '@/types/timeline';

function makeTimelineWithTextBytes(textBytes: number): Timeline {
  const tl = createEmptyTimeline('tl_test_1');
  const track: Track = {
    id: 'trk_1',
    name: 'V1',
    kind: 'video',
    index: 0,
    locked: false,
    muted: false,
    clips: [],
  };
  const clip = createDefaultClip({
    id: 'clip_1',
    kind: 'video',
    track_id: track.id,
    text: 'x'.repeat(textBytes),
  });
  track.clips.push(clip);
  tl.tracks.push(track);
  return tl;
}

function makeInput(textLen: number) {
  return {
    project_id: 'proj_test_1',
    name: '测试项目',
    timeline: makeTimelineWithTextBytes(textLen),
  };
}

describe('decideFlushPayload (F3 payload-size guard)', () => {
  it('small timeline (<48KB) → kind "full", payload is the full input', () => {
    const input = makeInput(100);
    const d = decideFlushPayload(input);
    expect(d.kind).toBe('full');
    expect(d.payload).toBe(input);
    expect(JSON.stringify(d.payload).length).toBeLessThan(FLUSH_PAYLOAD_LIMIT);
  });

  it('large timeline (>48KB) → kind "metadata", compact payload <48KB with project id and no full tracks', () => {
    const input = makeInput(60 * 1024);
    expect(JSON.stringify(input).length).toBeGreaterThan(FLUSH_PAYLOAD_LIMIT);
    const d = decideFlushPayload(input);
    expect(d.kind).toBe('metadata');

    const payload = d.payload as {
      project_id: string;
      timeline: { track_count: number; clip_count: number; last_edit_at: string };
    };
    expect(payload.project_id).toBe('proj_test_1');
    expect(payload.timeline).toBeDefined();
    expect(payload.timeline.track_count).toBe(1);
    expect(payload.timeline.clip_count).toBe(1);
    expect(typeof payload.timeline.last_edit_at).toBe('string');
    expect((d.payload as { timeline: unknown }).timeline).not.toHaveProperty('tracks');
    expect((d.payload as { timeline: unknown }).timeline).not.toHaveProperty('width');

    // 元数据本身必须远小于阈值，可被 keepalive 可靠发送
    expect(JSON.stringify(d.payload).length).toBeLessThan(FLUSH_PAYLOAD_LIMIT);
  });

  it('exactly at the boundary (==48KB) → kind "full"', () => {
    // 计算使整个序列化负载恰好等于阈值的文本长度
    const base = JSON.stringify(makeInput(0)).length;
    const textLen = FLUSH_PAYLOAD_LIMIT - base;
    expect(textLen).toBeGreaterThan(0);

    const input = makeInput(textLen);
    expect(JSON.stringify(input).length).toBe(FLUSH_PAYLOAD_LIMIT);

    const d = decideFlushPayload(input);
    expect(d.kind).toBe('full');
    expect(d.payload).toBe(input);
  });
});
