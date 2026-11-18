import { describe, expect, it } from 'vitest';
import { initialAuthorState, reduceAuthorState } from './authorTask';

describe('author task state machine', () => {
  it('ignores stale seq and refuses success after cancel', () => {
    let s = reduceAuthorState(initialAuthorState, { type: 'start', taskId: 't' });
    s = reduceAuthorState(s, { type: 'progress', seq: 2, progress: 20 });
    const stale = reduceAuthorState(s, { type: 'progress', seq: 1, progress: 99 });
    expect(stale.progress).toBe(20);
    s = reduceAuthorState(s, { type: 'cancel_requested' });
    expect(s.status).toBe('cancel_requested');
    expect(reduceAuthorState(s, { type: 'succeed' }).status).toBe('cancel_requested');
    expect(reduceAuthorState(s, { type: 'cancelled' }).status).toBe('cancelled');
  });
  it('timeout only from authoring', () => {
    const s = reduceAuthorState(initialAuthorState, { type: 'start', taskId: 't' });
    expect(reduceAuthorState(s, { type: 'timeout' }).status).toBe('timed_out');
    expect(reduceAuthorState(initialAuthorState, { type: 'timeout' }).status).toBe('idle');
  });
});
