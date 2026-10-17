// @vitest-environment jsdom
/**
 * F1 集成：调度入口（pipelineId 同步 + 打开抽屉触发 hydrate）。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';

const { hydrate } = vi.hoisted(() => ({ hydrate: vi.fn(async () => {}) }));

vi.mock('@/stores/supervisorStore', () => {
  const state = {
    pipelineId: null as string | null,
    setPipeline: vi.fn(),
    hydrate,
    drawerOpen: false,
    setDrawerOpen: vi.fn(),
  };
  return {
    useSupervisorStore: Object.assign(
      (sel?: (s: typeof state) => unknown) => (sel ? sel(state) : state),
      { getState: () => state },
    ),
  };
});

// SSE 订阅在本测试里只验证「传对了参数」，真连接由 useSupervisorEvents.test.ts 覆盖
const { useEvents } = vi.hoisted(() => ({ useEvents: vi.fn() }));
vi.mock('./useSupervisorEvents', () => ({ useSupervisorEvents: useEvents }));

import { useAgentStore } from '@/stores/agentStore';
import { useSupervisorStore } from '@/stores/supervisorStore';
import { SupervisorLauncher } from './SupervisorLauncher';

const store = useSupervisorStore as unknown as { getState: () => Record<string, unknown> };

beforeEach(() => {
  cleanup();
  vi.clearAllMocks();
  useAgentStore.setState({ pipelineId: null });
});

describe('SupervisorLauncher', () => {
  it('没有管线时入口禁用', () => {
    render(<SupervisorLauncher />);
    const btn = screen.getByRole('button', { name: '打开调度面板' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('有管线时可打开，并触发 hydrate', () => {
    useAgentStore.setState({ pipelineId: 'pl_1' });
    render(<SupervisorLauncher />);
    const btn = screen.getByRole('button', { name: '打开调度面板' });
    expect((btn as HTMLButtonElement).disabled).toBe(false);

    fireEvent.click(btn);
    expect(store.getState().setDrawerOpen).toHaveBeenCalledWith(true);
    expect(hydrate).toHaveBeenCalledWith('pl_1');
  });

  it('pipelineId 变化会同步进 supervisorStore', () => {
    useAgentStore.setState({ pipelineId: 'pl_2' });
    render(<SupervisorLauncher />);
    expect(store.getState().setPipeline).toHaveBeenCalledWith('pl_2');
  });

  it('把 pipelineId 与抽屉开关交给 SSE 订阅（关着不连）', () => {
    useAgentStore.setState({ pipelineId: 'pl_3' });
    render(<SupervisorLauncher />);
    expect(useEvents).toHaveBeenCalledWith('pl_3', false);
  });
});
