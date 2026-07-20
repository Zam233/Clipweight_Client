/**
 * projectCache — IndexedDB-backed local persistence for projects.
 * Provides auto-save (debounced timeline snapshots) and offline project CRUD,
 * independent of the backend (which syncs via /api/project/*).
 */
import type { Timeline } from '@/types/timeline';

export interface CachedProject {
  id: string;
  name: string;
  timeline: Timeline;
  personaId?: string | null;
  pluginId?: string | null;
  createdAt: number;
  updatedAt: number;
}

const DB_NAME = 'clipwright';
const DB_VERSION = 1;
const STORE = 'projects';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'id' });
          store.createIndex('updatedAt', 'updatedAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = fn(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const projectCache = {
  /** Save (upsert) a project snapshot. */
  async save(project: CachedProject): Promise<void> {
    await tx('readwrite', (s) => s.put(project));
  },

  /** Load a single project by id. */
  async load(id: string): Promise<CachedProject | undefined> {
    return tx('readonly', (s) => s.get(id) as IDBRequest<CachedProject | undefined>);
  },

  /** List all projects, most recently updated first. */
  async list(): Promise<CachedProject[]> {
    const all = await tx('readonly', (s) => s.getAll() as IDBRequest<CachedProject[]>);
    return all.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  /** Delete a project by id. */
  async remove(id: string): Promise<void> {
    await tx('readwrite', (s) => s.delete(id));
  },

  /** Clear all cached projects. */
  async clear(): Promise<void> {
    await tx('readwrite', (s) => s.clear());
  },
};

/**
 * Debounced auto-saver. Call `schedule(project)` on timeline change; it writes
 * to IndexedDB at most once per interval.
 */
export function createAutoSaver(intervalMs = 1500) {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let pending: CachedProject | null = null;

  const flush = async () => {
    if (!pending) return;
    const proj = pending;
    pending = null;
    try {
      await projectCache.save(proj);
    } catch (e) {
      console.warn('[autosave] failed:', e);
    }
  };

  return {
    schedule(project: CachedProject) {
      pending = { ...project, updatedAt: Date.now() };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, intervalMs);
    },
    flush,
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
      pending = null;
    },
  };
}
