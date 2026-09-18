// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import { PluginsPage } from './PluginsPage';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    list: vi.fn(), discover: vi.fn(), disable: vi.fn(), enable: vi.fn(),
    getUI: vi.fn(), errors: vi.fn(), clearErrors: vi.fn(),
    // 轮 148：插件页新增健康聚合与贡献清单（对应 /api/plugin/health、/api/plugin/contributions）
    health: vi.fn(), contributions: vi.fn(), remove: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  pluginApi: {
    list: mocks.list,
    discover: mocks.discover,
    disable: mocks.disable,
    enable: mocks.enable,
    getUI: mocks.getUI,
    errors: mocks.errors,
    clearErrors: mocks.clearErrors,
    health: mocks.health,
    contributions: mocks.contributions,
    remove: mocks.remove,
  },
  healthApi: {
    check: vi.fn(async () => ({ status: 'ok' })),
  },
}));

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/settings/plugins' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

afterEach(() => cleanup());

describe('PluginsPage 贡献可见性（B2/C1）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.discover.mockResolvedValue([]);
    mocks.errors.mockResolvedValue([]);
    mocks.health.mockResolvedValue({ overall: 'ok', plugins: [], errors_total: 0 });
    mocks.contributions.mockResolvedValue({ contributions: [], total: 0 });
  });

  it('展示已注册贡献计数，并在 hover 标题里列出 kind:id', async () => {
    mocks.list.mockResolvedValue([{
      manifest: { id: 'plug_c', name: 'C', kind: 'capability', version: '1.0.0' },
      enabled: true,
      contributions: [{ kind: 'tool', id: 'c_tool' }, { kind: 'ui_slot', id: 'c_panel' }],
    }]);
    render(<PluginsPage />);
    expect(await screen.findByText('2 贡献')).toBeTruthy();
  });

  it('声明未注册（缺配置）→ 显示「N 项未生效」并带可读提示', async () => {
    mocks.list.mockResolvedValue([{
      manifest: { id: 'plug_d', name: 'D', kind: 'material_source', version: '1.0.0' },
      enabled: true,
      contributions: [],
      declared_only: ['material_source:pexels'],
    }]);
    render(<PluginsPage />);
    const badge = await screen.findByTestId('declared-only-plug_d');
    expect(badge.textContent).toContain('1 项未生效');
    expect(badge.getAttribute('title')).toContain('material_source:pexels');
  });

  it('未加载的插件不显示「未生效」告警（避免噪音）', async () => {
    mocks.list.mockResolvedValue([{
      manifest: { id: 'plug_e', name: 'E', kind: 'capability', version: '1.0.0' },
      enabled: false,
      contributions: [],
      declared_only: ['tool:e_tool'],
    }]);
    render(<PluginsPage />);
    await waitFor(() => expect(screen.getByText('plug_e')).toBeTruthy());
    expect(screen.queryByTestId('declared-only-plug_e')).toBeNull();
  });
});

const loadedPlugin = {
  manifest: { id: 'plug_a', name: '插件A', kind: 'capability', version: '1.0.0' },
  enabled: true,
};

describe('PluginsPage M8 启停持久化', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockResolvedValue([loadedPlugin]);
    mocks.discover.mockResolvedValue([]);
    mocks.disable.mockResolvedValue({ status: 'ok' });
    mocks.enable.mockResolvedValue({ status: 'ok' });
    mocks.getUI.mockResolvedValue({ widgets: [{ type: 'text', content: '插件界面', size: 'body' }] });
    mocks.errors.mockResolvedValue([{ plugin_id: 'plug_a', phase: 'load', message: '导入失败', details: '', ts: 1700000000 }]);
    mocks.clearErrors.mockResolvedValue({ status: 'ok', removed: 1 });
    mocks.health.mockResolvedValue({ overall: 'ok', plugins: [], errors_total: 0 });
    mocks.contributions.mockResolvedValue({ contributions: [], total: 0 });
  });

  it('已加载插件点击开关 → 调用 pluginApi.disable（持久化禁用）', async () => {
    render(<PluginsPage />);
    const toggle = await screen.findByTitle('禁用（持久化）');
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.disable).toHaveBeenCalledWith('plug_a'));
  });

  it('未加载插件点击开关 → 调用 pluginApi.enable（持久化启用）', async () => {
    mocks.list.mockResolvedValue([]);
    mocks.discover.mockResolvedValue(['plug_b']);
    render(<PluginsPage />);
    const toggle = await screen.findByTitle('启用（持久化）');
    fireEvent.click(toggle);
    await waitFor(() => expect(mocks.enable).toHaveBeenCalledWith('plug_b'));
  });

  it('UI 预览按钮加载 ui.json 并渲染插件界面（M12）', async () => {
    render(<PluginsPage />);
    fireEvent.click(await screen.findByTitle('UI 预览'));
    expect(await screen.findByText('插件界面')).toBeTruthy();
    expect(mocks.getUI).toHaveBeenCalledWith('plug_a');
  });

  it('无 UI 定义的插件预览显示提示', async () => {
    mocks.getUI.mockResolvedValue({ widgets: [] });
    render(<PluginsPage />);
    fireEvent.click(await screen.findByTitle('UI 预览'));
    expect(await screen.findByText(/未定义 UI/)).toBeTruthy();
  });

  it('错误通道按钮加载并展示插件错误（M7）', async () => {
    render(<PluginsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /错误通道/ }));
    expect(await screen.findByText('导入失败')).toBeTruthy();
    expect((await screen.findAllByText('plug_a')).length).toBeGreaterThanOrEqual(2);
    expect(mocks.errors).toHaveBeenCalled();
  });

  it('错误通道清空调用 pluginApi.clearErrors', async () => {
    render(<PluginsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /错误通道/ }));
    fireEvent.click(await screen.findByRole('button', { name: /清空/ }));
    await waitFor(() => expect(mocks.clearErrors).toHaveBeenCalled());
  });
});

