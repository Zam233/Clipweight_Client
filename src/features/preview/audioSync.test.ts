import { describe, expect, it } from 'vitest';

import { activeAudioByAsset, type AudioClipState } from './audioSync';

const clip = (start: number, end: number): AudioClipState => ({
  assetId: 'voice', start, end, speed: 1, volume: 1, trackMuted: false, offset: 0,
});

describe('activeAudioByAsset', () => {
  it('分割后的同一素材同一时刻只有一个活跃片段', () => {
    const clips = [clip(0, 4), clip(4, 8)];
    expect(activeAudioByAsset(clips, 1).get('voice')).toMatchObject({ start: 0, end: 4 });
    expect(activeAudioByAsset(clips, 5).get('voice')).toMatchObject({ start: 4, end: 8 });
    expect(activeAudioByAsset(clips, 4).get('voice')).toMatchObject({ start: 4, end: 8 });
    expect(activeAudioByAsset(clips, 9).size).toBe(0);
  });
});
