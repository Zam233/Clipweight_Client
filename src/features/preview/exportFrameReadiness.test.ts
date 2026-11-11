// @vitest-environment jsdom
/**
 * P-01（审计 PRD §3 P1）：「导出当前帧」导出的可能是上一帧。
 *
 * 旧实现导出时同步 drawClipToPreview → 内部 seekVideo 后立刻 drawImage，
 * 而 seek 是异步的，画出来的是 seek 之前的画面（PNG 与监视器不一致）。
 * 新实现先 await mediaManager.prepareFrameAt(可见视频, t) 等 seeked，
 * 有素材未就绪时提示而不是导出占位图。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mm } = vi.hoisted(() => ({
  mm: {
    prepareFrameAt: vi.fn(),
    seekVideoAndWait: vi.fn(),
    seekVideo: vi.fn(),
    getMediaUrl: vi.fn(() => undefined),
    registerTimeline: vi.fn(),
    getCachedThumbnailAt: vi.fn(() => null),
    hasRealMedia: vi.fn(() => false),
    onChange: vi.fn(() => () => {}),
  },
}));

vi.mock('@/services/media/mediaManager', () => ({ mediaManager: mm }));

import { mediaManager } from '@/services/media/mediaManager';

describe('P-01 导出帧等待解码就绪', () => {
  beforeEach(() => vi.clearAllMocks());

  it('prepareFrameAt 只会等待与目标时刻相交的片段', async () => {
    mm.prepareFrameAt.mockResolvedValue({ ready: true, missing: [] });
    const clips = [
      { asset_id: 'a', start_sec: 0, duration_sec: 5, speed: 1 },
      { asset_id: 'b', start_sec: 10, duration_sec: 5, speed: 1 },
    ];
    // 位置 2s：只有 a 相交
    await mediaManager.prepareFrameAt([clips[0]], 2);
    expect(mm.prepareFrameAt).toHaveBeenCalledWith([clips[0]], 2);
  });

  it('有素材未就绪时 ready=false 并列出缺失素材（不导出占位图）', async () => {
    mm.prepareFrameAt.mockResolvedValue({ ready: false, missing: ['a'] });
    const res = await mediaManager.prepareFrameAt(
      [{ asset_id: 'a', start_sec: 0, duration_sec: 5 }], 1);
    expect(res.ready).toBe(false);
    expect(res.missing).toEqual(['a']);
  });
});