/**
 * 轮 148：把 `/settings/plugins` 补成"完整功能"——健康聚合、贡献清单、卸载删除。
 * 这三项此前后端有端点、前端完全没有入口（用户看不到"为什么插件装了没生效"）。
 */
describe('PluginsPage 完整能力（轮 148）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.discover.mockResolvedValue([]);
    mocks.errors.mockResolvedValue([]);
    mocks.list.mockResolvedValue([loadedPlugin]);
    mocks.contributions.mockResolvedValue({ contributions: [], total: 0 });
  });

  it('健康聚合：总体状态与每插件 issues 展示在列表上', async () => {
    mocks.health.mockResolvedValue({
      overall: 'degraded',
      errors_total: 3,
      prompts_registered: 5,
      plugins: [{
        plugin_id: 'plug_a', name: '插件A', version: '1.0.0', status: 'degraded',
        issues: ['缺依赖 [numpy]'], enabled: true, signed: true, verified: false,
        dependency_ok: false, missing_dependencies: ['numpy'], hooks: 2, agents: 1,
      }],
    });
    render(<PluginsPage />);

    // 机架行显示总体健康 + 错误数 + prompt 数
    expect(await screen.findByText(/HEALTH:DEGRADED/)).toBeTruthy();
    // 签名校验失败与缺依赖都要可见（这正是"装了没生效"的原因）
    expect(await screen.findByText('签名校验失败')).toBeTruthy();
    expect(screen.getByText('缺依赖')).toBeTruthy();
    // 每插件问题摘要
    expect(screen.getByText(/缺依赖 \[numpy\]/)).toBeTruthy();
  });

  it('健康详情弹层列出全部插件的状态/签名/依赖/Hook/Agent', async () => {
    mocks.health.mockResolvedValue({
      overall: 'ok',
      errors_total: 0,
      plugins: [{
        plugin_id: 'plug_a', name: '插件A', version: '1.0.0', status: 'ok',
        issues: [], enabled: true, signed: true, verified: true,
        dependency_ok: true, missing_dependencies: [], hooks: 4, agents: 2,
      }],
      style_interpreter: { active: 'plug_a', candidates: [{ owner: 'plug_a', priority: 10 }] },
    });
    render(<PluginsPage />);
    await screen.findByTitle('禁用（持久化）');

    fireEvent.click(screen.getByRole('button', { name: /健康详情/ }));
    expect(await screen.findByText('插件健康详情')).toBeTruthy();
    expect(await screen.findByText(/4 hook · 2 agent/)).toBeTruthy();
    // 风格解释器活跃 owner：多注册时用户必须知道谁在生效（行内摘要与弹层各一处）
    expect(screen.getAllByText(/风格解释器/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/plug_a\(p10\)/)).toBeTruthy();
  });

  it('贡献清单按 owner 查询并列出 kind / 标题 / owner', async () => {
    mocks.health.mockResolvedValue({ overall: 'ok', plugins: [], errors_total: 0 });
    mocks.contributions.mockResolvedValue({
      contributions: [
        { kind: 'tool', id: 't1', owner: 'plug_a', meta: {}, title: '我的工具' },
        { kind: 'ui_slot', id: 's1', owner: 'plug_a', meta: {}, slot: 'settings.section' },
      ],
      total: 2,
    });
    render(<PluginsPage />);
    await screen.findByTitle('禁用（持久化）');

    fireEvent.click(screen.getByRole('button', { name: /贡献清单/ }));
    expect(await screen.findByText('我的工具')).toBeTruthy();
    expect(screen.getByText('settings.section')).toBeTruthy();
    // 空过滤 = 全量查询
    await waitFor(() => expect(mocks.contributions).toHaveBeenCalledWith({}));

    // 按 owner 过滤后重新查询
    fireEvent.change(screen.getByPlaceholderText(/插件 id/), { target: { value: 'plug_a' } });
    fireEvent.click(screen.getByRole('button', { name: /查询/ }));
    await waitFor(() => expect(mocks.contributions).toHaveBeenCalledWith({ owner: 'plug_a' }));
  });

  it('删除插件需要确认，确认后调用 pluginApi.remove 并刷新', async () => {
    mocks.health.mockResolvedValue({ overall: 'ok', plugins: [], errors_total: 0 });
    mocks.remove.mockResolvedValue({ status: 'ok' });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      render(<PluginsPage />);
      fireEvent.click(await screen.findByTitle('删除插件（从插件目录移除）'));
      await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith('plug_a'));
      expect(confirmSpy).toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it('取消确认时不删除', async () => {
    mocks.health.mockResolvedValue({ overall: 'ok', plugins: [], errors_total: 0 });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      render(<PluginsPage />);
      fireEvent.click(await screen.findByTitle('删除插件（从插件目录移除）'));
      await new Promise((r) => setTimeout(r, 30));
      expect(mocks.remove).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
