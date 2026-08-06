// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import { useBackendHealth } from './useBackendHealth';
import { useSettingsStore } from '@/stores/settingsStore';

const { mocks } = vi.hoisted(() => ({
  mocks: {
    check: vi.fn(),
  },
}));

vi.mock('@/services/api', () => ({
  healthApi: {
    check: mocks.check,
  },
}));

afterEach(() => cleanup());

describe('useBackendHealth', () => {
  const originalApiBaseUrl = useSettingsStore.getState().apiBaseUrl;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.check.mockResolvedValue({ status: 'ok' });
    useSettingsStore.setState({ apiBaseUrl: originalApiBaseUrl });
  });

  it('挂载时调用一次 healthApi.check，成功后状态为 online', async () => {
    const { result } = renderHook(() => useBackendHealth());
    expect(mocks.check).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(result.current).toBe('online'));
  });

  it('apiBaseUrl 变化后重新调用 healthApi.check 并反映新状态', async () => {
    const { result } = renderHook(() => useBackendHealth());
    await waitFor(() => expect(result.current).toBe('online'));
    expect(mocks.check).toHaveBeenCalledTimes(1);

    act(() => {
      useSettingsStore.setState({ apiBaseUrl: 'http://new:8000' });
    });

    await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current).toBe('online'));
  });

  it('apiBaseUrl 变化后不会无限循环', async () => {
    const { result } = renderHook(() => useBackendHealth());
    await waitFor(() => expect(result.current).toBe('online'));

    act(() => {
      useSettingsStore.setState({ apiBaseUrl: 'http://new:8000' });
    });
    await waitFor(() => expect(mocks.check).toHaveBeenCalledTimes(2));

    await act(async () => {
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(mocks.check).toHaveBeenCalledTimes(2);
  });
});
