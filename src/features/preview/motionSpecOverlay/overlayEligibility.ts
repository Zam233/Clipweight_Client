import type { Clip, Track } from '@/types/timeline';

export interface Eligibility {
  ok: boolean;
  reasons: string[];
  localSec: number;
}

/** 只有“纯文字 + 正常混合 + 非嵌套 + 非几何转场窗口”才交给 CSS3D 覆盖层。 */
export function overlayEligibility(
  clip: Clip, track: Track, t: number, playing: boolean,
): Eligibility {
  const reasons: string[] = [];
  const localSec = Math.max(0, (t - clip.start_sec) * (clip.speed || 1) + (clip.source_offset_sec || 0));
  if (playing) reasons.push('playing');
  if (track.hidden) reasons.push('track-hidden');
  if (clip.enabled === false) reasons.push('disabled');
  if (t < clip.start_sec || t >= clip.start_sec + clip.duration_sec) reasons.push('inactive');
  if (clip.nested_timeline) reasons.push('nested');
  if (clip.mask_type && clip.mask_type !== 'none') reasons.push('mask');
  if (clip.blend_mode && clip.blend_mode !== 'normal') reasons.push('blend');
  if ((clip.opacity ?? 1) <= 0.001) reasons.push('opacity');
  const dur = Math.max(0.001, clip.duration_sec);
  const td = Math.max(0, Math.min(dur, clip.transition_duration_sec ?? 0.5));
  const geo = new Set(['slide', 'wipe']);
  if (clip.transition_in && geo.has(clip.transition_in) && localSec < td) reasons.push('transition-in');
  if (clip.transition_out && geo.has(clip.transition_out) && localSec > dur - td) reasons.push('transition-out');
  return { ok: reasons.length === 0, reasons, localSec };
}
