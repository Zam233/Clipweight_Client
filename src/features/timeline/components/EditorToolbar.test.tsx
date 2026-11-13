// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, waitFor, cleanup, screen } from '@testing-library/react';
import { extractImportError, EditorToolbar } from './EditorToolbar';

const { mocks, stores } = vi.hoisted(() => {
  const stores = {
    project: {
      projectName: '\u6d4b\u8bd5\u9879\u76ee',
      isSaving: false,
      lastSavedAt: null as string | null,
      saveError: null as string | null,
      projectId: 'proj_1',
      setProjectName: vi.fn(),
      requestSave: vi.fn(),
    },
    preview: {
      isPlaying: false,
      currentTimeSec: 10,
      durationSec: 60,
      fps: 30,
      togglePlay: vi.fn(),
      stepForward: vi.fn(),
      stepBackward: vi.fn(),
      seekToStart: vi.fn(),
      seekToEnd: vi.fn(),
    },
    workspace: {
      panels: { assets: true, agent: true, properties: true },
      togglePanel: vi.fn(),
    },
    history: {
      undoStack: [] as unknown[],
      redoStack: [] as unknown[],
      undo: vi.fn(),
      redo: vi.fn(),
      pushState: vi.fn(),
    },
    timeline: {
      timeline: {
        tracks: [] as Array<{ id: string; kind: string; name: string; clips: unknown[] }>,
      },
      isDirty: false as boolean,
      addTrack: vi.fn(),
      addClip: vi.fn(),
      setTimeline: vi.fn(),
    },
    selection: { selectedClipIds: [] },
    settings: { setCheatSheetOpen: vi.fn() },
  };
  return {
    mocks: {
      toast: vi.fn(), post: vi.fn(), navigate: vi.fn(),
      switchToProxy: vi.fn(), switchToFull: vi.fn(), generate: vi.fn(),
    },
    stores,
  };
});

vi.mock('@/stores/toastStore', () => ({ toast: mocks.toast }));
vi.mock('@/services/api', () => ({
  getApiClient: () => ({ post: mocks.post }),
  proxyApi: {
    switchToProxy: mocks.switchToProxy,
    switchToFull: mocks.switchToFull,
    generate: mocks.generate,
  },
}));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }));

vi.mock('@/stores/projectStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useProjectStore: any = (sel: (s: unknown) => unknown) => sel(stores.project);
  useProjectStore.getState = () => stores.project;
  return { useProjectStore };
});

vi.mock('@/stores/previewStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const usePreviewStore: any = (sel: (s: unknown) => unknown) => sel(stores.preview);
  usePreviewStore.getState = () => stores.preview;
  return { usePreviewStore };
});

vi.mock('@/stores/workspaceStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useWorkspaceStore: any = (sel: (s: unknown) => unknown) => sel(stores.workspace);
  useWorkspaceStore.getState = () => stores.workspace;
  return { useWorkspaceStore };
});

vi.mock('@/stores/historyStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useHistoryStore: any = (sel: (s: unknown) => unknown) => sel(stores.history);
  useHistoryStore.getState = () => stores.history;
  return { useHistoryStore };
});

vi.mock('@/stores/timelineStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useTimelineStore: any = (sel: (s: unknown) => unknown) => sel(stores.timeline);
  useTimelineStore.getState = () => stores.timeline;
  return { useTimelineStore };
});

vi.mock('@/stores/selectionStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useSelectionStore: any = (sel: (s: unknown) => unknown) => sel(stores.selection);
  useSelectionStore.getState = () => stores.selection;
  return { useSelectionStore };
});

vi.mock('@/stores/settingsStore', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const useSettingsStore: any = (sel: (s: unknown) => unknown) => sel(stores.settings);
  useSettingsStore.getState = () => stores.settings;
  return { useSettingsStore };
});

afterEach(() => cleanup());

