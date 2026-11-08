/**
 * 播放诊断状态（devplan T1.1）。
 *
 * 为什么要单独一个 store：合成耗时那一套（`perf.ts`）由合成循环每帧采样；
 * 这里记的是**播放链路**的指标——真正在解码几路、已呈现多少帧、丢了多少帧、
 * 播放头相对墙钟漂了多少。两者的采样者与频率不同，混进一个 snapshot 会互相覆盖。
 *
 * 全部本地计算、不上报；只在浮层打开时才有 UI 订阅。
 */
import { create } from 'zustand';

export interface PlaybackStats {
  /** 当前真正在解码的视频元素数（受解码池预算约束） */
  activeDecodes: number;
  /** 预算内、正在解码的素材 id（诊断用，最多 2 个） */
  activeAssets: string[];
  /** 被预算挤出、只能显示冻结帧的素材数（降级徽标） */
  frozenCount: number;
  /** 本次播放累计已呈现帧（requestVideoFrameCallback） */
  presentedFrames: number;
  /** 本次播放估算丢帧：期望帧数 − 已呈现帧数（≥0） */
  droppedFrames: number;
  /** 播放头相对墙钟的漂移（毫秒，可为负） */
  driftMs: number;
  /** 当前时钟是否在跑（暂停后归零，避免浮层显示上一轮的陈旧数字） */
  clockRunning: boolean;
}

export const EMPTY_PLAYBACK_STATS: PlaybackStats = {
  activeDecodes: 0,
  activeAssets: [],
  frozenCount: 0,
  presentedFrames: 0,
  droppedFrames: 0,
  driftMs: 0,
  clockRunning: false,
};

interface PlaybackStatsState {
  stats: PlaybackStats;
  set: (patch: Partial<PlaybackStats>) => void;
  reset: () => void;
}

export const usePlaybackStatsStore = create<PlaybackStatsState>((set) => ({
  stats: EMPTY_PLAYBACK_STATS,
  set: (patch) => set((s) => ({ stats: { ...s.stats, ...patch } })),
  reset: () => set({ stats: EMPTY_PLAYBACK_STATS }),
}));

/** 非 React 场景（播放循环里）用的快捷写入。 */
export function publishPlaybackStats(patch: Partial<PlaybackStats>): void {
  usePlaybackStatsStore.getState().set(patch);
}

export function resetPlaybackStats(): void {
  usePlaybackStatsStore.getState().reset();
}
