/**
 * keybindingStore — 快捷键自定义（C4）：bindingId → combo 覆盖，
 * localStorage 持久化（clipwright.keybindingOverrides）。
 *
 * O-改键健壮性（2026-09-13 补齐）：
 * - **冲突校验**：同一 combo 绑到多个动作时能查出来（覆盖与默认值一起算），
 *   保存前提示而不是静默覆盖；
 * - **版本迁移**：存储带 `version`，老格式（裸 map）自动升级并补默认值；
 * - **严格导入**：导入设置时逐条校验，非法 combo 拒绝并回报，绝不半途写入脏数据。
 */
import { create } from 'zustand';
import { loadPref, savePref } from '@/services/storage/localPrefs';

const STORAGE_KEY = 'keybindingOverrides';

/** 覆盖数据的结构版本（老格式是裸 map，没有 version 字段） */
export const KEYBINDING_VERSION = 2;

export interface KeybindingExport {
  version: number;
  overrides: Record<string, string>;
}

/** 校验 combo 格式：小写字母/数字/常用功能键，可带 ctrl/shift/alt/mod 前缀。 */
export function isValidCombo(combo: string): boolean {
  if (!combo || combo.length > 48) return false;
  const parts = combo.toLowerCase().split('+').map((p) => p.trim());
  if (parts.some((p) => p === '')) return false;
  const modifiers = new Set(['ctrl', 'mod', 'meta', 'shift', 'alt']);
  const keys = parts.filter((p) => !modifiers.has(p));
  if (keys.length !== 1) return false;
  const key = keys[0];
  // 单字符（字母/数字/标点）或白名单功能键
  if (/^[a-z0-9]$/.test(key)) return true;
  if (/^[.,/;'[\]\\`=-]$/.test(key)) return true;
  const named = [
    'space', 'enter', 'tab', 'escape', 'delete', 'backspace', 'home', 'end',
    'pageup', 'pagedown', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright',
  ];
  if (named.includes(key)) return true;
  return /^f([1-9]|1[0-9]|2[0-4])$/.test(key);
}

/**
 * 归一化 combo：小写、去空格、修饰键排序（`Shift+Ctrl+Z` → `ctrl+shift+z`）。
 *
 * 冲突判定必须用归一化后的值——否则 `Ctrl+Z` 与 `ctrl+z`、`Shift+Ctrl+Z` 与
 * `Ctrl+Shift+Z` 会被当成两个不同的绑定，冲突检查形同虚设。
 */
export function normalizeCombo(combo: string): string {
  const parts = combo.toLowerCase().split('+').map((p) => p.trim()).filter(Boolean);
  const modifiers = ['ctrl', 'mod', 'meta', 'shift', 'alt'];
  const mods = modifiers.filter((m) => parts.includes(m));
  const keys = parts.filter((p) => !modifiers.includes(p));
  return [...mods, ...keys].join('+');
}

export interface KeybindingConflict {
  combo: string;
  /** 冲突的绑定 id（≥2 个） */
  ids: string[];
}

/**
 * 找出 combo 冲突。
 *
 * `entries` 是 `{id, combo}` 全量列表（默认绑定 + 覆盖后的生效值），
 * 空 combo 不参与（未绑定）。
 */
export function findKeybindingConflicts(entries: Array<{ id: string; combo: string }>): KeybindingConflict[] {
  const byCombo = new Map<string, string[]>();
  for (const entry of entries) {
    if (!entry.combo || !isValidCombo(entry.combo)) continue;
    const key = normalizeCombo(entry.combo);
    const list = byCombo.get(key) ?? [];
    list.push(entry.id);
    byCombo.set(key, list);
  }
  return [...byCombo.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([combo, ids]) => ({ combo, ids }));
}

export interface ImportResult {
  imported: number;
  rejected: Array<{ key: string; reason: string }>;
  /** 导入后仍存在的冲突（不阻断导入，但要让用户知道） */
  conflicts: KeybindingConflict[];
}

interface KeybindingState {
  /** bindingId → 覆盖后的 combo */
  overrides: Record<string, string>;
  setCombo: (id: string, combo: string) => void;
  resetCombo: (id: string) => void;
  resetAll: () => void;
  getCombo: (id: string, fallback: string) => string;
  /** 导出（带版本号，便于以后迁移） */
  exportOverrides: () => KeybindingExport;
  /** 严格导入：逐条校验，返回导入/拒绝明细与冲突 */
  importOverrides: (payload: unknown) => ImportResult;
  /** 与给定绑定表比对，找出 combo 冲突 */
  conflictsWith: (entries: Array<{ id: string; combo: string }>) => KeybindingConflict[];
}

/**
 * 迁移存储数据到当前版本。
 *
 * v1 → v2：裸 map（老格式）包成 `{version, overrides}`；
 * 未知未来版本不认识就**不迁移**（保留原样，避免把新版数据降级写坏），由调用方回退默认值。
 */
export function migrateOverrides(raw: unknown): { version: number; overrides: Record<string, string>; migrated: boolean } {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { version: KEYBINDING_VERSION, overrides: {}, migrated: false };
  }
  const record = raw as Record<string, unknown>;
  const hasVersion = typeof record.version === 'number';
  const source = hasVersion ? (record.overrides ?? {}) : record;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return { version: KEYBINDING_VERSION, overrides: {}, migrated: false };
  }
  const overrides: Record<string, string> = {};
  for (const [k, v] of Object.entries(source as Record<string, unknown>)) {
    if (typeof v === 'string' && isValidCombo(v)) overrides[k] = v;
  }
  const version = hasVersion ? Number(record.version) : 1;
  if (version > KEYBINDING_VERSION) {
    // 未来版本：不认识就不动（安全兜底，宁可用默认键位也不写坏别人的数据）
    return { version, overrides: {}, migrated: false };
  }
  return { version: KEYBINDING_VERSION, overrides, migrated: version < KEYBINDING_VERSION };
}

