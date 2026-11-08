// @vitest-environment jsdom
// 用户 2026-10-31：调度按钮与调度面板整体下线 → 这里只钉"不再渲染入口"。
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

vi.mock('@/services/api', () => ({ supervisorApi: {} }));
vi.mock('@/stores/supervisorStore', () => ({
  useSupervisorStore: (sel: (s: Record<string, unknown>) => unknown) => sel({
    drawerOpen: false, setDrawerOpen: vi.fn(), setActiveTab: vi.fn(),
    pendingApprovals: [], pendingReviews: [], hydrateReviews: vi.fn(),
    currentId: '', setPipeline: vi.fn(), hydrate: vi.fn(),
  }),
}));
vi.mock('./useSupervisorEvents', () => ({ useSupervisorEvents: () => undefined }));

import { SupervisorLauncher } from './SupervisorLauncher';

describe('SupervisorLauncher（已下线）', () => {
  it('不再渲染「调度」按钮与调度面板', () => {
    const { container } = render(<SupervisorLauncher />);
    expect(container.querySelector('button')).toBeNull();
    expect(container.textContent).toBe('');
  });
});
