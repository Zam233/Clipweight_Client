// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { SettingsPage } from './SettingsPage';
import { CONSOLE_NAV } from '@/features/settings/consoleNav';

// 没有 cleanup 时上一个用例的 DOM 会留在 body 里，结构断言会看到两份页面
afterEach(() => cleanup());

vi.mock('@/services/api', () => ({
  healthApi: { check: vi.fn().mockResolvedValue({ status: 'ok' }) },
  assetApi: { listSources: vi.fn().mockResolvedValue([]) },
  resetApiClient: vi.fn(),
  getApiClient: () => ({ get: vi.fn().mockResolvedValue({ data: { pipelines: 0, renders: 0, llm_tokens_month: 0, llm_tokens_total: 0 } }) }),
}));

vi.mock('@/services/api/client', () => ({
  getApiClient: () => ({ get: vi.fn().mockResolvedValue({ data: { pipelines: 0, renders: 0, llm_tokens_month: 0, llm_tokens_total: 0 } }) }),
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: () => ({
    apiBaseUrl: 'http://localhost:8000',
    setApiBaseUrl: vi.fn(),
    theme: 'dark',
    setTheme: vi.fn(),
    language: 'zh',
    setLanguage: vi.fn(),
    defaultFps: 30,
    setDefaultFps: vi.fn(),
    snapThresholdPx: 8,
    setSnapThreshold: vi.fn(),
    snapEnabled: true,
    setSnapEnabled: vi.fn(),
    showFramesInRuler: false,
    setShowFramesInRuler: vi.fn(),
    defaultResolution: { width: 1920, height: 1080 },
    setDefaultResolution: vi.fn(),
    autoSave: true,
    setAutoSave: vi.fn(),
    allowDemoFallback: false,
    setAllowDemoFallback: vi.fn(),
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

describe('SettingsPage (U2 / U16a)', () => {
  it('does not render the removed WebSocket address field', () => {
    render(<SettingsPage />);
    expect(screen.queryByText('WebSocket 地址')).toBeNull();
    // API field still present
    expect(screen.getByText('API 地址')).toBeTruthy();
  });

  it('renders the content container centered (mx-auto)', () => {
    const { container } = render(<SettingsPage />);
    const wrapper = container.querySelector('.max-w-4xl');
    expect(wrapper).toBeTruthy();
    expect(wrapper!.className).toContain('mx-auto');
  });
});

/**
 * 轮 148：设置页重排——偏好在前、控制台入口按左栏顺序、插件分区在最后。
 * 这些断言是"点进去太乱"这个问题的正面回归：顺序必须等于 `CONSOLE_NAV`。
 */
describe('SettingsPage 结构（轮 148 重排）', () => {
  it('本机偏好分区在前，系统控制台入口在后', () => {
    render(<SettingsPage />);
    const prefs = screen.getByText('本机偏好');
    const console_ = screen.getByText('系统控制台');
    // 文档顺序：偏好分区必须出现在控制台入口之前
    expect(prefs.compareDocumentPosition(console_) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('控制台入口顺序与左栏 CONSOLE_NAV 完全一致', () => {
    render(<SettingsPage />);
    // 取每个标签在 DOM 中的最后一个元素（避免与其它分区同名文本混淆），
    // 再按文档位置排序——结果必须还原 CONSOLE_NAV 的顺序。
    const ordered = CONSOLE_NAV
      .map((item) => ({ label: item.label, el: screen.getAllByText(item.label).at(-1)! }))
      .sort((a, b) =>
        (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1)
      .map((r) => r.label);
    expect(ordered).toEqual(CONSOLE_NAV.map((i) => i.label));
  });

  it('每一项控制台入口都渲染了（不漏项）', () => {
    render(<SettingsPage />);
    for (const item of CONSOLE_NAV) {
      expect(screen.getAllByText(item.label).length).toBeGreaterThanOrEqual(1);
    }
  });
});
