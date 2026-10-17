// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  useKeybindingStore, isValidCombo, KEYBINDING_VERSION,
  findKeybindingConflicts, migrateOverrides, normalizeCombo,
} from './keybindingStore';
import { keybindingEngine } from './KeybindingEngine';

describe('keybindingStore (C4 快捷键自定义)', () => {
  beforeEach(() => {
    localStorage.clear();
    useKeybindingStore.setState({ overrides: {} });
  });

  it('isValidCombo 校验', () => {
    expect(isValidCombo('ctrl+z')).toBe(true);
    expect(isValidCombo('shift+arrowup')).toBe(true);
    expect(isValidCombo('alt+f5')).toBe(true);
    expect(isValidCombo('space')).toBe(true);
    expect(isValidCombo('mod+s')).toBe(true);
    expect(isValidCombo('ctrl+shift+delete')).toBe(true);
    expect(isValidCombo('')).toBe(false);
    expect(isValidCombo('ctrl+')).toBe(false);
    expect(isValidCombo('ctrl+shift+z+extra')).toBe(false);
    expect(isValidCombo('不合法键')).toBe(false);
  });

  it('setCombo / resetCombo / resetAll / getCombo 行为', () => {
    const s = useKeybindingStore.getState();
    s.setCombo('timeline-add-marker', 'ctrl+k');
    expect(useKeybindingStore.getState().getCombo('timeline-add-marker', 'm')).toBe('ctrl+k');
    // 非法 combo 被忽略
    s.setCombo('timeline-add-marker', '不合法');
    expect(useKeybindingStore.getState().getCombo('timeline-add-marker', 'm')).toBe('ctrl+k');
    // 未覆盖 → fallback
    expect(useKeybindingStore.getState().getCombo('nope', 'space')).toBe('space');
    // reset 单个
    s.resetCombo('timeline-add-marker');
    expect(useKeybindingStore.getState().getCombo('timeline-add-marker', 'm')).toBe('m');
  });

  it('overrides 持久化到 localStorage（带结构版本）', () => {
    useKeybindingStore.getState().setCombo('timeline-zoom-in', 'ctrl+=');
    const raw = JSON.parse(localStorage.getItem('clipwright.keybindingOverrides')!);
    expect(raw.version).toBe(KEYBINDING_VERSION);
    expect(raw.overrides['timeline-zoom-in']).toBe('ctrl+=');
  });
});

