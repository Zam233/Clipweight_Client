// @vitest-environment jsdom
/**
 * PRD B2（2026-10-29 / G3）：工作区进度必须真的被消费。
 *
 * 要证伪的三件事：
 * 1. SSE 订阅的是 `/events/stream`（不是 JSON `/events`）；
 * 2. 同一 seq 重发（断线重连）不会重复渲染；
 * 3. 卸载时关闭连接；扫描失败项可见（后端没有单文件重试端点）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import {
  WorkspaceMaterialsPanel, collectFailures, mergeEvents, toWorkspaceEvent,
} from './WorkspaceMaterialsPanel';
import type { WorkspaceEvent } from '@/services/api';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    get: vi.fn(),
    materials: vi.fn(),
    scan: vi.fn(),
    upload: vi.fn(),
    events: vi.fn(),
    eventsStreamUrl: vi.fn(() => 'http://api.test/api/workspace/p1/events/stream?since=0'),
    connect: vi.fn(),
    close: vi.fn(),
    lastOnMessage: null as null | ((data: unknown) => void),
  },
}));

vi.mock('@/services/api', () => ({
  workspaceApi: {
    get: mocks.get,
    materials: mocks.materials,
    scan: mocks.scan,
    upload: mocks.upload,
    events: mocks.events,
    eventsStreamUrl: mocks.eventsStreamUrl,
    reports: vi.fn(), report: vi.fn(), docs: vi.fn(), roots: vi.fn(),
    create: vi.fn(), enable: vi.fn(), remove: vi.fn(),
  },
}));

vi.mock('@/services/api/sseStream', () => ({
  connectSseStream: (opts: { url: string; onMessage: (d: unknown) => void }) => {
    mocks.lastOnMessage = opts.onMessage;
    mocks.connect(opts.url);
    return { close: mocks.close, reconnect: vi.fn() };
  },
}));

const STATUS = {
  project_id: 'p1', exists: true, root: 'J:/ws/p1', health: 'ok',
  counts: { total: 3, video: 1, image: 1, audio: 1, other: 0, indexed: 2, pending: 1 },
  index: { vision: true, provider: 'llm' },
  scan: { auto: true, interval_sec: 60, last_scan_at: '2026-10-29T01:00:00Z', pending: 1 },
};

const ev = (seq: number, message: string, level = 'info', detail: Record<string, unknown> = {}): WorkspaceEvent =>
  ({ seq, ts: 1, level, message, detail });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lastOnMessage = null;
  mocks.get.mockResolvedValue(STATUS);
  mocks.materials.mockResolvedValue({ project_id: 'p1', root: 'J:/ws/p1', count: 0, items: [], pending: 0 });
  mocks.events.mockResolvedValue({ project_id: 'p1', events: [], last_seq: 0 });
  mocks.scan.mockResolvedValue({
    scanned: 3, changed: 0, new: 0, deduped: 0, indexed: 3, deferred: 0, failed: 0, items: [],
  });
});
afterEach(cleanup);

/** 「立即扫描」在 status 加载前是 disabled 的——先等它可用，避免点击被吞。 */
async function waitForScanEnabled(): Promise<void> {
  await waitFor(() => {
    const btn = screen.getByRole('button', { name: /立即扫描/ }) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });
}

describe('B2 纯函数', () => {
  it('toWorkspaceEvent 只认有 seq 的形状', () => {
    expect(toWorkspaceEvent({ seq: 2, message: 'm' })?.seq).toBe(2);
    expect(toWorkspaceEvent({ message: '没有 seq' })).toBeNull();
    expect(toWorkspaceEvent(null)).toBeNull();
  });

  it('mergeEvents 按 seq 去重并排序、上限 200', () => {
    const merged = mergeEvents([ev(2, 'b')], [ev(1, 'a'), ev(2, 'b-dup'), ev(3, 'c')]);
    expect(merged.map((e) => e.seq)).toEqual([1, 2, 3]);
    const many = Array.from({ length: 260 }, (_, i) => ev(i + 1, `m${i + 1}`));
    expect(mergeEvents([], many)).toHaveLength(200);
  });

  it('collectFailures 同时吃扫描报告与事件 detail.failed', () => {
    const fromReport = collectFailures(
      { items: [{ rel: 'a.mp4', status: 'failed', vision: '解码失败' }] }, [],
    );
    expect(fromReport).toEqual([{ rel: 'a.mp4', reason: '解码失败' }]);

    const fromEvents = collectFailures(null, [
      ev(5, '索引失败', 'error', { failed: [{ rel: 'b.png', reason: '不是图片' }] }),
      ev(6, '索引失败', 'error', { failed: ['c.mp3'] }),
      ev(7, '普通进度', 'info', {}),
    ]);
    expect(fromEvents.map((f) => f.rel).sort()).toEqual(['b.png', 'c.mp3']);
    expect(fromEvents.find((f) => f.rel === 'b.png')?.reason).toBe('不是图片');
  });
});

