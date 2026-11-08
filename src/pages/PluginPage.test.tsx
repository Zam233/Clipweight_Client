// @vitest-environment jsdom
/**
 * D-3b 测试：插件页面壳的匹配策略。
 *
 * 2026-11-08 剥离账号系统：不再有登录用户/管理员角色，admin_only 贡献
 * 在本地单用户模式下照常可见（原 P6 二次拦截随账号体系移除）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  slots: vi.fn((): unknown[] => []),
  navigate: vi.fn(),
  pageId: 'open_page',
}));

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ pageId: mocks.pageId }),
  useNavigate: () => mocks.navigate,
}));

vi.mock('@/features/plugins/usePluginSlots', () => ({
  usePluginSlots: () => mocks.slots(),
}));

vi.mock('@/features/plugins/PluginLayoutRenderer', () => ({
  PluginLayoutRenderer: ({ layout }: { layout: { title?: string } }) => (
    <div data-testid="plugin-layout">{layout?.title ?? 'layout'}</div>
  ),
}));

import { PluginPage } from './PluginPage';

const openPage = {
  kind: 'ui_slot', id: 'open_page', title: '公开插件页', slot: 'page',
  payload: { path: 'open_page' },
  layout: { title: '公开插件页', widgets: [] },
};

const adminPage = {
  kind: 'ui_slot', id: 'admin_page', title: '管理员插件页', slot: 'page',
  payload: { path: 'admin_page', admin_only: true },
  layout: { title: '管理员插件页', widgets: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.pageId = 'open_page';
});

afterEach(() => cleanup());

describe('PluginPage 匹配（D-3b）', () => {
  it('按贡献 id 匹配并渲染布局', () => {
    mocks.slots.mockReturnValue([openPage]);
    render(<PluginPage />);
    expect(screen.getByTestId('plugin-layout')).toBeTruthy();
  });

  it('按 payload.path 匹配（去前导斜杠 / plugin 前缀）', () => {
    mocks.slots.mockReturnValue([{ ...openPage, payload: { path: '/plugin/open_page' } }]);
    render(<PluginPage />);
    expect(screen.getByTestId('plugin-layout')).toBeTruthy();
  });

  it('无匹配 → 提示不存在或已禁用', () => {
    mocks.slots.mockReturnValue([]);
    render(<PluginPage />);
    expect(screen.getByText('插件页面不存在或已被禁用。')).toBeTruthy();
  });

  it('admin_only 贡献在本地单用户模式下照常渲染（账号系统已剥离）', () => {
    mocks.slots.mockReturnValue([adminPage]);
    mocks.pageId = 'admin_page';
    render(<PluginPage />);
    expect(screen.getByTestId('plugin-layout')).toBeTruthy();
  });
});
