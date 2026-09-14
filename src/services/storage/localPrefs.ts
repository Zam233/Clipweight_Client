/**
 * localPrefs — tiny localStorage JSON persistence for UI preferences
 * (panel layout, asset history, etc.). Distinct from projectCache (IndexedDB)
 * which stores heavier project timeline data.
 */

import { migrateLocalPrefs } from './migrations';

// O5：**在读取任何偏好之前**跑迁移链（本地偏好是长期存活数据，形状会随版本演进）。
// 放在模块加载时执行：settingsStore / keybindingStore 等都要先 import 本模块，
// 因此这里是最早且唯一的入口，不需要各 store 自己记着调用。
// 失败只返回报告（见 migrations.ts），不抛异常、不删用户数据。
migrateLocalPrefs();

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`clipwright.${key}`);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    // 只合并普通对象；字符串/数字/null 等异常数据直接回退默认值
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return fallback;
    return { ...fallback, ...parsed } as T;
  } catch {
    return fallback;
  }
}

export function savePref<T>(key: string, value: T): void {
  try {
    localStorage.setItem(`clipwright.${key}`, JSON.stringify(value));
  } catch { /* storage full / unavailable */ }
}

/** Load an array preference. */
export function loadPrefArray<T>(key: string): T[] {
  try {
    const raw = localStorage.getItem(`clipwright.${key}`);
    if (raw == null) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}
