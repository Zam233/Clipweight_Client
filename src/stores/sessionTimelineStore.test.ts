import { describe, it, expect, beforeEach } from 'vitest';

import { useSessionTimelineStore } from './sessionTimelineStore';
import type { SessionTimelineFrame, SessionTimelineItem } from '@/features/sessionTimeline/types';

function item(seq: number): SessionTimelineItem {
  return {
    seq,
    type: 'content',
    time: '2026-11-22T12:00:00+08:00',
    state: 'done',
    source: 'requirements',
    ref: null,
    content_ref: null,
    content_inline: `#${seq}`,
    meta: { role: 'assistant' },
  } as SessionTimelineItem;
}

describe('sessionTimelineStore snapshot has_more', () => {
  const sid = 'req_test';
  beforeEach(() => {
    useSessionTimelineStore.getState().reset();
  });

  it('增量 snapshot 不得把首屏的 hasMore 覆盖成 false', () => {
    const store = useSessionTimelineStore.getState();
    store.hydrate(sid, [item(1), item(2)], { hasMore: true, latestSeq: 2 });
    expect(useSessionTimelineStore.getState().hasMore[sid]).toBe(true);

    useSessionTimelineStore.getState().applyFrame(sid, {
      op: 'snapshot',
      items: [],
      has_more: false,
      has_more_before: false,
      latest_seq: 2,
      archived_until_seq: 0,
    } as SessionTimelineFrame);

    expect(useSessionTimelineStore.getState().hasMore[sid]).toBe(true);
  });

  it('has_more_before=true 时保留可向前翻页', () => {
    const store = useSessionTimelineStore.getState();
    store.hydrate(sid, [item(1)], { hasMore: false, latestSeq: 1 });
    useSessionTimelineStore.getState().applyFrame(sid, {
      op: 'snapshot',
      items: [],
      has_more: false,
      has_more_before: true,
      latest_seq: 1,
      archived_until_seq: 0,
    } as SessionTimelineFrame);
    expect(useSessionTimelineStore.getState().hasMore[sid]).toBe(true);
  });
});
