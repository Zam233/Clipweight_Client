// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, renderHook, act } from '@testing-library/react';

import type { SlotContribution } from './slots';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    slots: vi.fn(),
    probe: vi.fn(),
    trigger: vi.fn(),
  },
}));

vi.mock('./usePluginSlots', () => ({
  usePluginSlots: (slot: string) => mocks.slots(slot),
}));

vi.mock('./overlayActions', async () => {
  const actual = await vi.importActual<typeof import('./overlayActions')>('./overlayActions');
  return {
    ...actual,
    probeEndpoint: mocks.probe,
    triggerEndpoint: mocks.trigger,
  };
});

import { AppOverlayHost, InstallableDependencyDialog } from './AppOverlayHost';
import {
  readInstallableDependency,
  useInstallableDependency,
  type DependencyGate,
} from './useInstallableDependency';

function contribution(over: Partial<SlotContribution> = {}): SlotContribution {
  return {
    slot: 'app.overlay',
    id: 'headless_chrome_install_prompt',
    title: '动画渲染依赖 chrome-headless-shell',
    kind: 'ui_slot',
    order: 10,
    payload: {
      kind: 'installable-dependency',
      probe: { endpoint: '/api/render/browser', path: 'headless_shell' },
      install: { endpoint: '/api/render/browser/install', method: 'POST', pollMs: 20 },
      copy: {
        title: '动画渲染还缺 chrome-headless-shell',
        why: '现在已经在用系统 Chrome 无头 + CPU 软件渲染，功能正常，只是慢一些。',
        benefit: '装到 _cache/browsers/，下载约 120MB。',
        installLabel: '立即安装',
        retryLabel: '重试安装',
        laterLabel: '知道了（本次启动不再提示）',
        successTitle: 'chrome-headless-shell 已安装',
      },
    },
    ...over,
  };
}

/** 带一次性提示声明的贡献（用户要求：一次后端启动只弹一次） */
function contributionWithOnce(over: Partial<SlotContribution> = {}): SlotContribution {
  const base = contribution(over);
  return {
    ...base,
    payload: { ...(base.payload as Record<string, unknown>), once: { scope: 'backend-boot', bootIdField: 'boot_id' } },
  };
}

function probeInstalled(installed: boolean, extra: Record<string, unknown> = {}, bootId = 'boot-a') {
  return {
    boot_id: bootId,
    headless_shell: {
      installed,
      installing: false,
      version: installed ? 'Google Chrome for Testing 156.0.8078.73' : '',
      last_result: { ok: null, message: '' },
      ...extra,
    },
  };
}

