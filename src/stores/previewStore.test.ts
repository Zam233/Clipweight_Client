import { describe, it, expect, beforeEach } from 'vitest';
import { usePreviewStore } from './previewStore';
import { frameToSeconds, secondsToFrame, ticksToSeconds, ticksPerFrame } from '@/lib/mediaTime';

const NTSC = 30000 / 1001;

describe('previewStore 按帧步进（O1：整数 tick）', () => {
  beforeEach(() => {
    usePreviewStore.setState({
      isPlaying: false,
      currentTimeSec: 0,
      durationSec: 10,
      fps: 30,
      loopRegion: null,
      isLooping: false,
    });
  });

  it('30fps：步进一格恰好一帧', () => {
    const store = usePreviewStore.getState();
    store.stepForward();
    expect(usePreviewStore.getState().currentTimeSec).toBeCloseTo(1 / 30, 12);
    usePreviewStore.getState().stepBackward();
    expect(usePreviewStore.getState().currentTimeSec).toBeCloseTo(0, 12);
  });

  it('29.97fps：步进 100 次落在第 100 帧起点（不漂移）', () => {
    usePreviewStore.setState({ fps: NTSC });
    for (let i = 0; i < 100; i += 1) usePreviewStore.getState().stepForward();
    const t = usePreviewStore.getState().currentTimeSec;
    expect(secondsToFrame(t, NTSC)).toBe(100);
    expect(t).toBeCloseTo(ticksToSeconds(100 * ticksPerFrame(NTSC)), 12);
  });

  it('帧内位置前进不跳帧（旧的 round(t*fps)+1 会跳过一格）', () => {
    const midFrame = frameToSeconds(10, 30) + 0.6 * (1 / 30);
    usePreviewStore.setState({ currentTimeSec: midFrame });
    usePreviewStore.getState().stepForward();
    expect(usePreviewStore.getState().currentTimeSec).toBeCloseTo(frameToSeconds(11, 30), 12);
  });

  it('帧内位置后退回到当前帧起点', () => {
    const midFrame = frameToSeconds(10, 30) + 0.6 * (1 / 30);
    usePreviewStore.setState({ currentTimeSec: midFrame });
    usePreviewStore.getState().stepBackward();
    expect(usePreviewStore.getState().currentTimeSec).toBeCloseTo(frameToSeconds(10, 30), 12);
  });

  it('起点后退钳到 0，前进不超过总时长', () => {
    usePreviewStore.setState({ currentTimeSec: 0 });
    usePreviewStore.getState().stepBackward();
    expect(usePreviewStore.getState().currentTimeSec).toBe(0);

    usePreviewStore.setState({ currentTimeSec: 9.99, durationSec: 10 });
    usePreviewStore.getState().stepForward();
    expect(usePreviewStore.getState().currentTimeSec).toBeLessThanOrEqual(10);
  });

  it('seekToEnd 停在最后一帧的起点（而不是时长之外）', () => {
    usePreviewStore.setState({ fps: NTSC, durationSec: 10 });
    usePreviewStore.getState().seekToEnd();
    const t = usePreviewStore.getState().currentTimeSec;
    expect(t).toBeLessThan(10);
    expect(t).toBeCloseTo(ticksToSeconds(secondsFrameFloor(10) * ticksPerFrame(NTSC)), 12);
  });

  it('fps 为 0 时不改动播放头', () => {
    usePreviewStore.setState({ fps: 0, currentTimeSec: 3 });
    usePreviewStore.getState().stepForward();
    expect(usePreviewStore.getState().currentTimeSec).toBe(3);
  });
});

/** 10 秒在 29.97 下的完整帧数（用于 seekToEnd 期望值） */
function secondsFrameFloor(seconds: number): number {
  return secondsToFrame(seconds, NTSC);
}