describe('O-改键健壮性：冲突校验 / 版本迁移 / 严格导入', () => {
  beforeEach(() => {
    localStorage.clear();
    useKeybindingStore.setState({ overrides: {} });
  });

  it('normalizeCombo 归一化大小写与修饰键顺序', () => {
    expect(normalizeCombo('Ctrl+Shift+Z')).toBe('ctrl+shift+z');
    expect(normalizeCombo('shift+ctrl+z')).toBe('ctrl+shift+z');
    expect(normalizeCombo(' Ctrl + Z ')).toBe('ctrl+z');
    expect(normalizeCombo('ctrl+z')).toBe(normalizeCombo('CTRL+Z'));
  });

  it('findKeybindingConflicts 找出同一 combo 的多个绑定', () => {
    const conflicts = findKeybindingConflicts([
      { id: 'a', combo: 'ctrl+z' },
      { id: 'b', combo: 'Ctrl+Z' },      // 归一化后与 a 相同
      { id: 'c', combo: 'shift+z' },
      { id: 'd', combo: '' },            // 未绑定不参与
      { id: 'e', combo: '乱写' },         // 非法不参与
    ]);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].combo).toBe('ctrl+z');
    expect(conflicts[0].ids).toEqual(['a', 'b']);
  });

  it('setCombo 存归一化后的值（冲突判定才有效）', () => {
    useKeybindingStore.getState().setCombo('x', 'Ctrl+Shift+K');
    expect(useKeybindingStore.getState().overrides.x).toBe('ctrl+shift+k');
  });

  it('conflictsWith 能发现覆盖与默认值之间的冲突', () => {
    useKeybindingStore.getState().setCombo('timeline-split', 'ctrl+d');   // 与默认的复制同键
    const conflicts = useKeybindingStore.getState().conflictsWith([
      { id: 'timeline-split', combo: useKeybindingStore.getState().getCombo('timeline-split', 's') },
      { id: 'clip-duplicate', combo: 'ctrl+d' },
    ]);
    expect(conflicts[0].ids.sort()).toEqual(['clip-duplicate', 'timeline-split']);
  });

  it('migrateOverrides：老格式（裸 map）升级并标记 migrated', () => {
    const result = migrateOverrides({ 'timeline-split': 'ctrl+k', bad: '乱写' });
    expect(result.version).toBe(KEYBINDING_VERSION);
    expect(result.overrides).toEqual({ 'timeline-split': 'ctrl+k' });
    expect(result.migrated).toBe(true);
  });

  it('migrateOverrides：已是新格式不重复迁移', () => {
    const result = migrateOverrides({ version: KEYBINDING_VERSION, overrides: { a: 'ctrl+a' } });
    expect(result.migrated).toBe(false);
    expect(result.overrides).toEqual({ a: 'ctrl+a' });
  });

  it('migrateOverrides：未来版本不认识就清空回退（不写坏别人的数据）', () => {
    const result = migrateOverrides({ version: KEYBINDING_VERSION + 5, overrides: { a: 'ctrl+a' } });
    expect(result.overrides).toEqual({});
    expect(result.migrated).toBe(false);
  });

  it('migrateOverrides：垃圾输入返回空覆盖', () => {
    for (const bad of [null, 42, 'str', [], { version: 2, overrides: 'nope' }]) {
      expect(migrateOverrides(bad).overrides).toEqual({});
    }
  });

  it('旧数据在 store 初始化时被迁移并回写', () => {
    localStorage.setItem('clipwright.keybindingOverrides', JSON.stringify({ 'old-bind': 'ctrl+k' }));
    const migrated = migrateOverrides(JSON.parse(localStorage.getItem('clipwright.keybindingOverrides')!));
    expect(migrated.overrides['old-bind']).toBe('ctrl+k');
    expect(migrated.migrated).toBe(true);
  });

  it('importOverrides 严格校验：合法入库、非法拒绝并回报原因', () => {
    const result = useKeybindingStore.getState().importOverrides({
      version: KEYBINDING_VERSION,
      overrides: { good: 'Ctrl+K', 'also-good': 'shift+f5', bad1: '乱写', bad2: 'ctrl+' },
    });
    expect(result.imported).toBe(2);
    expect(result.rejected.map((r) => r.key).sort()).toEqual(['bad1', 'bad2']);
    expect(result.rejected[0].reason).toContain('非法组合键');
    const stored = useKeybindingStore.getState().overrides;
    expect(stored.good).toBe('ctrl+k');       // 归一化后入库
    expect(stored.bad1).toBeUndefined();
  });

  it('importOverrides 解析 JSON 字符串，坏 JSON 整体拒绝', () => {
    const ok = useKeybindingStore.getState().importOverrides('{"a":"ctrl+a"}');
    expect(ok.imported).toBe(1);
    const bad = useKeybindingStore.getState().importOverrides('{ not json');
    expect(bad.imported).toBe(0);
    expect(bad.rejected[0].reason).toContain('JSON');
  });

  it('importOverrides 报告导入内容内部的 combo 冲突', () => {
    const result = useKeybindingStore.getState().importOverrides({
      version: KEYBINDING_VERSION,
      overrides: { a: 'ctrl+m', b: 'Ctrl+M' },
    });
    expect(result.conflicts).toHaveLength(1);
    expect(result.conflicts[0].ids.sort()).toEqual(['a', 'b']);
  });

  it('importOverrides 不覆盖已有绑定的其它键（合并语义）', () => {
    useKeybindingStore.getState().setCombo('keep', 'ctrl+k');
    useKeybindingStore.getState().importOverrides({ version: KEYBINDING_VERSION, overrides: { added: 'ctrl+j' } });
    const overrides = useKeybindingStore.getState().overrides;
    expect(overrides.keep).toBe('ctrl+k');
    expect(overrides.added).toBe('ctrl+j');
  });

  it('exportOverrides 带版本号可被 importOverrides 往返', () => {
    useKeybindingStore.getState().setCombo('round', 'alt+1');
    const exported = useKeybindingStore.getState().exportOverrides();
    expect(exported.version).toBe(KEYBINDING_VERSION);
    useKeybindingStore.getState().resetAll();
    const result = useKeybindingStore.getState().importOverrides(exported);
    expect(result.imported).toBe(1);
    expect(useKeybindingStore.getState().overrides.round).toBe('alt+1');
  });

  it('importOverrides 接受非对象输入时拒绝而不是抛错', () => {
    for (const bad of [null, undefined, 42, true]) {
      const result = useKeybindingStore.getState().importOverrides(bad);
      expect(result.imported).toBe(0);
      expect(result.rejected.length).toBeGreaterThan(0);
    }
  });
});

describe('KeybindingEngine effectiveCombo (C4)', () => {
  beforeEach(() => {
    localStorage.clear();
    useKeybindingStore.setState({ overrides: {} });
  });

  it('未覆盖时返回注册默认 combo', () => {
    const unsub = keybindingEngine.register({
      id: 'test-bind', combo: 'shift+m', label: '跳转', category: '测试',
      handler: vi.fn(),
    });
    expect(keybindingEngine.effectiveCombo(keybindingEngine.list().find((b) => b.id === 'test-bind')!)).toBe('shift+m');
    unsub();
  });

  it('覆盖后 effectiveCombo 返回新 combo', () => {
    const unsub = keybindingEngine.register({
      id: 'test-bind2', combo: 'shift+m', label: '跳转', category: '测试',
      handler: vi.fn(),
    });
    useKeybindingStore.getState().setCombo('test-bind2', 'ctrl+j');
    const b = keybindingEngine.list().find((x) => x.id === 'test-bind2')!;
    expect(keybindingEngine.effectiveCombo(b)).toBe('ctrl+j');
    unsub();
  });
});
