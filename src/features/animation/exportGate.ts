import { getApiClient } from '@/services/api/client';

export type ExportGateFailure = { reason: string; retry_action?: string };
export type ExportGateResult = { allowed: boolean; reason: string; retry_action?: string; failures?: ExportGateFailure[] };

export async function checkAnimationExportGate(timeline: unknown, userConfirmed = false): Promise<ExportGateResult | null> {
  const tracks = (timeline as { tracks?: Array<{ clips?: Array<{ metadata?: Record<string, unknown> }> }> })?.tracks ?? [];
  const mgs = tracks.flatMap((t) => t.clips ?? []).map((c) => c.metadata?.mg_def).filter(Boolean);
  if (!mgs.length) return null;
  const failures: ExportGateFailure[] = [];
  for (const mg of mgs) {
    const { data } = await getApiClient().post<ExportGateResult>('/api/animation/export-gate', {
      mg_json: mg, user_confirmed: userConfirmed, require_confirmation: false,
    });
    if (!data.allowed) failures.push({ reason: data.reason, retry_action: data.retry_action });
  }
  return failures.length ? { allowed: false, reason: failures[0].reason, retry_action: failures[0].retry_action, failures } : { allowed: true, reason: 'ok' };
}
