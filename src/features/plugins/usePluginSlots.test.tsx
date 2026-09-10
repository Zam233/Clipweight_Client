// @vitest-environment jsdom
/**
 * D-2 测试：usePluginSlots 的解析/过滤/排序/缓存失效 + Slot 可见性过滤。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
}));

vi.mock('@/services/api', () => ({
  getApiClient: () => ({ get: mocks.get }),
}));

vi.mock('./PluginLayoutRenderer', () => ({
  PluginLayoutRenderer: ({ layout }: { layout: { title?: string } }) => (
    <div data-testid="plugin-layout">{layout?.title ?? 'layout'}</div>
  ),
}));

import {
  fetchSlotContributions,
  invalidatePluginSlots,
  usePluginSlots,
} from './usePluginSlots';
import { Slot } from './Slot';

beforeEach(() => {
  mocks.get.mockReset();
  invalidatePluginSlots();
});

describe('usePluginSlots (D-2)', () => {
  it('解析贡献、按 order 排序、丢弃非法 slot 名', async () => {
    mocks.get.mockResolvedValue({
      data: {
        contributions: [
          { kind: 'ui_slot', id: 'b', title: 'B', slot: 'editor.right-panel', order: 200, layout: { title: 'B' } },
          { kind: 'ui_slot', id: 'a', title: 'A', slot: 'editor.right-panel', order: 50, layout: { title: 'A' } },
          { kind: 'ui_slot', id: 'bad', title: 'Bad', slot: 'not.a.real.slot' },
          { kind: 'ui_slot', id: 'noid' },
        ],
      },
    });
    const items = await fetchSlotContributions('editor.right-panel');
    expect(items.map((c) => c.id)).toEqual(['a', 'b']);
  });

  it('30s 缓存命中不重复请求；invalidate 后重新拉取', async () => {
    mocks.get.mockResolvedValue({ data: { contributions: [] } });
    await fetchSlotContributions('settings.section');
    await fetchSlotContributions('settings.section');
    expect(mocks.get).toHaveBeenCalledTimes(1);
    invalidatePluginSlots();
    await fetchSlotContributions('settings.section');
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('接口失败静默为空（插件面不阻塞宿主）', async () => {
    mocks.get.mockRejectedValue(new Error('offline'));
    const items = await fetchSlotContributions('nav.primary');
    expect(items).toEqual([]);
  });
});

describe('Slot 渲染 (D-2)', () => {
  function Probe({ ctx }: { ctx?: Record<string, unknown> }) {
    const items = usePluginSlots('props.section');
    void items;
    return <Slot name="props.section" context={ctx} fallback={<span>empty</span>} />;
  }

  it('可见性过滤：visibleWhen 不满足的贡献不渲染', async () => {
    mocks.get.mockResolvedValue({
      data: {
        contributions: [
          {
            kind: 'ui_slot', id: 'video_only', title: '视频专属', slot: 'props.section',
            visibleWhen: "context.clipKind === 'video'", layout: { title: '视频专属' },
          },
        ],
      },
    });
    const { rerender } = render(<Probe ctx={{ clipKind: 'audio' }} />);
    await waitFor(() => expect(mocks.get).toHaveBeenCalled());
    // audio 上下文 → 不可见 → fallback
    expect(await screen.findByText('empty')).toBeTruthy();

    rerender(<Probe ctx={{ clipKind: 'video' }} />);
    expect(await screen.findByTestId('plugin-layout')).toBeTruthy();
  });
});
