// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

/**
 * settingsStore 连接配置持久化测试。
 * 通过 vi.resetModules() + 动态 import 模拟「关闭页面后重新加载」，
 * 断言 set 写入 localStorage 后新模块实例读取到一致值。
 * W9: wsUrl 已移除。
 */

const CONN_KEY = 'clipwright.connectionPrefs';
// 默认值与 settingsStore 同源（本地 .env 可能覆盖；P0-11 后无 env 时同源为空串）
const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_BASE_URL || '';

async function importFreshStore() {
  vi.resetModules();
  return await import('./settingsStore');
}

describe('settingsStore 连接配置持久化', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.resetModules();
  });

  it('setApiBaseUrl 持久化、setAuthToken 仅驻留内存（不落 localStorage）', async () => {
    const { useSettingsStore } = await importFreshStore();
    useSettingsStore.getState().setApiBaseUrl('http://192.168.1.10:8000');
    useSettingsStore.getState().setAuthToken('test-token-123');

    // localStorage 中应已写入 apiBaseUrl，但绝不能包含 authToken（审计 P0 安全约束）
    const raw = localStorage.getItem(CONN_KEY);
    expect(raw).not.toBeNull();
    const saved = JSON.parse(raw!) as Record<string, unknown>;
    expect(saved.apiBaseUrl).toBe('http://192.168.1.10:8000');
    expect(saved.wsUrl).toBeUndefined();
    expect(saved.authToken).toBeUndefined();

    // 内存中 token 仍可用
    expect(useSettingsStore.getState().authToken).toBe('test-token-123');

    // 模拟刷新页面：apiBaseUrl 恢复，token 按设计归零（仅内存）
    const fresh = await importFreshStore();
    expect(fresh.useSettingsStore.getState().apiBaseUrl).toBe('http://192.168.1.10:8000');
    expect(fresh.useSettingsStore.getState().authToken).toBeNull();
    // W9: 状态里不再有 wsUrl / setWsUrl
    expect((fresh.useSettingsStore.getState() as unknown as Record<string, unknown>).wsUrl).toBeUndefined();
    expect((fresh.useSettingsStore.getState() as unknown as Record<string, unknown>).setWsUrl).toBeUndefined();
  });

  it('旧版本遗留的 localStorage authToken 会被主动擦除', async () => {
    localStorage.setItem(
      CONN_KEY,
      JSON.stringify({ apiBaseUrl: 'http://legacy:8080', authToken: 'legacy-token' }),
    );
    const { useSettingsStore } = await importFreshStore();
    expect(useSettingsStore.getState().authToken).toBeNull();
    expect(useSettingsStore.getState().apiBaseUrl).toBe('http://legacy:8080');
    const raw = JSON.parse(localStorage.getItem(CONN_KEY)!) as Record<string, unknown>;
    expect(raw.authToken).toBeUndefined();
  });

  it('localStorage 无持久化数据时回退到环境变量默认值', async () => {
    const { useSettingsStore } = await importFreshStore();
    expect(useSettingsStore.getState().apiBaseUrl).toBe(DEFAULT_API_BASE_URL);
    expect(useSettingsStore.getState().authToken).toBeNull();
  });

  it('localStorage 数据损坏时回退默认值且不抛异常', async () => {
    localStorage.setItem(CONN_KEY, '{broken json');
    const { useSettingsStore } = await importFreshStore();
    expect(useSettingsStore.getState().apiBaseUrl).toBe(DEFAULT_API_BASE_URL);
    expect(useSettingsStore.getState().authToken).toBeNull();
  });

  it('字段类型非法（如数字）时回退默认值（旧 wsUrl 数据被忽略）', async () => {
    localStorage.setItem(
      CONN_KEY,
      JSON.stringify({ apiBaseUrl: 42, wsUrl: 'ws://x', authToken: 7 }),
    );
    const { useSettingsStore } = await importFreshStore();
    expect(useSettingsStore.getState().apiBaseUrl).toBe(DEFAULT_API_BASE_URL);
    expect(useSettingsStore.getState().authToken).toBeNull();
  });
});
