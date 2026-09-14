// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { PREF_VERSION, PREF_VERSION_KEY, migrateLocalPrefs, readPrefVersion } from './migrations';

/** 可控的 localStorage 替身 */
function fakeStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
  };
}

describe('migrateLocalPrefs', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('全新环境：把版本号写到最新，无步骤可跑', () => {
    const storage = fakeStorage();
    const report = migrateLocalPrefs(storage);
    expect(report.from).toBe(0);
    expect(report.to).toBe(PREF_VERSION);
    expect(report.applied).toHaveLength(2);
    expect(storage.getItem(PREF_VERSION_KEY)).toBe(String(PREF_VERSION));
  });

  it('幂等：已是当前版本时什么也不做', () => {
    const storage = fakeStorage({ [PREF_VERSION_KEY]: String(PREF_VERSION) });
    const report = migrateLocalPrefs(storage);
    expect(report.applied).toEqual([]);
    expect(report.from).toBe(PREF_VERSION);
  });

  it('v0→v1：清掉明文 token 与残留 WebSocket 地址，并保留备份', () => {
    const storage = fakeStorage({
      'clipwright.connectionPrefs': JSON.stringify({
        apiBaseUrl: 'http://api', authToken: 'secret-token', wsUrl: 'ws://old',
      }),
    });
    const report = migrateLocalPrefs(storage);
    expect(report.applied).toContain('strip-legacy-auth-fields');
    const conn = JSON.parse(storage.getItem('clipwright.connectionPrefs')!);
    expect(conn.apiBaseUrl).toBe('http://api');
    expect('authToken' in conn).toBe(false);
    expect('wsUrl' in conn).toBe(false);
    expect(report.backedUp).toContain('clipwright.connectionPrefs.backup.v0');
    expect(JSON.parse(storage.getItem('clipwright.connectionPrefs.backup.v0')!).authToken).toBe('secret-token');
  });

  it('v1→v2：补齐并钳制默认帧率/分辨率/自动保存/诊断开关', () => {
    const storage = fakeStorage({
      [PREF_VERSION_KEY]: '1',
      'clipwright.editorPrefs': JSON.stringify({
        snapEnabled: true,
        defaultFps: 999,
        defaultResolution: { width: '1920', height: 0 },
        autoSave: 'yes',
      }),
    });
    const report = migrateLocalPrefs(storage);
    expect(report.applied).toEqual(['normalize-editor-prefs']);
    const prefs = JSON.parse(storage.getItem('clipwright.editorPrefs')!);
    expect(prefs.snapEnabled).toBe(true);       // 无关字段原样保留
    expect(prefs.defaultFps).toBe(240);         // 钳到上限
    expect(prefs.defaultResolution).toEqual({ width: 1920, height: 16 });
    expect(prefs.autoSave).toBe(true);          // 类型不对 → 默认
    expect(prefs.showPerfPanel).toBe(false);
    expect(storage.getItem('clipwright.editorPrefs.backup.v1')).not.toBeNull();
  });

  it('没有 editorPrefs 时不凭空创建', () => {
    const storage = fakeStorage({ [PREF_VERSION_KEY]: '1' });
    migrateLocalPrefs(storage);
    expect(storage.getItem('clipwright.editorPrefs')).toBeNull();
    expect(storage.getItem(PREF_VERSION_KEY)).toBe(String(PREF_VERSION));
  });

  it('旧版本损坏的 JSON 不会让迁移链崩掉', () => {
    const storage = fakeStorage({
      'clipwright.connectionPrefs': '{ not json',
      'clipwright.editorPrefs': '[]',
    });
    const report = migrateLocalPrefs(storage);
    expect(report.error).toBeUndefined();
    expect(report.to).toBe(PREF_VERSION);
  });

  it('某步抛错时停在原地、保留进度并给出错误（下次继续）', () => {
    const storage = fakeStorage();
    // 写入一律失败：第一步在写回 connectionPrefs 时抛错，链应停下并报告
    const fragile = {
      getItem: storage.getItem,
      setItem: () => { throw new Error('storage exploded'); },
      removeItem: storage.removeItem,
    };
    const report = migrateLocalPrefs(fragile);
    expect(report.error).toBeDefined();
    expect(report.error).toContain('strip-legacy-auth-fields');
    expect(report.to).toBe(0);              // 版本没有前进
    expect(storage.getItem(PREF_VERSION_KEY)).toBeNull();
  });

  it('没有 localStorage（SSR/受限环境）时直接返回当前版本', () => {
    const report = migrateLocalPrefs(null);
    expect(report.from).toBe(PREF_VERSION);
    expect(report.applied).toEqual([]);
  });

  it('readPrefVersion 容忍非法值', () => {
    expect(readPrefVersion(fakeStorage({ [PREF_VERSION_KEY]: 'abc' }))).toBe(0);
    expect(readPrefVersion(fakeStorage({ [PREF_VERSION_KEY]: '-3' }))).toBe(0);
    expect(readPrefVersion(fakeStorage({ [PREF_VERSION_KEY]: '1' }))).toBe(1);
  });

  it('默认（真实 localStorage）路径可跑通且幂等', () => {
    localStorage.clear();
    const first = migrateLocalPrefs();
    expect(first.applied).toHaveLength(2);
    expect(readPrefVersion()).toBe(PREF_VERSION);
    const second = migrateLocalPrefs();
    expect(second.applied).toEqual([]);
  });
});
