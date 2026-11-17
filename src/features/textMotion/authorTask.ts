export type AuthorStatus =
  | 'idle' | 'authoring' | 'succeeded' | 'failed'
  | 'cancel_requested' | 'cancelled' | 'timed_out';

export interface AuthorTaskState {
  status: AuthorStatus;
  taskId?: string;
  seq?: number;
  progress?: number;
  error?: string;
  cancelRequested?: boolean;
}

export type AuthorEvent =
  | { type: 'start'; taskId: string }
  | { type: 'progress'; seq?: number; progress?: number }
  | { type: 'succeed' }
  | { type: 'fail'; error?: string }
  | { type: 'timeout' }
  | { type: 'cancel_requested' }
  | { type: 'cancelled' }
  | { type: 'reset' };

export const initialAuthorState: AuthorTaskState = { status: 'idle' };

/** 纯状态机；不请求网络、不写 store。 */
export function reduceAuthorState(state: AuthorTaskState, event: AuthorEvent): AuthorTaskState {
  if (event.type === 'reset') return { ...initialAuthorState };
  if (event.type === 'progress') {
    if (state.status !== 'authoring') return state;
    if (event.seq !== undefined && state.seq !== undefined && event.seq <= state.seq) return state;
    return { ...state, seq: event.seq ?? state.seq, progress: event.progress ?? state.progress };
  }
  switch (event.type) {
    case 'start':
      return { status: 'authoring', taskId: event.taskId, progress: 0 };
    case 'succeed':
      return state.status === 'authoring' ? { ...state, status: 'succeeded', progress: 100 } : state;
    case 'fail':
      return state.status === 'authoring' || state.status === 'cancel_requested'
        ? { ...state, status: 'failed', error: event.error }
        : state;
    case 'timeout':
      return state.status === 'authoring' ? { ...state, status: 'timed_out' } : state;
    case 'cancel_requested':
      return state.status === 'authoring'
        ? { ...state, status: 'cancel_requested', cancelRequested: true }
        : state;
    case 'cancelled':
      return state.status === 'cancel_requested' || state.status === 'authoring'
        ? { ...state, status: 'cancelled', cancelRequested: true }
        : state;
    default:
      return state;
  }
}

export function isAuthorTerminal(status: AuthorStatus): boolean {
  return status === 'succeeded' || status === 'failed'
    || status === 'cancelled' || status === 'timed_out';
}
