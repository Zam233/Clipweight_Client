// @vitest-environment jsdom
/**
 * D-3b + P6 测试：插件页面壳的匹配与可见性策略。
 *
 * P6 策略（产品确认）：插件页**默认对所有登录用户开放**；插件若声明
 * `payload.admin_only` 则仅管理员可访问（后端不下发 + 前端二次拦截）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';

const mocks = vi.hoisted(() => ({
  slots: vi.fn((): unknown[] => []),
  navigate: vi.fn(),
  pageId: 'open_page',
  isAdmin: true,
  restore: vi.fn(async () => true),
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

vi.mock('@/stores/authStore', () => ({
  useAuthStore: {
    getState: () => ({
      user: mocks.isAdmin ? { role: 'admin' } : { role: 'user' },
      restore: mocks.restore,
    }),
  },
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
  mocks.isAdmin = true;
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
});

describe('P6 插件页 admin_only 策略', () => {
  it('未声明 admin_only → 普通用户可正常渲染（默认对所有登录用户开放）', async () => {
    mocks.slots.mockReturnValue([openPage]);
    mocks.isAdmin = false;
    mocks.pageId = 'open_page';
    render(<PluginPage />);
    expect(screen.getByTestId('plugin-layout')).toBeTruthy();
    expect(screen.queryByText('该插件页面仅管理员可访问。')).toBeNull();
  });

  it('admin_only + 非管理员 → 拒绝渲染并给可读原因', async () => {
    mocks.slots.mockReturnValue([adminPage]);
    mocks.isAdmin = false;
    mocks.pageId = 'admin_page';
    render(<PluginPage />);
    expect(await screen.findByText('该插件页面仅管理员可访问。')).toBeTruthy();
    expect(screen.queryByTestId('plugin-layout')).toBeNull();
  });

  it('admin_only + 管理员 → 正常渲染', async () => {
    mocks.slots.mockReturnValue([adminPage]);
    mocks.isAdmin = true;
    mocks.pageId = 'admin_page';
    render(<PluginPage />);
    await waitFor(() => expect(screen.getByTestId('plugin-layout')).toBeTruthy());
  });
});
