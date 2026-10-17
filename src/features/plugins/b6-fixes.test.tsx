// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { evalVisibleWhen, safePluginPath } from './slots';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    register: vi.fn((_opts: unknown) => vi.fn()),  // 记录注册入参，返回注销函数
    fetch: vi.fn(),
  },
}));

vi.mock('@/features/keyboard/KeybindingEngine', () => ({
  keybindingEngine: { register: mocks.register },
}));

vi.mock('@/services/api', () => ({
  getApiClient: () => ({ get: vi.fn(), request: vi.fn() }),
}));

vi.mock('@/stores/toastStore', () => ({ toast: vi.fn() }));

// 贡献由本测试直接喂给 hook（避免真实网络）
vi.mock('./usePluginSlots', () => ({
  usePluginSlots: () => mocks.fetch(),
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

describe('B9 safePluginPath（插件导航路径白名单）', () => {
  it('接受站内绝对路径并去掉尾斜杠', () => {
    expect(safePluginPath('/plugin/foo')).toBe('/plugin/foo');
    expect(safePluginPath('/settings/models/')).toBe('/settings/models');
    expect(safePluginPath(' /plugin/a_b-c.d ')).toBe('/plugin/a_b-c.d');
  });

  it('拒绝外链、协议相对、穿越与查询串', () => {
    expect(safePluginPath('https://evil.example.com')).toBeNull();
    expect(safePluginPath('//evil.example.com')).toBeNull();
    expect(safePluginPath('/a/../../etc/passwd')).toBeNull();
    expect(safePluginPath('/plugin/foo?x=1')).toBeNull();
    expect(safePluginPath('/plugin/foo#h')).toBeNull();
    expect(safePluginPath('plugin/foo')).toBeNull();
    expect(safePluginPath(undefined)).toBeNull();
    expect(safePluginPath(42)).toBeNull();
  });
});

describe('B11 shortcut 消费 visibleWhen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    cleanup();
  });

  const contrib = (visibleWhen?: string) => ({
    slot: 'shortcut' as const,
    id: 'sc1',
    title: '示例快捷键',
    visibleWhen,
    payload: { combo: 'alt+shift+e', action: { endpoint: '/api/tool/execute' } },
  });

  it('可见（无 visibleWhen）→ 注册快捷键', async () => {
    mocks.fetch.mockReturnValue([contrib()]);
    render(<Probe />);
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
    const opts = mocks.register.mock.calls[0]?.[0] as { id?: string; combo?: string };
    expect(opts).toMatchObject({ id: 'plugin:sc1', combo: 'alt+shift+e' });
  });

  it('visibleWhen 求值为假 → 不注册', async () => {
    mocks.fetch.mockReturnValue([contrib('context.hasSelection === true')]);
    render(<Probe />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(mocks.register).not.toHaveBeenCalled();
  });

  it('visibleWhen 求值为真 → 注册', async () => {
    mocks.fetch.mockReturnValue([contrib('context.hasTimeline')]);
    render(<Probe />);
    await waitFor(() => expect(mocks.register).toHaveBeenCalledTimes(1));
  });

  it('visibleWhen 解析失败 → 保守不注册', async () => {
    mocks.fetch.mockReturnValue([contrib('window.location = "x"')]);
    render(<Probe />);
    await waitFor(() => expect(mocks.fetch).toHaveBeenCalled());
    expect(mocks.register).not.toHaveBeenCalled();
    expect(evalVisibleWhen('window.location', {})).toBe(false);
  });
});
