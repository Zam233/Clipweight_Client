// @vitest-environment jsdom
/**
 * M8/B7 测试：受信任 bundle 宿主（iframe 沙箱 + postMessage 桥 + 带凭据取档）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import { render, screen, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), request: vi.fn() }));

vi.mock('@/services/api', () => ({
  getApiClient: () => ({ get: mocks.get, post: mocks.post, request: mocks.request }),
}));
vi.mock('@/services/api/sse', () => ({ apiBase: () => '' }));

import { PluginBundleFrame } from './PluginBundleFrame';
import { Slot } from './Slot';

vi.mock('./usePluginSlots', () => ({
  usePluginSlots: () => ([{
    kind: 'ui_slot', id: 'bundle_plug', owner: 'bundle_owner', title: 'Bundle 插件',
    slot: 'editor.right-panel',
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

/**
 * PL-01：沙箱 iframe **自己**发的 call 也不能借宿主凭据打任意端点。
 * 这里模拟合法来源（e.source === iframe.contentWindow、origin='null'），
 * 旧实现会直接 client.get/request，安全修复后必须先过门禁。
 */
describe('PL-01：插件 iframe 的 call 消息必须过授权门禁', () => {
  beforeEach(() => {
    mocks.get.mockReset();
    mocks.request.mockReset();
    mocks.get.mockRejectedValue(new Error('403'));
    mocks.post.mockResolvedValue({ data: { ok: true } });
  mocks.request.mockResolvedValue({ data: { ok: true } });
  });

  const sendFromFrame = (frame: HTMLIFrameElement, api: Record<string, unknown>) => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { type: 'call', api },
      origin: 'null',
      source: frame.contentWindow,
    }));
  };

  it('恶意 iframe 打 /api/project/xxx DELETE → 拒绝且不发任何请求', async () => {
    render(<PluginBundleFrame pluginId="bundle_plug" title="Bundle 插件" />);
    const frame = screen.getByTestId('plugin-bundle-frame') as HTMLIFrameElement;
    await waitFor(() => expect(frame.getAttribute('src')).toBeTruthy());

    const getCallsBefore = mocks.get.mock.calls.length;
    sendFromFrame(frame, { endpoint: '/api/project/abc', method: 'DELETE' });
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.get.mock.calls.length).toBe(getCallsBefore);
  });

  it('恶意 iframe 打未登记的 /api/plugin/disable POST → 拒绝且不发请求', async () => {
    render(<PluginBundleFrame pluginId="bundle_plug" title="Bundle 插件" />);
    const frame = screen.getByTestId('plugin-bundle-frame') as HTMLIFrameElement;
    await waitFor(() => expect(frame.getAttribute('src')).toBeTruthy());

    const getCallsBefore = mocks.get.mock.calls.length;
    sendFromFrame(frame, { endpoint: '/api/plugin/disable', method: 'POST', body: { id: 'x' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.get.mock.calls.length).toBe(getCallsBefore);
  });

  it('编码穿越 /api/tool/execute/../../project DELETE → 拒绝且不发请求', async () => {
    render(<PluginBundleFrame pluginId="bundle_plug" title="Bundle 插件" />);
    const frame = screen.getByTestId('plugin-bundle-frame') as HTMLIFrameElement;
    await waitFor(() => expect(frame.getAttribute('src')).toBeTruthy());

    const getCallsBefore = mocks.get.mock.calls.length;
    sendFromFrame(frame, { endpoint: '/api/tool/execute/..%2f..%2fproject/x', method: 'DELETE' });
    await new Promise((r) => setTimeout(r, 0));
    expect(mocks.request).not.toHaveBeenCalled();
    expect(mocks.get.mock.calls.length).toBe(getCallsBefore);
  });

  it('白名单内 /api/render/browser GET → 改写为受限代理请求（W01）', async () => {
    mocks.get.mockRejectedValueOnce(new Error('403')); // bundle 取档失败
    mocks.request.mockResolvedValue({ data: { installed: true } });
    render(<PluginBundleFrame pluginId="headless_chrome" title="探针插件" />);
    const frame = screen.getByTestId('plugin-bundle-frame') as HTMLIFrameElement;
    await waitFor(() => expect(frame.getAttribute('src')).toBeTruthy());

    const getCallsBefore = mocks.get.mock.calls.length;
    sendFromFrame(frame, { endpoint: '/api/render/browser', method: 'GET' });
    await waitFor(() => expect(mocks.post).toHaveBeenCalledWith(
      '/api/plugin/proxy/headless_chrome/get',
      expect.objectContaining({ action: 'probe' }),
    ));
    // 不得直达普通宿主 API
    expect(mocks.get.mock.calls.length).toBe(getCallsBefore);
  });
});