describe('extractImportError (U6)', () => {
  it('maps 400 to the format-error message', () => {
    const msg = extractImportError({ response: { status: 400 } }, 'EDL \u5bfc\u5165\u5931\u8d25');
    expect(msg).toContain('\u683c\u5f0f\u9519\u8bef');
    expect(msg).toContain('EDL \u5bfc\u5165\u5931\u8d25');
  });

  it('maps 422 to the validation-failure message', () => {
    const msg = extractImportError({ response: { status: 422 } }, 'EDL \u5bfc\u5165\u5931\u8d25');
    expect(msg).toContain('\u6570\u636e\u6821\u9a8c\u5931\u8d25');
  });

  it('maps 500 to the backend-unreachable message', () => {
    const msg = extractImportError({ response: { status: 500 } }, 'EDL \u5bfc\u5165\u5931\u8d25');
    expect(msg).toContain('\u540e\u7aef\u4e0d\u53ef\u8fbe');
  });

  it('maps network errors (no response) to the backend-unreachable message', () => {
    const msg = extractImportError(new Error('Network Error'), 'EDL \u5bfc\u5165\u5931\u8d25');
    expect(msg).toContain('\u540e\u7aef\u4e0d\u53ef\u8fbe');
  });

  it('produces DIFFERENT messages for 400 vs network errors', () => {
    const formatMsg = extractImportError({ response: { status: 400 } }, '\u97f3\u9891\u8f6c\u5f55\u5931\u8d25');
    const networkMsg = extractImportError(new Error('Network Error'), '\u97f3\u9891\u8f6c\u5f55\u5931\u8d25');
    expect(formatMsg).not.toBe(networkMsg);
    expect(formatMsg).toContain('\u683c\u5f0f\u9519\u8bef');
    expect(networkMsg).toContain('\u540e\u7aef\u4e0d\u53ef\u8fbe');
  });
});

describe('U6 toast wiring: audio transcribe failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('toasts the format-error message on 400 and the backend-unreachable message on network errors', async () => {
    const file = new File(['audio'], 'voice.mp3', { type: 'audio/mpeg' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fakeInput: any = { type: '', accept: '', files: [file] };
    fakeInput.click = () => { fakeInput.onchange?.(); };

    const realCreateElement = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation(
      (tagName: string, opts?: ElementCreationOptions) =>
        tagName === 'input' ? (fakeInput as unknown as HTMLElement) : realCreateElement(tagName, opts),
    );

    try {
      mocks.post.mockRejectedValueOnce({ response: { status: 400 } });
      const { container } = render(<EditorToolbar />);
      const micBtn = container.querySelector('button .lucide-mic')?.closest('button') as HTMLButtonElement;
      expect(micBtn).toBeTruthy();

      fireEvent.click(micBtn);
      await waitFor(() => {
        expect(mocks.toast).toHaveBeenCalledWith(
          '\u97f3\u9891\u8f6c\u5f55\u5931\u8d25 \u2014 \u683c\u5f0f\u9519\u8bef\uff1a\u8bf7\u68c0\u67e5\u6587\u4ef6\u5185\u5bb9\u540e\u91cd\u8bd5',
          'error',
        );
      });

      mocks.post.mockRejectedValueOnce(new Error('Network Error'));
      fireEvent.click(micBtn);
      await waitFor(() => {
        expect(mocks.toast).toHaveBeenCalledWith('\u97f3\u9891\u8f6c\u5f55\u5931\u8d25 \u2014 \u540e\u7aef\u4e0d\u53ef\u8fbe', 'error');
      });

    const messages = mocks.toast.mock.calls.map((c) => c[0] as string);
    expect(messages).toHaveLength(2);
    expect(messages[0]).not.toBe(messages[1]);
    } finally {
      createSpy.mockRestore();
    }
  });
});