function loadOverrides(): Record<string, string> {
  const raw = loadPref<unknown>(STORAGE_KEY, {});
  const { overrides, migrated } = migrateOverrides(raw);
  if (migrated) savePref(STORAGE_KEY, { version: KEYBINDING_VERSION, overrides });
  return overrides;
}

export const useKeybindingStore = create<KeybindingState>((set, get) => ({
  overrides: loadOverrides(),

  setCombo: (id, combo) => {
    if (!isValidCombo(combo)) return;
    set((state) => {
      // 存归一化后的值：冲突判定与显示才一致
      const overrides = { ...state.overrides, [id]: normalizeCombo(combo) };
      savePref(STORAGE_KEY, { version: KEYBINDING_VERSION, overrides });
      return { overrides };
    });
  },

  resetCombo: (id) => {
    set((state) => {
      const overrides = { ...state.overrides };
      delete overrides[id];
      savePref(STORAGE_KEY, { version: KEYBINDING_VERSION, overrides });
      return { overrides };
    });
  },

  resetAll: () => {
    set({ overrides: {} });
    savePref(STORAGE_KEY, { version: KEYBINDING_VERSION, overrides: {} });
  },

  getCombo: (id, fallback) => {
    const v = get().overrides[id];
    return v && isValidCombo(v) ? v : fallback;
  },

  exportOverrides: () => ({ version: KEYBINDING_VERSION, overrides: { ...get().overrides } }),

  importOverrides: (payload) => {
    const rejected: ImportResult['rejected'] = [];
    let candidate: Record<string, unknown> = {};
    if (typeof payload === 'string') {
      try {
        candidate = JSON.parse(payload) as Record<string, unknown>;
      } catch {
        return { imported: 0, rejected: [{ key: '-', reason: '不是合法 JSON' }], conflicts: [] };
      }
    } else if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      candidate = payload as Record<string, unknown>;
    } else {
      return { imported: 0, rejected: [{ key: '-', reason: '导入内容必须是对象或 JSON 字符串' }], conflicts: [] };
    }

    // 版本判定：带 version.overrides 的是新格式，裸 map 视为 v1（老导出）。
    // **这里不能用 migrateOverrides 的结果做校验**——它会先把非法项静默滤掉，
    // 那样"拒绝明细"就永远是空的（用户看不到哪条被丢了）。
    const version = typeof candidate.version === 'number' ? Number(candidate.version) : 1;
    if (version > KEYBINDING_VERSION) {
      return {
        imported: 0,
        rejected: [{ key: '-', reason: `导入文件版本过新（v${version} > v${KEYBINDING_VERSION}），请升级后再导入` }],
        conflicts: [],
      };
    }
    const sourceRaw = (candidate.overrides && typeof candidate.overrides === 'object' && !Array.isArray(candidate.overrides))
      ? candidate.overrides as Record<string, unknown>
      : candidate;

    const next: Record<string, string> = {};
    for (const [key, value] of Object.entries(sourceRaw)) {
      if (key === 'version' || key === 'overrides') continue;
      if (!key || key.length > 64) {
        rejected.push({ key, reason: 'bindingId 非法' });
        continue;
      }
      if (typeof value !== 'string' || !isValidCombo(value)) {
        rejected.push({ key, reason: `非法组合键 "${String(value)}"` });
        continue;
      }
      next[key] = normalizeCombo(value);
    }

    set((state) => {
      const overrides = { ...state.overrides, ...next };
      savePref(STORAGE_KEY, { version: KEYBINDING_VERSION, overrides });
      return { overrides };
    });

    const conflicts: KeybindingConflict[] = [];
    const byCombo = new Map<string, string[]>();
    for (const [id, combo] of Object.entries(next)) {
      const list = byCombo.get(combo) ?? [];
      list.push(id);
      byCombo.set(combo, list);
    }
    for (const [combo, ids] of byCombo) {
      if (ids.length > 1) conflicts.push({ combo, ids });
    }
    return { imported: Object.keys(next).length, rejected, conflicts };
  },

  conflictsWith: (entries) => findKeybindingConflicts(entries),
}));
