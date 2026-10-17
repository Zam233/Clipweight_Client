// @vitest-environment jsdom
/**
 * M8/B7 测试：受信任 bundle 宿主（iframe 沙箱 + postMessage 桥 + 带凭据取档）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { render, screen, waitFor } from '@testing-library/react';

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
  // 默认取档失败 → 回落 src 直连（开放模式路径）
  mocks.get.mockRejectedValue(new Error('403'));
});

afterEach(() => {
  cleanup(); // 仓库未开启 vitest globals 自动清理，显式清避免跨用例 DOM 叠加
});

describe('PluginBundleFrame (M8)', () => {
  it('以 sandbox=allow-scripts 的 iframe 加载 /bundle（无 same-origin，拿不到宿主）', async () => {
    render(<PluginBundleFrame pluginId="bundle_plug" title="Bundle 插件" />);
    const frame = screen.getByTestId('plugin-bundle-frame') as HTMLIFrameElement;
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    await waitFor(() => expect(frame.getAttribute('src')).toBe('/api/plugin/bundle_plug/bundle'));
  });

  it('Slot 在 payload.bundle=true 时走 iframe（而非声明式 layout）', () => {
    render(<Slot name="editor.right-panel" />);
    expect(screen.getByTestId('plugin-bundle-frame')).toBeTruthy();
  });
});

describe('B7：带凭据取档（令牌模式 iframe 不再必然 403）', () => {
  it('成功取档 → 用 srcDoc 注入且带 CSP meta，不再用 src', async () => {
    mocks.get.mockResolvedValue({ data: '<html><head></head><body><b>hi</b></body></html>' });
    render(<PluginBundleFrame pluginId="bundle_plug" title="Bundle 插件" />);
    const frame = screen.getByTestId('plugin-bundle-frame') as HTMLIFrameElement;

    await waitFor(() => expect(frame.getAttribute('srcdoc')).toBeTruthy());
    const doc = frame.getAttribute('srcdoc') as string;
    expect(doc).toContain('hi');
    expect(doc).toContain('Content-Security-Policy');
    expect(doc).toContain("default-src 'none'");
    expect(frame.getAttribute('src')).toBeNull();
    expect(frame.getAttribute('data-denied')).toBe('false');
    // 取档走宿主客户端（自动附加 Authorization）
    expect(mocks.get).toHaveBeenCalledWith(
      '/api/plugin/bundle_plug/bundle', { responseType: 'text' },
    );
  });

  it('无 <head> 的 HTML 也会注入 CSP（前缀方式）', async () => {
    mocks.get.mockResolvedValue({ data: '<div>bare</div>' });
    render(<PluginBundleFrame pluginId="bundle_plug" title="Bundle 插件" />);
    const frame = screen.getByTestId('plugin-bundle-frame') as HTMLIFrameElement;
    await waitFor(() => expect(frame.getAttribute('srcdoc')).toBeTruthy());
    const doc = frame.getAttribute('srcdoc') as string;
    expect(doc.startsWith('<meta http-equiv="Content-Security-Policy"')).toBe(true);
    expect(doc).toContain('bare');
  });

  it('取档被拒（403）→ 回落 src 直连并标记 denied', async () => {
    mocks.get.mockRejectedValue(new Error('Request failed with status code 403'));
    render(<PluginBundleFrame pluginId="bundle_plug" title="Bundle 插件" />);
    const frame = screen.getByTestId('plugin-bundle-frame') as HTMLIFrameElement;
    await waitFor(() => expect(frame.getAttribute('data-denied')).toBe('true'));
    expect(frame.getAttribute('srcdoc')).toBeNull();
    expect(frame.getAttribute('src')).toBe('/api/plugin/bundle_plug/bundle');
  });

  it('空响应体也视为被拒（不注入空文档）', async () => {
    mocks.get.mockResolvedValue({ data: '   ' });
    render(<PluginBundleFrame pluginId="bundle_plug" title="Bundle 插件" />);
    const frame = screen.getByTestId('plugin-bundle-frame') as HTMLIFrameElement;
    await waitFor(() => expect(frame.getAttribute('data-denied')).toBe('true'));
    expect(frame.getAttribute('srcdoc')).toBeNull();
  });

  it('B16：只接受本 iframe 且 origin 为 null/同源的消息（其它窗口被忽略）', async () => {
    mocks.get.mockRejectedValue(new Error('x'));
    render(<PluginBundleFrame pluginId="bundle_plug" title="Bundle 插件" />);
    const frame = screen.getByTestId('plugin-bundle-frame') as HTMLIFrameElement;

    // 伪造消息：e.source 不是本 iframe → 不得触发 API 调用
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'call', api: { endpoint: '/api/evil', method: 'GET' } },
      origin: 'null',
      source: window,
    }));
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.get).not.toHaveBeenCalledWith('/api/evil');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  });
});
