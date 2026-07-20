/**
 * localPrefs — tiny localStorage JSON persistence for UI preferences
 * (panel layout, asset history, etc.). Distinct from projectCache (IndexedDB)
 * which stores heavier project timeline data.
 */

export function loadPref<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`clipwright.${key}`);
    if (raw == null) return fallback;
    return { ...fallback, ...JSON.parse(raw) } as T;
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
