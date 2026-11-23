export interface AudioClipState {
  assetId: string;
  start: number;
  end: number;
  speed: number;
  volume: number;
  trackMuted: boolean;
  offset: number;
}

/**
 * 同一素材可能有多个片段（分割旁白）。它们共享一个媒体元素，因此同步时
 * 必须按 assetId 只选当前活跃片段；否则后一个片段的 pause() 会停掉前一个。
 */
export function activeAudioByAsset(
  clips: readonly AudioClipState[],
  t: number,
): Map<string, AudioClipState> {
  const active = new Map<string, AudioClipState>();
  for (const clip of clips) {
    if (t >= clip.start && t < clip.end) active.set(clip.assetId, clip);
  }
  return active;
}
