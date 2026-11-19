import { getApiClient } from '@/services/api/client';

export type AnimationCall = {
  call_id: string;
  kind: 'tool' | 'skill' | 'agent';
  name: string;
  status: string;
  input_summary?: string;
  output_summary?: string;
  artifact_ref?: string;
  duration_ms?: number;
  error?: string;
  children?: string[];
};

export type AnimationContext = {
  session_id: string;
  task_id: string;
  version: number;
  history_summary: string;
  blackboard: Record<string, unknown>;
  calls: AnimationCall[];
  artifacts: Record<string, string>;
};

const base = (sessionId: string, taskId: string) =>
  `/api/animation/${sessionId}/${taskId}`;

export async function getAnimationContext(sessionId: string, taskId: string) {
  return (await getApiClient().get<AnimationContext>(`/api/animation/context/${sessionId}/${taskId}`)).data;
}

export async function getAnimationCalls(sessionId: string, taskId: string, kind?: string) {
  const suffix = kind ? `?kind=${encodeURIComponent(kind)}` : '';
  return (await getApiClient().get<{ calls: AnimationCall[] }>(`/api/animation/calls/${sessionId}/${taskId}${suffix}`)).data.calls;
}

export async function appendAnimationFeedback(sessionId: string, taskId: string, content: string) {
  return (await getApiClient().post(`/api/animation/context/${sessionId}/${taskId}/history`, { role: 'user', content })).data;
}

export async function patchAnimationBlackboard(
  sessionId: string, taskId: string, patch: Record<string, unknown>, expectedVersion: number,
) {
  return (await getApiClient().patch<AnimationContext>(`/api/animation/blackboard/${sessionId}/${taskId}`, {
    patch, expected_version: expectedVersion,
  })).data;
}

export { base as animationContextPath };
