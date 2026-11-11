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

/**
 * E-07：自动保存 / 默认帧率 / 默认分辨率三项设置刷新后失效。
 * loadEditorPrefs() 的返回值缺这三项，读取端却从返回值里取，恒为 undefined。
 * 这里用「写入 → resetModules 重新加载 → 读回」复现刷新场景。
 */
describe('E-07 编辑器偏好持久化（autoSave / defaultFps / defaultResolution）', () => {
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.resetModules());

  it('关掉自动保存、改帧率与竖屏分辨率后，刷新仍保持用户值', async () => {
    const { useSettingsStore } = await importFreshStore();
    useSettingsStore.getState().setAutoSave(false);
    useSettingsStore.getState().setDefaultFps(25);
    useSettingsStore.getState().setDefaultResolution({ width: 1080, height: 1920 });

    const fresh = await importFreshStore();
    const s = fresh.useSettingsStore.getState();
    expect(s.autoSave).toBe(false);
    expect(s.defaultFps).toBe(25);
    expect(s.defaultResolution).toEqual({ width: 1080, height: 1920 });
  });

  it('未存过偏好时回落默认值（true / 30 / 1920×1080）', async () => {
    const { useSettingsStore } = await importFreshStore();
    const s = useSettingsStore.getState();
    expect(s.autoSave).toBe(true);
    expect(s.defaultFps).toBe(30);
    expect(s.defaultResolution).toEqual({ width: 1920, height: 1080 });
  });

  it('损坏的偏好值由迁移链与读取端共同收敛，不把 NaN / 字符串写进状态', async () => {
    // migrateLocalPrefs 在模块加载时会把 -1 钳到合法下界 1、把非数字分辨率补默认；
    // 读取端再校验一次。这里断言结果始终是合法数字而非 NaN / 字符串。
    localStorage.setItem('clipwright.editorPrefs', JSON.stringify({
      autoSave: 'no', defaultFps: -1, defaultResolution: { width: 'x', height: 0 },
    }));
    const { useSettingsStore } = await importFreshStore();
    const s = useSettingsStore.getState();
    expect(s.autoSave).toBe(true);
    expect(typeof s.defaultFps).toBe('number');
    expect(Number.isFinite(s.defaultFps)).toBe(true);
    expect(s.defaultFps).toBeGreaterThanOrEqual(1);
    expect(typeof s.defaultResolution.width).toBe('number');
    expect(typeof s.defaultResolution.height).toBe('number');
    expect(s.defaultResolution.width).toBeGreaterThanOrEqual(16);
    expect(s.defaultResolution.height).toBeGreaterThanOrEqual(16);
    expect(s.defaultResolution.width).toBeLessThanOrEqual(7680);
    expect(s.defaultResolution.height).toBeLessThanOrEqual(7680);
  });
});
