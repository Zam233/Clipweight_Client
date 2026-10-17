/**
 * 本地草稿（O5）——IndexedDB 里的「未保存改动 + 媒体快照」。
 *
 * 解决两件日常痛点：
 * 1. **刷新/崩溃丢改动**：服务端自动保存是 5 秒防抖 + 网络往返，期间刷新即丢。
 *    这里每次编辑都写一份本地草稿（快照引用，序列化到 IndexedDB，无需网络），
 *    下次打开同一项目时若草稿比服务端新，提示恢复。
 * 2. **刷新后缩略图/波形空白**：媒体**文件**句柄无法持久化（blob URL 刷新即失效），
 *    但**派生数据**可以——缩略图（data URL）、波形数组、时长。刷新后先用手上的快照
 *    立即画出缩略图/波形，再去后端取真实媒体。
 *
 * 设计约束：
 * - **后端可注入**（`DraftBackend`）：默认 IndexedDB 适配器；单测用内存后端，
 *   因此不需要引入 fake-indexeddb，逻辑（配额、淘汰、陈旧判定）可以确定性验证。
 * - **绝不抛异常**：IndexedDB 在隐私模式/受限环境可能不可用，所有 API 失败即降级
 *   （返回 null / `{ok:false}`），草稿是增强而不是新的失败点。
 * - **配额**：写入超配额时先淘汰最旧的媒体快照再重试一次，仍失败则报 `quota`，
 *   由调用方决定是否提示用户（不静默吞掉，用户需要知道本地缓存没写进去）。
 */

/** 一个媒体条目的可持久化派生数据 */
export interface MediaSnapshot {
  assetId: string;
  durationSec: number;
  /** 缩略图（bucket → dataURL），与 mediaManager 的 thumbnails 结构一致 */
  thumbnails?: Record<string, string>;
  waveform?: number[];
  updatedAt: number;
}

/** 项目草稿 */
export interface DraftRecord {
  projectId: string;
  name?: string;
  /** 时间线快照（与后端 Timeline 同构） */
  timeline: unknown;
  /** 写入时刻（毫秒） */
  savedAt: number;
  /** 该草稿是否含「服务端还没有」的改动 */
  dirty: boolean;
}

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: 'quota' | 'unavailable' | 'error'; detail?: string };

/**
 * 存储后端抽象：本地实现是 IndexedDB，单测是内存 Map。
 *
 * 只暴露草稿/媒体快照需要的最小能力——不需要游标、事务或索引，
 * 因为访问模式就是「按 id 取放 + 全量列举 + 按时间淘汰」。
 */
export interface DraftBackend {
  get(store: string, key: string): Promise<unknown>;
  put(store: string, key: string, value: unknown): Promise<void>;
  delete(store: string, key: string): Promise<void>;
  keys(store: string): Promise<string[]>;
  clear(store: string): Promise<void>;
}

export const DRAFT_STORE = 'drafts';
export const MEDIA_STORE = 'media_snapshots';

/** 媒体快照上限（条数）：超过先淘汰最旧的，避免长项目把配额吃光 */
export const MAX_MEDIA_SNAPSHOTS = 200;
/** 单条媒体快照的缩略图上限（与 mediaManager 的 MAX_THUMBNAILS_PER_ENTRY 对齐） */
export const MAX_THUMBS_PER_SNAPSHOT = 24;

/** 内存后端（单测 / 无 IndexedDB 环境） */
export function createMemoryBackend(): DraftBackend {
  const stores = new Map<string, Map<string, unknown>>();
  const bucket = (store: string) => {
    let map = stores.get(store);
    if (!map) {
      map = new Map();
      stores.set(store, map);
    }
    return map;
  };
  return {
    get: async (store, key) => bucket(store).get(key) ?? null,
    put: async (store, key, value) => { bucket(store).set(key, value); },
    delete: async (store, key) => { bucket(store).delete(key); },
    keys: async (store) => [...bucket(store).keys()],
    clear: async (store) => { bucket(store).clear(); },
  };
}

