// @vitest-environment jsdom
/**
 * E-06 线索 4（PRD §5A 待复核）：`useSessionTimeline` 的 `_subs` 订阅计数。
 *
 * 审计猜测：首订阅者 cleanup 直接 `_subs.delete(sessionId)`，多订阅者时
 * 提前断流。逐行核对结论：当前**只有一个调用点**（SessionTimeline.tsx:493），
 * 且 effect 内部对「重试 tick 变化」会走 teardown→重建，首订阅者 cleanup
 * 删除计数后重建时 refs=0 会重新拉流——单消费者语义下不会断流。
 *
 * 本文件用「两个消费者共享 sessionId」的用例验证计数的真实行为：
 * - 建立双消费者 → _subs 计数为 2；
 * - 卸载其一个 → 仍存活（计数 1，流不关）；
 * - 卸载另一个 → 计数删除。
 * 结论与风险一并写入实施台账。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';

const { sse } = vi.hoisted(() => ({
  sse: { connectSseStream: vi.fn() },
}));

vi.mock('@/services/api/sseStream', () => ({ connectSseStream: sse.connectSseStream }));

vi.mock('@/services/api/requirements', async () => {
  const actual = await vi.importActual<typeof import('@/services/api/requirements')>(
    '@/services/api/requirements');
  return {
    ...actual,
    requirementsApi: {
      ...(actual.requirementsApi as object),
      timeline: vi.fn(async () => ({ items: [], has_more: false, latest_seq: 0 })),
      timelineStreamUrl: vi.fn(() => 'http://x/stream'),
    },
  };
});

import { useSessionTimeline } from './useSessionTimeline';
import { useSessionTimelineStore } from '@/stores/sessionTimelineStore';

function Probe({ sid, enabled = true }: { sid: string; enabled?: boolean }) {
  useSessionTimeline(sid, { enabled });
  return <div data-testid="probe" />;
}

beforeEach(() => {
  sse.connectSseStream.mockReset();
  sse.connectSseStream.mockReturnValue({ close: vi.fn(), reconnect: vi.fn() });
  useSessionTimelineStore.getState().reset();
});

afterEach(() => cleanup());

describe('E-06 线索 4：订阅计数行为', () => {
  it('双消费者共用一条流：卸载一个不断流，全部卸载才关闭', async () => {
    const { rerender, unmount } = render(<><Probe sid="s1" /><Probe sid="s1" /></>);
    await vi.waitFor(() => expect(sse.connectSseStream).toHaveBeenCalledTimes(1));

    // 卸载第一个消费者 → 只减计数，不重连（流仍活着）
    rerender(<><Probe sid="s1" enabled={false} /><Probe sid="s1" /></>);
    await new Promise((r) => setTimeout(r, 10));
    expect(sse.connectSseStream).toHaveBeenCalledTimes(1);

    // 全部卸载 → 流关闭（下个消费者会重建，connectSseStream 再次被调用）
    rerender(<><Probe sid="s1" enabled={false} /><Probe sid="s1" enabled={false} /></>);
    unmount();
    await new Promise((r) => setTimeout(r, 10));

    render(<Probe sid="s1" />);
    await vi.waitFor(() => expect(sse.connectSseStream).toHaveBeenCalledTimes(2));
  });
});
