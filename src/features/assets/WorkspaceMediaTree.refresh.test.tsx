// @vitest-environment jsdom
/**
 * M-04（PRD §5B）：上传成功后 AssetPanel bump 了 refreshCounter，但 WorkspaceMediaTree
 * 的 effect 只依赖 [projectId] → 新文件不出现。
 * 验收：目录树订阅 refreshCounter，bump 后立即重新拉取 mediaTree。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup, act } from '@testing-library/react';
import { useAssetStore } from '@/stores/assetStore';
import { WorkspaceMediaTree } from './WorkspaceMediaTree';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    mediaTree: vi.fn(),
    legacyAssets: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  workspaceApi: {
    mediaTree: mocks.mediaTree,
    legacyAssets: mocks.legacyAssets,
  },
}));

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: (sel: (s: { projectId: string }) => unknown) => sel({ projectId: 'p1' }),
}));

const TREE = {
  root: 'J:/ws/p1',
  count: 1,
  kinds: { video: 1 },
  dirs: [{ dir: 'materials/video', count: 1, files: [{ path: 'a.mp4', rel: 'video/a.mp4', name: 'a.mp4', kind: 'video', size: 10, mtime: 0 }] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mediaTree.mockResolvedValue(TREE);
  mocks.legacyAssets.mockResolvedValue({ assets: [] });
  useAssetStore.setState({ refreshCounter: 0 });
});
afterEach(cleanup);

describe('M-04: 上传后目录树立即刷新', () => {
  it('refreshCounter 变化后重新调用 mediaTree', async () => {
    render(<WorkspaceMediaTree />);
    await waitFor(() => expect(mocks.mediaTree).toHaveBeenCalledTimes(1));

    act(() => { useAssetStore.setState({ refreshCounter: 1 }); });

    await waitFor(() => expect(mocks.mediaTree).toHaveBeenCalledTimes(2));
  });
});