/** IndexedDB 适配器（默认）；不可用时抛错，由调用方统一降级 */
export function createIndexedDbBackend(dbName = 'clipwright-drafts', version = 1): DraftBackend {
  let dbPromise: Promise<IDBDatabase> | null = null;

  const open = (): Promise<IDBDatabase> => {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('IndexedDB 不可用'));
        return;
      }
      const request = indexedDB.open(dbName, version);
      request.onupgradeneeded = () => {
        const db = request.result;
        for (const store of [DRAFT_STORE, MEDIA_STORE]) {
          if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 打开失败'));
    });
    return dbPromise;
  };

  const withStore = async <T>(
    storeName: string,
    mode: IDBTransactionMode,
    fn: (store: IDBObjectStore) => IDBRequest,
  ): Promise<T> => {
    const db = await open();
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const request = fn(tx.objectStore(storeName));
      request.onsuccess = () => resolve(request.result as T);
      request.onerror = () => reject(request.error ?? new Error('IndexedDB 请求失败'));
    });
  };

  return {
    get: (store, key) => withStore(store, 'readonly', (s) => s.get(key)),
    put: (store, key, value) => withStore(store, 'readwrite', (s) => s.put(value, key)),
    delete: (store, key) => withStore(store, 'readwrite', (s) => s.delete(key)),
    keys: async (store) => (await withStore<IDBValidKey[]>(store, 'readonly', (s) => s.getAllKeys()))
      .map((k) => String(k)),
    clear: (store) => withStore(store, 'readwrite', (s) => s.clear()),
  };
};

/** 是否是配额类错误（不同浏览器文案不一，按名字与消息双判） */
export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name ?? '';
  const message = String((err as { message?: string }).message ?? '');
  return name === 'QuotaExceededError' || name === 'NS_ERROR_DOM_QUOTA_REACHED'
    || /quota|exceeded the quota|storage is full/i.test(message);
}

/** 草稿/快照仓库（后端可注入） */
export class DraftRepository {
  private backend: DraftBackend;
  private maxMediaSnapshots: number;

  constructor(backend: DraftBackend, options: { maxMediaSnapshots?: number } = {}) {
    this.backend = backend;
    this.maxMediaSnapshots = Math.max(1, options.maxMediaSnapshots ?? MAX_MEDIA_SNAPSHOTS);
  }

  /** 写入项目草稿（覆盖同项目上一份） */
  async putDraft(draft: Omit<DraftRecord, 'savedAt'> & { savedAt?: number }): Promise<WriteResult> {
    const record: DraftRecord = {
      ...draft,
      savedAt: draft.savedAt ?? Date.now(),
    };
    return this.write(() => this.backend.put(DRAFT_STORE, record.projectId, record));
  }