describe('轮74: SRT 导入只落 caption 轨', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stores.timeline.timeline = { tracks: [] };
  });

  /** 触发 SRT 导入按钮（FileText 图标唯一），返回 addClip 调用参数。 */
  async function importSrt(container: HTMLElement): Promise<unknown[][]> {
    const srt = '1\n00:00:00,000 --> 00:00:02,000\n\u4f60\u597d\n';
    const file = new File([srt], 'a.srt', { type: 'text/plain' });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fakeInput: any = { type: '', accept: '', files: [file] };
    fakeInput.click = () => { void fakeInput.onchange?.(); };
    const realCreateElement = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation(
      (tagName: string, opts?: ElementCreationOptions) =>
        tagName === 'input' ? (fakeInput as unknown as HTMLElement) : realCreateElement(tagName, opts),
    );
    try {
      const btn = container.querySelector('button .lucide-file-text')?.closest('button') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      fireEvent.click(btn);
      // O-字幕导入：解析后先出预览弹窗，确认后才写入时间线
      await waitFor(() => expect(screen.getByTestId('srt-preview')).toBeTruthy());
      fireEvent.click(screen.getByText(/\u5bfc\u5165 \d+ \u6761/));
      await waitFor(() => expect(stores.timeline.addClip).toHaveBeenCalled());
      return stores.timeline.addClip.mock.calls as unknown[][];
    } finally {
      createSpy.mockRestore();
    }
  }

  it('已有 text 轨时新建 caption 轨（字幕不混进 text 轨，样式级联才生效）', async () => {
    stores.timeline.timeline = {
      tracks: [{ id: 'tr_text', kind: 'text', name: 'T1', clips: [] }],
    };
    stores.timeline.addTrack.mockImplementation((kind: string, name: string) => {
      stores.timeline.timeline.tracks.push({ id: 'tr_cap', kind, name, clips: [] });
      return 'tr_cap';
    });

    const { container } = render(<EditorToolbar />);
    const calls = await importSrt(container);

    expect(stores.timeline.addTrack).toHaveBeenCalledWith('caption', '\u5b57\u5e55');
    expect(calls[0][0]).toBe('tr_cap');
  });

  it('已有 caption 轨时直接复用，不再新建', async () => {
    stores.timeline.timeline = {
      tracks: [{ id: 'tr_cap', kind: 'caption', name: '\u5b57\u5e55', clips: [] }],
    };

    const { container } = render(<EditorToolbar />);
    const calls = await importSrt(container);

    expect(stores.timeline.addTrack).not.toHaveBeenCalled();
    expect(calls[0][0]).toBe('tr_cap');
  });
});

// W07 (TL-03): JSON 导入 / 代理切换是「前端本地替换时间线」，必须显式以 local
// 来源写回，真实 store 据此置 isDirty=true；否则状态栏显示「已保存」但内容未落盘。
describe('W07/TL-03: 导入 JSON 与代理切换以 local 来源写回（不误清未保存标记）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stores.timeline.timeline = {
      tracks: [{ id: 'tr', kind: 'video', name: 'V1', clips: [
        { id: 'c1', kind: 'video', start_sec: 0, duration_sec: 3, asset_id: 'orig-1' },
      ] }],
    };
    stores.timeline.isDirty = false;
    // 让 mock 的 setTimeline 复现真实 store 的来源契约：local → isDirty=true。
    // 修复前调用方不传 source，isDirty 保持 false → 用例红；修复后传 local → 绿。
    stores.timeline.setTimeline.mockImplementation(
      (_tl: unknown, options?: { source?: string }) => {
        stores.timeline.isDirty = options?.source === 'local';
      },
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('导入 JSON 后 isDirty=true（setTimeline 收到 local 来源）', async () => {
    const data = {
      tracks: [{ id: 'tr_new', kind: 'video', name: 'V', clips: [
        { id: 'c_new', kind: 'video', start_sec: 0, duration_sec: 2 },
      ] }],
    };
    const file = { name: 'tl.json', text: async () => JSON.stringify(data) };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fakeInput: any = { type: '', accept: '', files: [file] };
    fakeInput.click = () => { void fakeInput.onchange?.(); };
    const realCreateElement = document.createElement.bind(document);
    const createSpy = vi.spyOn(document, 'createElement').mockImplementation(
      (tagName: string, opts?: ElementCreationOptions) =>
        tagName === 'input' ? (fakeInput as unknown as HTMLElement) : realCreateElement(tagName, opts),
    );
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      const { container } = render(<EditorToolbar />);
      // 导入 Timeline JSON 按钮：Upload 图标（lucide-upload）
      const btn = container.querySelector('button .lucide-upload')?.closest('button') as HTMLButtonElement;
      expect(btn).toBeTruthy();
      fireEvent.click(btn);
      await waitFor(() => expect(stores.timeline.setTimeline).toHaveBeenCalled());
      // 关键回归：必须显式传 local 来源
      expect(stores.timeline.setTimeline).toHaveBeenCalledWith(data, { source: 'local' });
      expect(stores.timeline.isDirty).toBe(true);
    } finally {
      confirmSpy.mockRestore();
      createSpy.mockRestore();
    }
  });

  it('代理切换后 isDirty=true（setTimeline 收到 local 来源）', async () => {
    // 后端返回改写后的时间线（asset_id 变化 → changed>0 → 走成功分支）
    const nextTl = {
      tracks: [{ id: 'tr', kind: 'video', name: 'V1', clips: [
        { id: 'c1', kind: 'video', start_sec: 0, duration_sec: 3, asset_id: 'proxy-1' },
      ] }],
    };
    mocks.switchToProxy.mockResolvedValueOnce(nextTl);

    const { container } = render(<EditorToolbar />);
    const btn = container.querySelector('button[aria-label="切换代理/原片"]') as HTMLButtonElement;
    expect(btn).toBeTruthy();
    fireEvent.click(btn);
    await waitFor(() => expect(stores.timeline.setTimeline).toHaveBeenCalled());
    // 关键回归：必须显式传 local 来源
    expect(stores.timeline.setTimeline).toHaveBeenCalledWith(nextTl, { source: 'local' });
    expect(stores.timeline.isDirty).toBe(true);
  });
});

