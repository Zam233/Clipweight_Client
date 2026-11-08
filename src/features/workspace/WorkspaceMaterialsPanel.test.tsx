// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { WorkspaceMaterialsPanel } from './WorkspaceMaterialsPanel';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    get: vi.fn(),
    materials: vi.fn(),
    scan: vi.fn(),
    upload: vi.fn(),
    events: vi.fn(),
    eventsStreamUrl: vi.fn(() => 'http://api.test/api/workspace/p1/events/stream?since=0'),
    close: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  workspaceApi: {
    get: mocks.get,
    materials: mocks.materials,
    scan: mocks.scan,
    upload: mocks.upload,
    // PRD B2：面板现在会回填 /events 并在扫描时订阅 SSE
    events: mocks.events,
    eventsStreamUrl: mocks.eventsStreamUrl,
  },
}));

vi.mock('@/services/api/sseStream', () => ({
  connectSseStream: () => ({ close: mocks.close, reconnect: vi.fn() }),
}));

describe('WorkspaceMaterialsPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks();    mocks.get.mockResolvedValue({
      project_id: 'p1', exists: true, root: 'J:/ws/p1', health: 'ok',
      counts: { total: 3, video: 2, image: 1, audio: 0, other: 0, indexed: 2, pending: 1 },
      index: { vision: true, provider: 'transformers' },
      scan: { auto: true, last_scan_at: '2026-10-24T10:00:00Z' },
    });
    mocks.materials.mockResolvedValue({
      project_id: 'p1', root: 'J:/ws/p1', count: 1, pending: 1,
      items: [{
        sha256: 'abc12345', path: 'J:/ws/p1/materials/video/a.mp4', rel: 'video/a.mp4',
        kind: 'video', size: 1024, status: 'indexed', tags: ['舞台', '特写'],
        vision: { status: 'ok' },
      }],
    });
    mocks.scan.mockResolvedValue({
      scanned: 3, changed: 1, new: 1, deduped: 0, indexed: 1, deferred: 0, failed: 0,
    });
    mocks.events.mockResolvedValue({ project_id: 'p1', events: [], last_seq: 0 });
  });

  afterEach(() => cleanup());

  it('显示工作区路径、计数与素材行', async () => {
    render(<WorkspaceMaterialsPanel projectId="p1" />);
    expect(await screen.findByText(/J:\/ws\/p1/)).toBeTruthy();
    expect(screen.getByText(/素材 3（视频 2 \/ 图 1 \/ 音 0）/)).toBeTruthy();
    expect(screen.getByText('video/a.mp4')).toBeTruthy();
    expect(screen.getByText(/舞台、特写/)).toBeTruthy();
  });

  it('点「立即扫描」调用后端并刷新', async () => {
    render(<WorkspaceMaterialsPanel projectId="p1" />);
    await screen.findByText(/素材 3/);
    fireEvent.click(screen.getByRole('button', { name: /立即扫描/ }));
    await waitFor(() => expect(mocks.scan).toHaveBeenCalledWith('p1'));
    expect(await screen.findByText(/新增 1/)).toBeTruthy();
  });

  it('没有 projectId 时给出提示而不是报错', () => {
    render(<WorkspaceMaterialsPanel projectId="" />);
    expect(screen.getByText(/启动制作时按项目创建/)).toBeTruthy();
  });
});
