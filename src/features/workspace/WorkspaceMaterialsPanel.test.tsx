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

  /**
   * M-02（PRD §5B P1）：后端字段未过渲染边界时，对象/数组直进 JSX 会抛
   * "Objects are not valid as a React child" 把整块面板打崩。
   */
  it('M-02：rel/kind/status/tags/vision 为脏形状时面板不白屏', async () => {
    mocks.materials.mockResolvedValue({
      project_id: 'p1', root: 'J:/ws/p1', count: 1, pending: 0,
      items: [{
        sha256: 'dirty01',
        path: { p: '/x' },
        rel: { name: 'video/dirty.mp4' },
        kind: { k: 'video' },
        status: { s: 'indexed' },
        tags: [{ name: '舞台' }, 42, null],
        vision: { status: 'ok', summary: { text: '画面描述' }, tags: [{ name: '夜景' }] },
      }],
    });
    expect(() => render(<WorkspaceMaterialsPanel projectId="p1" />)).not.toThrow();
    // 脏对象被转成可读文本，而不是 [object Object] 或整页崩
    await screen.findByText(/素材 /);
    expect(document.body.textContent).not.toContain('[object Object]');
    expect(document.body.textContent).toContain('video/dirty.mp4');
    expect(document.body.textContent).toContain('舞台');
  });

  it('M-02：failed 索引列表的 rel/reason 为对象时也不崩', async () => {
    mocks.materials.mockResolvedValue({
      project_id: 'p1', root: 'J:/ws/p1', count: 0, pending: 1,
      items: [{
        sha256: 'dirty02', path: 'J:/x', rel: 'video/b.mp4', kind: 'video',
        size: 1, status: 'failed', tags: [],
        vision: { status: 'failed', summary: { why: '解码失败' } },
      }],
    });
    expect(() => render(<WorkspaceMaterialsPanel projectId="p1" />)).not.toThrow();
    await screen.findByText(/素材 /);
    expect(document.body.textContent).not.toContain('[object Object]');
  });

  /**
   * M-03（PRD §5B P2）：快速切项目时，旧项目的响应可能后到并覆盖新项目数据。
   */
  it('M-03：切项目后旧响应不会覆盖新项目数据', async () => {
    // p1 的 materials 故意慢返回，p2 的立即返回
    let resolveP1!: (v: unknown) => void;
    const p1Materials = new Promise((r) => { resolveP1 = r; });
    mocks.materials.mockImplementation((pid: string) => (
      pid === 'p1'
        ? p1Materials
        : Promise.resolve({
          project_id: 'p2', root: 'J:/ws/p2', count: 1, pending: 0,
          items: [{
            sha256: 'p2only', path: 'J:/ws/p2/materials/video/new.mp4',
            rel: 'video/new.mp4', kind: 'video', size: 1, status: 'indexed',
            tags: [], vision: { status: 'ok' },
          }],
        })
    ));

    const { rerender } = render(<WorkspaceMaterialsPanel projectId="p1" />);
    // 立刻切到 p2，此时 p1 的请求还没返回
    rerender(<WorkspaceMaterialsPanel projectId="p2" />);

    await waitFor(() => expect(screen.getByText('video/new.mp4')).toBeTruthy());

    // p1 之后才返回：不得把新项目的行覆盖回旧数据
    resolveP1({
      project_id: 'p1', root: 'J:/ws/p1', count: 1, pending: 0,
      items: [{
        sha256: 'p1only', path: 'J:/ws/p1/materials/video/old.mp4',
        rel: 'video/old.mp4', kind: 'video', size: 1, status: 'indexed',
        tags: [], vision: { status: 'ok' },
      }],
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(screen.queryByText('video/old.mp4')).toBeNull();
    expect(screen.getByText('video/new.mp4')).toBeTruthy();
  });
});