describe('B2 面板订阅', () => {
  it('首屏用 JSON /events 回填，不订阅 SSE', async () => {
    mocks.events.mockResolvedValue({ project_id: 'p1', events: [ev(1, '历史事件')], last_seq: 1 });
    render(<WorkspaceMaterialsPanel projectId="p1" />);
    expect(await screen.findByTestId('workspace-progress')).toBeTruthy();
    expect(screen.getByText(/历史事件/)).toBeTruthy();
    expect(mocks.events).toHaveBeenCalledWith('p1', 0);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('点「立即扫描」才订阅 /events/stream，并用 last_seq 续传', async () => {
    mocks.events.mockResolvedValue({ project_id: 'p1', events: [ev(4, '旧事件')], last_seq: 4 });
    render(<WorkspaceMaterialsPanel projectId="p1" />);
    await screen.findByTestId('workspace-progress');
    fireEvent.click(screen.getByRole('button', { name: /立即扫描/ }));

    await waitFor(() => expect(mocks.eventsStreamUrl).toHaveBeenCalledWith('p1', 4));
    expect(mocks.connect).toHaveBeenCalledWith(
      'http://api.test/api/workspace/p1/events/stream?since=0',
    );
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith('p1'));
  });

  it('SSE 帧渲染成进度；重复 seq 不重复出现', async () => {
    render(<WorkspaceMaterialsPanel projectId="p1" />);
    await waitForScanEnabled();
    fireEvent.click(screen.getByRole('button', { name: /立即扫描/ }));
    await waitFor(() => expect(mocks.lastOnMessage).not.toBeNull());

    mocks.lastOnMessage?.({ seq: 9, level: 'info', message: '正在索引 9.mp4' });
    mocks.lastOnMessage?.({ seq: 9, level: 'info', message: '正在索引 9.mp4' });
    mocks.lastOnMessage?.({ seq: 10, level: 'info', message: '索引完成 10.mp4' });

    const box = await screen.findByTestId('workspace-progress');
    expect(box.textContent).toContain('正在索引 9.mp4');
    expect(box.textContent).toContain('索引完成 10.mp4');
    expect(box.querySelectorAll('[data-event-seq]')).toHaveLength(2);
  });

  it('卸载时关闭 SSE 连接（不泄漏 EventSource）', async () => {
    const { unmount } = render(<WorkspaceMaterialsPanel projectId="p1" />);
    await waitForScanEnabled();
    fireEvent.click(screen.getByRole('button', { name: /立即扫描/ }));
    await waitFor(() => expect(mocks.connect).toHaveBeenCalled());
    unmount();
    expect(mocks.close).toHaveBeenCalled();
  });

  it('扫描失败项单独可见，并说明需要整批重扫', async () => {
    mocks.scan.mockResolvedValue({
      scanned: 2, changed: 0, new: 0, deduped: 0, indexed: 1, deferred: 0, failed: 1,
      items: [{ rel: 'broken.mp4', status: 'failed', vision: 'ffprobe 解码失败' }],
    });
    render(<WorkspaceMaterialsPanel projectId="p1" />);
    await waitForScanEnabled();
    fireEvent.click(screen.getByRole('button', { name: /立即扫描/ }));

    const box = await screen.findByTestId('workspace-failures');
    expect(box.textContent).toContain('1 个文件索引失败');
    expect(box.textContent).toContain('broken.mp4');
    expect(box.textContent).toContain('ffprobe 解码失败');
    expect(box.textContent).toContain('单项重试需后端新端点');
  });
});