describe('C4：编辑器工具栏插件按钮走受限代理', () => {
  afterEach(() => cleanup());

  function setupPluginSlot(items: unknown[]) {
    // jsdom 无 matchMedia：EditorToolbar 用 useMediaQuery('(min-width:1024px)')
    // 决定是否渲染桌面工具条，必须 stub 成宽屏。
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: true, media: q, onchange: null,
      addEventListener: vi.fn(), removeEventListener: vi.fn(), addListener: vi.fn(),
      removeListener: vi.fn(), dispatchEvent: vi.fn(),
    }));
    vi.doMock('@/features/plugins/usePluginSlots', () => ({
      usePluginSlots: () => items,
    }));
    // 顶部已静态 import 过本模块（无插件 mock 的版本），必须重置注册表才能让
    // 动态 import 拿到带 mock 的实例。
    vi.resetModules();
  }

  it('插件按钮经代理发送 owner/贡献 id，而不是直连业务端点', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    setupPluginSlot([
      {
        kind: 'ui_slot', id: 'tb_act', owner: 'tool_plug', title: '插件动作',
        slot: 'editor.toolbar',
        payload: { action: { endpoint: '/api/tool/execute', method: 'POST', body: { name: 'tool_plug_run', params: { x: 1 } } } },
      },
    ]);
    mocks.post.mockResolvedValue({ data: { ok: true } });
    const { EditorToolbar: FreshToolbar } = await import('./EditorToolbar');
    render(<FreshToolbar />);
    fireEvent.click(await screen.findByRole('button', { name: '插件动作' }));

    await vi.waitFor(() => expect(mocks.post).toHaveBeenCalled());
    const [url, body] = mocks.post.mock.calls[0];
    expect(url).toBe('/api/plugin/proxy/tool_plug/post');
    expect(body).toMatchObject({ action: 'tool', payload: { name: 'tool_plug_run' } });
    expect((body as { contribution_id?: string }).contribution_id).toBe('tb_act');
    confirmSpy.mockRestore();
    vi.doUnmock('@/features/plugins/usePluginSlots');
  });

  it('visibleWhen=false 或无 action 的贡献不渲染、不发请求', async () => {
    setupPluginSlot([
      {
        kind: 'ui_slot', id: 'hidden', owner: 'p', title: '隐藏', slot: 'editor.toolbar',
        visibleWhen: "context.never === 'yes'",
        payload: { action: { endpoint: '/api/tool/execute', method: 'POST', body: { name: 'n' } } },
      },
      { kind: 'ui_slot', id: 'noact', owner: 'p', title: '无动作', slot: 'editor.toolbar' },
    ]);
    mocks.post.mockClear();
    const { EditorToolbar: FreshToolbar } = await import('./EditorToolbar');
    render(<FreshToolbar />);
    expect(screen.queryByRole('button', { name: '隐藏' })).toBeNull();
    expect(screen.queryByRole('button', { name: '无动作' })).toBeNull();
    expect(mocks.post).not.toHaveBeenCalled();
    vi.doUnmock('@/features/plugins/usePluginSlots');
  });
});