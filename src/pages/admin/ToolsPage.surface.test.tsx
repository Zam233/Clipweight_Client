// @vitest-environment jsdom
/**
 * PRD B3（2026-10-29 / G5、G12）：Agent 工具面只读页签。
 *
 * 要证伪的四件事：
 * 1. `/api/tools` 的 5 个一等工具 + 2 个领域工具都能在页面上看到；
 * 2. `available=false` 不隐藏（灰显 + 原因）；
 * 3. **不出现任何执行按钮**（目录快照不是执行入口）；
 * 4. 接口失败给可读错误，不白屏。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ToolsPage } from './ToolsPage';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    catalog: vi.fn(),
    schema: vi.fn(),
    records: vi.fn(),
    toolList: vi.fn(),
    skillList: vi.fn(),
    execute: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  toolApi: { list: mocks.toolList, execute: mocks.execute, batch: vi.fn() },
  skillApi: { list: mocks.skillList, execute: vi.fn() },
  // ConsoleShell 会打健康检查
  healthApi: { check: vi.fn(async () => ({ status: 'ok' })) },
}));

vi.mock('@/features/plugins/usePluginSlots', () => ({
  usePluginSlots: () => [],
}));

vi.mock('@tanstack/react-router', () => ({
  useLocation: () => ({ pathname: '/settings/tools' }),
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

vi.mock('@/services/api/toolSurface', () => ({
  toolSurfaceApi: {
    listCatalog: mocks.catalog,
    getSchema: mocks.schema,
    listRecords: mocks.records,
  },
}));

vi.mock('@/stores/settingsStore', () => ({
  useSettingsStore: Object.assign(
    (sel?: (s: Record<string, unknown>) => unknown) => {
      const st = { allowDemoFallback: false };
      return sel ? sel(st) : st;
    },
    { getState: () => ({ allowDemoFallback: false }) },
  ),
}));

const ENTRY = (name: string, extra: Record<string, unknown> = {}) => ({
  name, tier: 'write_local', description: `${name} 描述`,
  available: true, idempotent: false, dry_run: true, cost_hint: '', ...extra,
});

const CATALOG = {
  count: 9,
  tiers: ['read', 'write_local', 'costly'],
  stats: {},
  items: [
    ENTRY('delegate_agent'), ENTRY('research_agent'), ENTRY('get_agent_run'),
    ENTRY('list_agent_runs'), ENTRY('cancel_agent_run'),
    ENTRY('replan_closure'), ENTRY('validate_stage_plan'),
    ENTRY('video_trim'), ENTRY('text_to_speech', { available: false, cost_hint: '按秒计费' }),
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.toolList.mockResolvedValue({ tools: [{ name: 'video_trim' }] });
  mocks.skillList.mockResolvedValue({ skills: [{ name: 'auto_caption' }] });
  mocks.catalog.mockResolvedValue(CATALOG);
  mocks.records.mockResolvedValue({
    count: 1,
    items: [{ name: 'video_trim', status: 'ok', duration_ms: 12, pipeline_id: 'task_a' }],
  });
});

afterEach(cleanup);

async function openSurface(): Promise<void> {
  render(<ToolsPage />);
  fireEvent.click(await screen.findByRole('button', { name: /Agent 工具面/ }));
  await screen.findByTestId('agent-surface');
}

describe('B3 Agent 工具面', () => {
  it('5 个一等工具 + 2 个领域工具都可见', async () => {
    await openSurface();
    const agentGroup = screen.getByTestId('surface-group-agent');
    const domainGroup = screen.getByTestId('surface-group-domain');
    expect(agentGroup.getAttribute('data-count')).toBe('5');
    expect(domainGroup.getAttribute('data-count')).toBe('2');
    for (const name of ['delegate_agent', 'research_agent', 'get_agent_run', 'list_agent_runs', 'cancel_agent_run']) {
      expect(agentGroup.querySelector(`[data-tool-name="${name}"]`)).toBeTruthy();
    }
    for (const name of ['replan_closure', 'validate_stage_plan']) {
      expect(domainGroup.querySelector(`[data-tool-name="${name}"]`)).toBeTruthy();
    }
  });

  it('available=false 灰显但仍显示（不隐藏）', async () => {
    await openSurface();
    const row = document.querySelector('[data-tool-name="text_to_speech"]') as HTMLElement;
    expect(row).toBeTruthy();
    expect(row.getAttribute('data-available')).toBe('false');
    expect(row.textContent).toContain('不可用');
    // 档位与成本提示可见
    expect(row.getAttribute('data-tier')).toBe('write_local');
    expect(row.textContent).toContain('按秒计费');
  });

  it('目录页签没有执行按钮（快照≠执行入口）', async () => {
    await openSurface();
    const surface = screen.getByTestId('agent-surface');
    expect(surface.textContent).toContain('不提供执行按钮');
    // 该页签内不存在「执行 / 批量执行」按钮
    for (const btn of Array.from(surface.querySelectorAll('button'))) {
      expect(btn.textContent ?? '').not.toMatch(/执行/);
    }
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it('调用记录与失败态都有可读输出', async () => {
    await openSurface();
    const recs = screen.getByTestId('surface-records');
    expect(recs.textContent).toContain('video_trim');
    expect(recs.textContent).toContain('task_a');

    cleanup();
    mocks.catalog.mockRejectedValue(new Error('后端离线'));
    render(<ToolsPage />);
    fireEvent.click(await screen.findByRole('button', { name: /Agent 工具面/ }));
    await waitFor(() => expect(screen.getByTestId('surface-error').textContent).toContain('后端离线'));
  });
});
