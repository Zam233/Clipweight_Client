// @vitest-environment jsdom
/** PL-02：插件快捷键不得触发任意宿主 API（先红后绿）。 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/react';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    register: vi.fn((_opts: unknown) => vi.fn()),
    contribs: [] as Array<Record<string, unknown>>,
    get: vi.fn(),
    request: vi.fn(),
    confirm: vi.fn(() => true),
  },
}));

vi.mock('@/features/keyboard/KeybindingEngine', () => ({
  keybindingEngine: { register: mocks.register },
}));
vi.mock('@/services/api', () => ({
  getApiClient: () => ({ get: mocks.get, request: mocks.request }),
}));
vi.mock('@/stores/toastStore', () => ({ toast: vi.fn() }));
vi.mock('./usePluginSlots', () => ({
  usePluginSlots: () => mocks.contribs,
}));
vi.mock('@/stores/previewStore', () => ({
  usePreviewStore: (sel: (s: unknown) => unknown) => sel({ isPlaying: false }),
}));
vi.mock('@/stores/selectionStore', () => ({
  useSelectionStore: (sel: (s: unknown) => unknown) => sel({ selectedClipIds: [] }),
}));
vi.mock('@/stores/timelineStore', () => ({
  useTimelineStore: (sel: (s: unknown) => unknown) => sel({ timeline: { tracks: [{}] } }),
}));

import { usePluginShortcuts } from './usePluginShortcuts';

function Probe() {
  usePluginShortcuts();
  return <div>probe</div>;
}

const contrib = (action: Record<string, unknown>) => ({
  slot: 'shortcut',
  id: 'sc1',
  title: '示例快捷键',
  payload: { combo: 'alt+shift+e', action },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.contribs = [];
  mocks.confirm.mockReturnValue(true);
  vi.stubGlobal('confirm', mocks.confirm);
  mocks.get.mockResolvedValue({ data: { ok: true } });
  mocks.request.mockResolvedValue({ data: { ok: true } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('PL-02 快捷键门禁', () => {
  it('未登记端点（删项目）→ 不注册、不发请求', async () => {
    mocks.contribs = [contrib({ endpoint: '/api/project/abc', method: 'DELETE' })];
    render(<Probe />);
    await waitFor(() => expect(mocks.contribs.length).toBe(1));
    expect(mocks.register).not.toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('破坏性方法 PUT/DELETE 即使端点在白名单也不注册', async () => {
    mocks.contribs = [
      contrib({ endpoint: '/api/tool/execute', method: 'DELETE' }),
      contrib({ endpoint: '/api/render/browser', method: 'PUT' }),
    ];
    render(<Probe />);
    await waitFor(() => expect(mocks.contribs.length).toBe(2));
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('编码/穿越路径不注册', async () => {
    mocks.contribs = [contrib({ endpoint: '/api/tool/execute/..%2f..%2fproject/x', method: 'POST' })];
    render(<Probe />);
    await waitFor(() => expect(mocks.contribs.length).toBe(1));
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('白名单 GET 探针 → 注册且触发时只发 GET 到该端点', async () => {
    mocks.contribs = [contrib({ endpoint: '/api/render/browser', method: 'GET' })];
    render(<Probe />);
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
    const handler = (mocks.register.mock.calls[0]?.[0] as { handler?: () => void })?.handler;
    expect(handler).toBeTypeOf('function');
    handler?.();
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith('/api/render/browser'));
    expect(mocks.request).not.toHaveBeenCalled();
  });

  it('白名单 POST 工具执行需用户确认；取消则不发请求', async () => {
    mocks.contribs = [contrib({ endpoint: '/api/tool/execute', method: 'POST' })];
    mocks.confirm.mockReturnValue(false);
    render(<Probe />);
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
    const handler = (mocks.register.mock.calls[0]?.[0] as { handler?: () => void })?.handler;
    handler?.();
    expect(mocks.confirm).toHaveBeenCalled();
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalledWith('/api/tool/execute');
  });
});
