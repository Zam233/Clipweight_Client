// @vitest-environment jsdom
/**
 * PRD B10（2026-10-29 / G16、G2 残留）：素材上传的复用回归用例。
 *
 * 之前素材去重只靠 toast 提示，没有任何自动化用例——一旦后端把 `deduplicated`
 * 又当错误（400），只会被人工发现。这里用最小 mock 覆盖三条路径：
 * 1. 200 + `deduplicated=true` → 页面内出现「已存在，已复用」且**没有**错误提示；
 * 2. 400 → 落到 fallback（本地演示素材）而不是静默；
 * 3. 成功 → 列表被刷新（`assetApi.list` 被再次调用）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { AssetPanel } from './AssetPanel';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    upload: vi.fn(),
    list: vi.fn(),
    toast: vi.fn(),
    projectId: 'proj_1',
  },
}));

vi.mock('@/services/api', () => ({
  assetApi: {
    upload: mocks.upload,
    list: mocks.list,
    listSources: vi.fn(async () => []),
    searchMaterials: vi.fn(async () => []),
    get: vi.fn(), remove: vi.fn(), importPath: vi.fn(), importUrl: vi.fn(),
    fileUrl: () => '', byPathUrl: () => '',
  },
  visionApi: { import: vi.fn(), analyze: vi.fn() },
  toolApi: { list: vi.fn(async () => ({ tools: [] })), execute: vi.fn() },
}));

vi.mock('@/services/media/mediaManager', () => ({
  mediaManager: { registerFile: vi.fn(), getUrl: vi.fn(() => ''), getEntry: vi.fn() },
}));

vi.mock('@/stores/toastStore', () => ({ toast: mocks.toast }));

vi.mock('@/stores/projectStore', () => ({
  useProjectStore: Object.assign(
    (sel?: (s: { projectId: string }) => unknown) => sel ? sel({ projectId: mocks.projectId }) : { projectId: mocks.projectId },
    { getState: () => ({ projectId: mocks.projectId }) },
  ),
}));

vi.mock('@/stores/assetStore', () => {
  const state = {
    assets: [],
    uploadProgress: null,
    refreshCounter: 0,
    setUploadProgress: vi.fn(),
    setAssets: vi.fn(),
    setLoading: vi.fn(),
    removeAsset: vi.fn(),
  };
  return {
    useAssetStore: Object.assign(
      (sel?: (s: Record<string, unknown>) => unknown) => sel ? sel(state) : state,
      { getState: () => state },
    ),
  };
});

vi.mock('@/stores/timelineStore', () => {
  const state = { timeline: { tracks: [], fps: 30, duration_sec: 0 }, addClip: vi.fn(), setTimeline: vi.fn() };
  return {
    useTimelineStore: Object.assign(
      (sel?: (s: Record<string, unknown>) => unknown) => sel ? sel(state) : state,
      { getState: () => state },
    ),
  };
});
vi.mock('@/stores/historyStore', () => ({
  useHistoryStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => sel ? sel({ push: vi.fn(), canUndo: false }) : { push: vi.fn() },
    { getState: () => ({ push: vi.fn() }) },
  ),
}));
vi.mock('@/stores/previewStore', () => ({
  usePreviewStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => sel ? sel({ setPreview: vi.fn() }) : { setPreview: vi.fn() },
    { getState: () => ({ setPreview: vi.fn() }) },
  ),
}));
vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => sel ? sel({ allowDemoFallback: true }) : { allowDemoFallback: true },
    { getState: () => ({ allowDemoFallback: true }) },
  ),
}));

vi.mock('./DubView', () => ({ DubView: () => <div /> }));
vi.mock('./PluginPanel', () => ({ PluginPanel: () => <div /> }));

const PNG = new File([new Uint8Array([1, 2, 3])], 'a.png', { type: 'image/png' });

function pickFile(): void {
  const input = document.querySelector('#asset-upload-input') as HTMLInputElement;
  expect(input).toBeTruthy();
  fireEvent.change(input, { target: { files: [PNG] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]);
});
afterEach(cleanup);

describe('B10 素材上传复用', () => {
  it('200 + deduplicated → 页面内提示「已存在，已复用」，不当成错误', async () => {
    mocks.upload.mockResolvedValue({
      id: 'asset_1', asset_id: 'asset_1', filename: 'a.png', file_path: 'J:/lib/a.png',
      media_type: 'image', deduplicated: true, status: 'reused', used_count: 2,
    });
    render(<AssetPanel />);
    pickFile();

    const note = await screen.findByTestId('asset-upload-note');
    expect(note.textContent).toContain('已存在，已复用');
    expect(note.getAttribute('data-dedup')).toBe('true');
    // 复用仍算成功：列表照常刷新，且没有 "上传失败" 提示
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.stringContaining('上传失败'), 'error');
  });

  it('首次上传（deduplicated 缺省）→ 不显示复用提示', async () => {
    mocks.upload.mockResolvedValue({
      id: 'asset_2', asset_id: 'asset_2', filename: 'a.png', file_path: 'J:/lib/b.png',
      media_type: 'image',
    });
    render(<AssetPanel />);
    pickFile();
    await waitFor(() => expect(mocks.upload).toHaveBeenCalled());
    expect(screen.queryByTestId('asset-upload-note')).toBeNull();
  });

  it('400（真错误）→ 落到 fallback 提示，不假装成功', async () => {
    mocks.upload.mockRejectedValue({ response: { status: 400, data: { detail: '格式不支持' } } });
    render(<AssetPanel />);
    pickFile();

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('上传失败'), 'info'),
    );
    expect(screen.queryByTestId('asset-upload-note')).toBeNull();
  });
});
