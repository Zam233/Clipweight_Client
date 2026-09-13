// @vitest-environment jsdom
/**
 * M8 测试：受信任 bundle 宿主（iframe 沙箱 + postMessage 桥）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { render, screen } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ get: vi.fn(), request: vi.fn() }));

vi.mock('@/services/api', () => ({
  getApiClient: () => ({ get: mocks.get, request: mocks.request }),
}));
vi.mock('@/services/api/sse', () => ({ apiBase: () => '' }));

import { PluginBundleFrame } from './PluginBundleFrame';
import { Slot } from './Slot';

vi.mock('./usePluginSlots', () => ({
  usePluginSlots: () => ([{
    kind: 'ui_slot', id: 'bundle_plug', title: 'Bundle 插件', slot: 'editor.right-panel',
    payload: { bundle: true },
  }]),
}));

beforeEach(() => {
  mocks.get.mockReset();
  mocks.request.mockReset();
});

afterEach(() => {
  cleanup(); // 仓库未开启 vitest globals 自动清理，显式清避免跨用例 DOM 叠加
});

describe('PluginBundleFrame (M8)', () => {
  it('以 sandbox=allow-scripts 的 iframe 加载 /bundle（无 same-origin，拿不到宿主）', () => {
    render(<PluginBundleFrame pluginId="bundle_plug" title="Bundle 插件" />);
    const frame = screen.getByTestId('plugin-bundle-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('src')).toBe('/api/plugin/bundle_plug/bundle');
  });

  it('Slot 在 payload.bundle=true 时走 iframe（而非声明式 layout）', () => {
    render(<Slot name="editor.right-panel" />);
    expect(screen.getByTestId('plugin-bundle-frame')).toBeTruthy();
  });
});