  /** 读取项目草稿 */
  async getDraft(projectId: string): Promise<DraftRecord | null> {
    try {
      const raw = await this.backend.get(DRAFT_STORE, projectId);
      return isDraftRecord(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  /** 列出全部草稿（按写入时间倒序） */
  async listDrafts(): Promise<DraftRecord[]> {
    try {
      const ids = await this.backend.keys(DRAFT_STORE);
      const records = await Promise.all(ids.map((id) => this.backend.get(DRAFT_STORE, id)));
      return records.filter(isDraftRecord).sort((a, b) => b.savedAt - a.savedAt);
    } catch {
      return [];
    }
  }

  /** 删除项目草稿（服务端已保存时调用） */
  async deleteDraft(projectId: string): Promise<void> {
    try {
      await this.backend.delete(DRAFT_STORE, projectId);
    } catch { /* 草稿删除失败不影响主流程 */ }
  }

  /** 清空全部草稿 */
  async clearDrafts(): Promise<void> {
    try {
      await this.backend.clear(DRAFT_STORE);
    } catch { /* ignore */ }
  }

  /** 写入媒体快照（缩略图/波形/时长），超出条数上限时先淘汰最旧的 */
  async putMediaSnapshot(snapshot: Omit<MediaSnapshot, 'updatedAt'> & { updatedAt?: number }): Promise<WriteResult> {
    const record: MediaSnapshot = {
      assetId: snapshot.assetId,
      durationSec: snapshot.durationSec,
      thumbnails: trimThumbnails(snapshot.thumbnails),
      waveform: snapshot.waveform,
      updatedAt: snapshot.updatedAt ?? Date.now(),
    };
    const result = await this.write(() => this.backend.put(MEDIA_STORE, record.assetId, record));
    if (result.ok) await this.pruneMediaSnapshots();
    return result;
  }

  /** 读取媒体快照 */
  async getMediaSnapshot(assetId: string): Promise<MediaSnapshot | null> {
    try {
      const raw = await this.backend.get(MEDIA_STORE, assetId);
      return isMediaSnapshot(raw) ? raw : null;
    } catch {
      return null;
    }
  }

  /** 列出全部媒体快照（按更新时间倒序） */
  async listMediaSnapshots(): Promise<MediaSnapshot[]> {
    try {
      const ids = await this.backend.keys(MEDIA_STORE);
      const records = await Promise.all(ids.map((id) => this.backend.get(MEDIA_STORE, id)));
      return records.filter(isMediaSnapshot).sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      return [];
    }
  }

  /** 淘汰到上限以内（保留最近使用的），返回淘汰条数 */
  async pruneMediaSnapshots(): Promise<number> {
    const snapshots = await this.listMediaSnapshots();
    if (snapshots.length <= this.maxMediaSnapshots) return 0;
    const doomed = snapshots.slice(this.maxMediaSnapshots);
    for (const snapshot of doomed) {
      try {
        await this.backend.delete(MEDIA_STORE, snapshot.assetId);
      } catch { /* 单条失败继续 */ }
    }
    return doomed.length;
  }

  /** 清空媒体快照 */
  async clearMediaSnapshots(): Promise<void> {
    try {
      await this.backend.clear(MEDIA_STORE);
    } catch { /* ignore */ }
  }

  /**
   * 统一写入：配额不足时先淘汰一半媒体快照再重试一次。
   * 草稿本身（timeline）是必须写进去的，不能因为缩略图把配额吃光而丢。
   */
  private async write(fn: () => Promise<void>): Promise<WriteResult> {
    try {
      await fn();
      return { ok: true };
    } catch (err) {
      if (!isQuotaError(err)) {
        return { ok: false, reason: err instanceof Error ? 'error' : 'unavailable', detail: String(err) };
      }
      const snapshots = await this.listMediaSnapshots();
      const half = Math.ceil(snapshots.length / 2);
      for (const snapshot of snapshots.slice(0, half)) {
        try {
          await this.backend.delete(MEDIA_STORE, snapshot.assetId);
        } catch { /* ignore */ }
      }
      try {
        await fn();
        return { ok: true };
      } catch (retryErr) {
        return { ok: false, reason: 'quota', detail: String(retryErr) };
      }
    }
  }
}

function trimThumbnails(thumbnails?: Record<string, string>): Record<string, string> | undefined {
  if (!thumbnails) return undefined;
  const entries = Object.entries(thumbnails);
  if (entries.length <= MAX_THUMBS_PER_SNAPSHOT) return thumbnails;
  // 保留 bucket 最大（最新）的若干张
  return Object.fromEntries(
    entries.sort((a, b) => Number(b[0]) - Number(a[0])).slice(0, MAX_THUMBS_PER_SNAPSHOT),
  );
}

function isDraftRecord(value: unknown): value is DraftRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<DraftRecord>;
  return typeof record.projectId === 'string'
    && typeof record.savedAt === 'number'
    && record.timeline !== undefined;
}

function isMediaSnapshot(value: unknown): value is MediaSnapshot {
  if (!value || typeof value !== 'object') return false;
  const record = value as Partial<MediaSnapshot>;
  return typeof record.assetId === 'string' && typeof record.durationSec === 'number';
}

/**
 * 草稿是否比服务端更新（决定要不要提示恢复）。
 *
 * `serverUpdatedAt` 缺失（离线打开/后端没给时间）时保守地认为草稿有效——
 * 宁可多问一次，也不要静默丢掉用户改过的东西。
 */
export function isDraftNewer(draft: DraftRecord | null, serverUpdatedAt?: string | number | null): boolean {
  if (!draft) return false;
  if (!draft.dirty) return false;
  if (serverUpdatedAt === undefined || serverUpdatedAt === null) return true;
  const serverMs = typeof serverUpdatedAt === 'number'
    ? serverUpdatedAt
    : Date.parse(serverUpdatedAt);
  if (!Number.isFinite(serverMs)) return true;
  // 1 秒容差：同一秒内保存的时间戳格式差异不应触发恢复提示
  return draft.savedAt > serverMs + 1000;
}

/** 存储用量估算（配额提示用）；不支持时返回 null */
export async function estimateStorage(): Promise<{ usage: number; quota: number } | null> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.estimate) return null;
    const { usage, quota } = await navigator.storage.estimate();
    if (typeof usage !== 'number' || typeof quota !== 'number') return null;
    return { usage, quota };
  } catch {
    return null;
  }
}

/** 人类可读的草稿年龄（「3 分钟前」） */
export function draftAge(savedAt: number, now: number = Date.now()): string {
  const sec = Math.max(0, Math.floor((now - savedAt) / 1000));
  if (sec < 10) return '刚刚';
  if (sec < 60) return `${sec} 秒前`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  return `${Math.floor(hour / 24)} 天前`;
}

/** 默认仓库：IndexedDB 后端；打开失败自动退化为内存后端（不阻断编辑） */
let defaultRepository: DraftRepository | null = null;

export function getDraftRepository(): DraftRepository {
  if (!defaultRepository) {
    try {
      defaultRepository = new DraftRepository(createIndexedDbBackend());
    } catch {
      defaultRepository = new DraftRepository(createMemoryBackend());
    }
  }
  return defaultRepository;
}

/** 替换默认仓库（单测注入内存后端） */
export function setDraftRepository(repository: DraftRepository | null): void {
  defaultRepository = repository;
}
