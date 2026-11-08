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

// AGENTS #22：上传统一走工作区（materials/ 是唯一用户写入区），旧 assetApi.upload 已退役。
vi.mock('@/services/api/workspace', () => ({ workspaceApi: { upload: mocks.upload } }));

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
    // T3.2：上传入口只在「工作区」Tab 渲染（AI 匹配/配音/插件页不挂上传）。
    activeTab: 'workspace',
    uploadProgress: null,
    refreshCounter: 0,
    setUploadProgress: vi.fn(),
    setAssets: vi.fn(),
    setLoading: vi.fn(),
    removeAsset: vi.fn(),
    setState: vi.fn(),
  };
  return {
    useAssetStore: Object.assign(
      (sel?: (s: Record<string, unknown>) => unknown) => sel ? sel(state) : state,
      {
        getState: () => state,
        setState: (updater: (s: Record<string, unknown>) => Record<string, unknown>) =>
          Object.assign(state, updater(state)),
      },
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

async function pickFile(): Promise<void> {
  // 首次 list 拉取完成前是骨架屏；等 input 出现再改文件（B10 用例旧写法是同步取，已不稳）。
  const input = await waitFor(() => {
    const el = document.querySelector('#asset-upload-input') as HTMLInputElement | null;
    if (!el) throw new Error('upload input 尚未渲染');
    return el;
  });
  fireEvent.change(input, { target: { files: [PNG] } });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue([]);
});
afterEach(cleanup);

describe('素材上传（工作区路径，AGENTS #22）', () => {
  it('上传成功 → 页面内提示已写入 materials/，并刷新列表', async () => {
    mocks.upload.mockResolvedValue({ ok: true });
    render(<AssetPanel />);
    await pickFile();

    const note = await screen.findByTestId('asset-upload-note');
    expect(note.textContent).toContain('已上传到工作区 materials/');
    await waitFor(() => expect(mocks.list).toHaveBeenCalled());
    expect(mocks.toast).not.toHaveBeenCalledWith(expect.stringContaining('失败'), 'error');
  });

  it('同名 409 → 提示改名，不假装成功', async () => {
    mocks.upload.mockRejectedValue({ response: { status: 409, data: { detail: 'exists' } } });
    render(<AssetPanel />);
    await pickFile();

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('同名文件已存在'), 'error'),
    );
    expect(screen.queryByTestId('asset-upload-note')).toBeNull();
  });

  it('400（真错误）→ 透出后端 detail，不假装成功', async () => {
    mocks.upload.mockRejectedValue({ response: { status: 400, data: { detail: '格式不支持' } } });
    render(<AssetPanel />);
    await pickFile();

    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.stringContaining('格式不支持'), 'error'),
    );
    expect(screen.queryByTestId('asset-upload-note')).toBeNull();
  });
});