function gateOf(over: Partial<DependencyGate> = {}): DependencyGate {
  const payload = readInstallableDependency(contribution())!;
  return {
    payload,
    state: {
      loaded: true,
      installed: false,
      installing: false,
      version: '',
      message: '',
      failed: false,
      waitedSec: 0,
    },
    visible: true,
    showSuccess: false,
    snooze: vi.fn(),
    install: vi.fn().mockResolvedValue(undefined),
    dismissSuccess: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  mocks.slots.mockReset().mockReturnValue([]);
  mocks.probe.mockReset();
  mocks.trigger.mockReset();
  sessionStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('readInstallableDependency', () => {
  it('只接受 installable-dependency 且必须同时声明 probe/install 端点', () => {
    expect(readInstallableDependency(contribution())).not.toBeNull();
    expect(readInstallableDependency(contribution({ payload: { kind: 'other' } }))).toBeNull();
    expect(
      readInstallableDependency(
        contribution({ payload: { kind: 'installable-dependency', probe: { endpoint: '/x' } } }),
      ),
    ).toBeNull();
  });

  it('PL-01：未登记 probe/install 端点 → 整条贡献被丢弃', () => {
    const evil = contribution({
      payload: {
        kind: 'installable-dependency',
        probe: { endpoint: '/api/project/secret' },
        install: { endpoint: '/api/project/delete', method: 'POST' },
      },
    });
    expect(readInstallableDependency(evil)).toBeNull();
    const partial = contribution({
      payload: {
        kind: 'installable-dependency',
        probe: { endpoint: '/api/render/browser' },
        install: { endpoint: '/api/tool/execute', method: 'DELETE' },
      },
    });
    expect(readInstallableDependency(partial)).toBeNull();
  });
});

describe('InstallableDependencyDialog（声明驱动，不认识具体依赖）', () => {
  it('缺失时按 payload 文案弹框，主按钮触发 install', () => {
    const gate = gateOf();
    render(<InstallableDependencyDialog gate={gate} contributionId="headless_chrome_install_prompt" />);

    expect(screen.getByRole('dialog').getAttribute('data-contribution')).toBe(
      'headless_chrome_install_prompt',
    );
    expect(screen.getByText('动画渲染还缺 chrome-headless-shell')).toBeTruthy();
    expect(screen.getByText(/120MB/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '立即安装' }));
    expect(gate.install).toHaveBeenCalledTimes(1);
  });

  it('安装中：等待计时 + 主按钮禁用 + 可先关掉', () => {
    const gate = gateOf({
      state: { ...gateOf().state, installing: true, waitedSec: 8 },
    });
    render(<InstallableDependencyDialog gate={gate} contributionId="x" />);

    expect(screen.getByText(/已等待 8s/)).toBeTruthy();
    expect((screen.getByRole('button', { name: '安装中…' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: '先关掉（后台继续装）' }));
    expect(gate.snooze).toHaveBeenCalled();
  });

  it('失败态显示后端原因并允许重试', () => {
    const gate = gateOf({
      state: { ...gateOf().state, failed: true, message: '下载超时：请检查代理' },
    });
    render(<InstallableDependencyDialog gate={gate} contributionId="x" />);
    expect(screen.getByText(/下载超时：请检查代理/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '重试安装' }));
    expect(gate.install).toHaveBeenCalled();
  });

  it('装好给一次成功确认；Esc 关闭', () => {
    const gate = gateOf({
      state: { ...gateOf().state, installed: true, version: '156.0.8078.73' },
      visible: false,
      showSuccess: true,
    });
    render(<InstallableDependencyDialog gate={gate} contributionId="x" />);
    expect(screen.getByText('chrome-headless-shell 已安装')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(gate.dismissSuccess).toHaveBeenCalled();
  });

  it('可见性由 gate 决定：不缺失就不渲染', () => {
    const gate = gateOf({ visible: false });
    render(<InstallableDependencyDialog gate={gate} contributionId="x" />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('useInstallableDependency（probe → 弹框 → 安装 → 轮询成功）', () => {
  it('探到未安装 → visible；点安装走声明的端点；轮询到已装好 → showSuccess', async () => {
    mocks.probe
      .mockResolvedValueOnce(probeInstalled(false))
      .mockResolvedValue(probeInstalled(true));
    mocks.trigger.mockResolvedValue({ ok: true, message: '安装已启动' });

    const payload = readInstallableDependency(contribution())!;
    const { result } = renderHook(() => useInstallableDependency(contribution(), payload));

    await waitFor(() => expect(result.current.visible).toBe(true));

    await act(async () => {
      await result.current.install();
    });
    expect(mocks.trigger).toHaveBeenCalledWith(
      '/api/render/browser/install', 'POST', '', 'headless_chrome_install_prompt',
    );

    await waitFor(() => expect(result.current.showSuccess).toBe(true));
    expect(result.current.state.version).toContain('156.0.8078.73');
  });

  it('probe 端点不可达 → 静默不弹（不打断宿主）', async () => {
    mocks.probe.mockRejectedValue(new Error('Network Error'));
    const payload = readInstallableDependency(contribution())!;
    const { result } = renderHook(() => useInstallableDependency(contribution(), payload));

    await waitFor(() => expect(result.current.state.loaded).toBe(true));
    expect(result.current.visible).toBe(false);
  });

  it('安装接口回报失败 → failed + 原因', async () => {
    mocks.probe.mockResolvedValue(probeInstalled(false));
    mocks.trigger.mockResolvedValue({ ok: false, message: '代理不可用' });

    const payload = readInstallableDependency(contribution())!;
    const { result } = renderHook(() => useInstallableDependency(contribution(), payload));
    await waitFor(() => expect(result.current.visible).toBe(true));

    await act(async () => {
      await result.current.install();
    });
    expect(result.current.state.failed).toBe(true);
    expect(result.current.state.message).toBe('代理不可用');
  });

  it('点过「稍后再说」→ 本会话不再自动弹', async () => {
    mocks.probe.mockResolvedValue(probeInstalled(false));
    const c = contribution();
    const payload = readInstallableDependency(c)!;
    const { result } = renderHook(() => useInstallableDependency(c, payload));
    await waitFor(() => expect(result.current.visible).toBe(true));

    act(() => result.current.snooze());
    expect(result.current.visible).toBe(false);
    expect(sessionStorage.getItem('cw:overlay-snooze:headless_chrome_install_prompt')).toBe('1');
  });
});

describe('一次性提示：一次后端启动只弹一次', () => {
  it('首次挂载弹出后写标记；同 boot_id 再挂载不弹', async () => {
    mocks.probe.mockResolvedValue(probeInstalled(false, {}, 'boot-1'));
    const c = contributionWithOnce();
    const payload = readInstallableDependency(c)!;

    const first = renderHook(() => useInstallableDependency(c, payload));
    await waitFor(() => expect(first.result.current.visible).toBe(true));
    expect(localStorage.getItem('cw:overlay-shown:headless_chrome_install_prompt:boot-1')).toBe('1');
    first.unmount();

    const second = renderHook(() => useInstallableDependency(c, payload));
    await waitFor(() => expect(second.result.current.state.loaded).toBe(true));
    expect(second.result.current.visible).toBe(false);
  });

  it('后端重启（boot_id 变化）→ 重新提示一次', async () => {
    localStorage.setItem('cw:overlay-shown:headless_chrome_install_prompt:boot-1', '1');
    mocks.probe.mockResolvedValue(probeInstalled(false, {}, 'boot-2'));
    const c = contributionWithOnce();
    const payload = readInstallableDependency(c)!;

    const { result } = renderHook(() => useInstallableDependency(c, payload));
    await waitFor(() => expect(result.current.visible).toBe(true));
  });

  it('已装好时即使没提示过也不弹（不需要装就没提示）', async () => {
    mocks.probe.mockResolvedValue(probeInstalled(true, {}, 'boot-3'));
    const c = contributionWithOnce();
    const payload = readInstallableDependency(c)!;

    const { result } = renderHook(() => useInstallableDependency(c, payload));
    await waitFor(() => expect(result.current.state.loaded).toBe(true));
    expect(result.current.visible).toBe(false);
  });

  it('未声明 once 的贡献不受该门控影响（仍按缺失状态决定）', async () => {
    localStorage.setItem('cw:overlay-shown:headless_chrome_install_prompt:boot-1', '1');
    mocks.probe.mockResolvedValue(probeInstalled(false, {}, 'boot-1'));
    const c = contribution();
    const payload = readInstallableDependency(c)!;

    const { result } = renderHook(() => useInstallableDependency(c, payload));
    await waitFor(() => expect(result.current.visible).toBe(true));
  });
});

describe('AppOverlayHost', () => {
  it('从 app.overlay slot 拉贡献并渲染；非安装类贡献被忽略', async () => {
    mocks.probe.mockResolvedValue(probeInstalled(false));
    mocks.slots.mockReturnValue([
      contribution(),
      contribution({ id: 'some_other_overlay', payload: { kind: 'notice' } }),
    ]);

    render(<AppOverlayHost />);

    expect(mocks.slots).toHaveBeenCalledWith('app.overlay');
    await waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));
    expect(screen.getByText('动画渲染还缺 chrome-headless-shell')).toBeTruthy();
  });

  it('依赖已安装 → 宿主不渲染任何浮层', async () => {
    mocks.probe.mockResolvedValue(probeInstalled(true));
    mocks.slots.mockReturnValue([contribution()]);

    render(<AppOverlayHost />);
    await waitFor(() => expect(mocks.probe).toHaveBeenCalled());
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});
