// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor, cleanup } from '@testing-library/react';
import {
  useBackendHealth,
  useBackendHealthDetail,
  buildHealthComponents,
  componentTone,
} from './useBackendHealth';
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

describe('G5: 30s 心跳轮询', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.check.mockResolvedValue({ status: 'ok' });
  });

  it('每 30s 轮询一次 healthApi.check', async () => {
    vi.useFakeTimers();
    try {
      const { result } = renderHook(() => useBackendHealth());
      expect(mocks.check).toHaveBeenCalledTimes(1);
      await act(async () => { await Promise.resolve(); });
      expect(result.current).toBe('online');

      act(() => { vi.advanceTimersByTime(30000); });
      expect(mocks.check).toHaveBeenCalledTimes(2);
      act(() => { vi.advanceTimersByTime(30000); });
      expect(mocks.check).toHaveBeenCalledTimes(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('卸载后停止轮询', async () => {
    vi.useFakeTimers();
    try {
      const { unmount } = renderHook(() => useBackendHealth());
      expect(mocks.check).toHaveBeenCalledTimes(1);
      unmount();
      act(() => { vi.advanceTimersByTime(90000); });
      expect(mocks.check).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('组件级健康（消费后端 /health 的组件字段）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.check.mockResolvedValue({ status: 'ok' });
  });

  it('detail 版本保留后端组件字段', async () => {
    mocks.check.mockResolvedValue({
      status: 'ok',
      service: 'clipwright-engine',
      mongodb: 'ok',
      llm: 'no_key',
      ffmpeg: 'ok',
      hyperframes: 'not_found',
      queue: 'idle',
      queue_pending: 2,
      queue_running: 1,
    });
    const { result } = renderHook(() => useBackendHealthDetail());
    await waitFor(() => expect(result.current.status).toBe('online'));
    expect(result.current.detail?.mongodb).toBe('ok');
    expect(result.current.detail?.llm).toBe('no_key');
  });

  it('离线时 detail 为空（不伪造组件状态）', async () => {
    mocks.check.mockRejectedValue(new Error('down'));
    const { result } = renderHook(() => useBackendHealthDetail());
    await waitFor(() => expect(result.current.status).toBe('offline'));
    expect(result.current.detail).toBeNull();
    expect(buildHealthComponents(result.current.detail)).toEqual([]);
  });

  it('buildHealthComponents 只翻译后端上报的字段', () => {
    const chips = buildHealthComponents({
      status: 'ok',
      service: 'clipwright-engine',
      mongodb: 'ok',
      llm: 'no_key',
      ffmpeg: 'not_found',
    });
    expect(chips.map((c) => c.key)).toEqual(['mongodb', 'llm', 'ffmpeg']);
    expect(chips[0].tone).toBe('ok');
    expect(chips[1].valueLabel).toBe('未配密钥');
    expect(chips[2].tone).toBe('warn');
  });

  it('队列 chip 带运行/排队数，且未上报的组件不出现', () => {
    const chips = buildHealthComponents({
      status: 'ok',
      service: 'clipwright-engine',
      queue: 'idle',
      queue_pending: 3,
      queue_running: 1,
    });
    expect(chips).toHaveLength(1);
    expect(chips[0].key).toBe('queue');
    expect(chips[0].valueLabel).toContain('1/3');
  });

  it('异常状态映射为 error 色', () => {
    expect(componentTone('disconnected')).toBe('error');
    expect(componentTone('error')).toBe('error');
    expect(componentTone(undefined)).toBe('idle');
    expect(componentTone('checking')).toBe('warn');
  });
});
