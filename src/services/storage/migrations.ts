/**
 * 本地偏好迁移链（O5）。
 *
 * 背景：localStorage 里的偏好是**长期存活**的数据——用户上一次装的版本写的形状，
 * 这次升级后仍会被读到。没有迁移机制时，老数据要么让 store 读到缺字段的对象，
 * 要么让新设置项静默失效（历史欠账：`P0-11` 的明文 token、`P2-02` 的三个死设置
 * 都是这类问题的产物，当时各自在 store 里写了临时修补）。
 *
 * 这里把它做成一条**有序迁移链**：
 * - 版本号存在 `clipwright.prefsVersion`；
 * - 每步只做一件事，可重复执行（幂等），从当前版本逐级升到 `PREF_VERSION`；
 * - 升级前把旧数据备份到 `clipwright.<key>.backup.vN`（出问题可人工捞回）；
 * - 任一步抛错 → 保留备份、停止后续步骤、返回报告，**绝不删用户数据**；
 * - 所有步骤在 `loadPref` 之前跑（由 `localPrefs.ts` 在模块加载时调用）。
 */

export const PREF_VERSION_KEY = 'clipwright.prefsVersion';

/** 当前偏好结构版本。加/改偏好形状时 +1 并补一步迁移。 */
export const PREF_VERSION = 2;

export interface MigrationReport {
  from: number;
  to: number;
  applied: string[];
  backedUp: string[];
  error?: string;
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface MigrationStep {
  /** 目标版本（执行完这步后版本号变成它） */
  to: number;
  name: string;
  /**
   * 本步**可能改动**的 key。
   *
   * 必须在 `run` 之前声明：备份要保存改动前的原始内容，
   * 等 run 跑完再备份就只剩迁移后的值了（早期实现踩过这个坑）。
   */
  keys: string[];
  run(storage: StorageLike): string[]; // 返回实际改动的 key 列表
}

/** 读取 JSON（失败返回 null，不抛） */
function readJson(storage: StorageLike, key: string): Record<string, unknown> | null {
  try {
    const raw = storage.getItem(key);
    if (raw == null) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function writeJson(storage: StorageLike, key: string, value: Record<string, unknown>): void {
  storage.setItem(key, JSON.stringify(value));
}

/** 有序迁移步骤。新增时把 `to` 递增并保证幂等。 */
const MIGRATIONS: MigrationStep[] = [
  {
    to: 1,
    name: 'strip-legacy-auth-fields',
    keys: ['clipwright.connectionPrefs', 'clipwright.settings'],
    run(storage) {
      // 早期版本把 access token / WebSocket 地址写进 connectionPrefs（明文落盘，安全审计 P0）。
      // 后来在 store 里做了临时清除，这里固化成正式迁移：一次性删干净并留痕。
      const changed: string[] = [];
      const conn = readJson(storage, 'clipwright.connectionPrefs');
      if (conn) {
        let dirty = false;
        if ('authToken' in conn) {
          delete conn.authToken;
          dirty = true;
        }
        if ('wsUrl' in conn) {
          delete conn.wsUrl;
          dirty = true;
        }
        if ('websocketUrl' in conn) {
          delete conn.websocketUrl;
          dirty = true;
        }
        if (dirty) {
          writeJson(storage, 'clipwright.connectionPrefs', conn);
          changed.push('clipwright.connectionPrefs');
        }
      }
      // 旧键（整块 settings）在更早的版本里被拆成 editorPrefs/connectionPrefs，
      // 残留则丢弃其连接类字段，避免被后续读取路径重新捡起来。
      const legacy = readJson(storage, 'clipwright.settings');
      if (legacy && ('authToken' in legacy || 'wsUrl' in legacy)) {
        delete legacy.authToken;
        delete legacy.wsUrl;
        writeJson(storage, 'clipwright.settings', legacy);
        changed.push('clipwright.settings');
      }
      return changed;
    },
  },
  {
    to: 2,
    name: 'normalize-editor-prefs',
    keys: ['clipwright.editorPrefs'],
    run(storage) {
      // P2-02 引入的三个设置项（默认帧率/分辨率/自动保存）在旧数据里缺失或类型不对，
      // 会让 store 拿到 undefined → 新建时间线回落到硬编码值。这里统一补默认并钳制范围。
      const prefs = readJson(storage, 'clipwright.editorPrefs');
      if (!prefs) return [];
      let dirty = false;

      const clampNum = (value: unknown, fallback: number, lo: number, hi: number): number => {
        const num = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
        return Math.min(Math.max(num, lo), hi);
      };
      if (prefs.defaultFps === undefined || typeof prefs.defaultFps !== 'number') {
        prefs.defaultFps = 30;
        dirty = true;
      }
      prefs.defaultFps = clampNum(prefs.defaultFps, 30, 1, 240);
      const res = prefs.defaultResolution as { width?: unknown; height?: unknown } | undefined;
      if (!res || typeof res !== 'object') {
        prefs.defaultResolution = { width: 1920, height: 1080 };
        dirty = true;
      } else {
        const width = clampNum(res.width, 1920, 16, 7680);
        const height = clampNum(res.height, 1080, 16, 4320);
        if (width !== res.width || height !== res.height) {
          prefs.defaultResolution = { width, height };
          dirty = true;
        }
      }
      if (typeof prefs.autoSave !== 'boolean') {
        prefs.autoSave = true;
        dirty = true;
      }
      if (typeof prefs.showPerfPanel !== 'boolean') {
        prefs.showPerfPanel = false;
        dirty = true;
      }

      if (dirty) {
        writeJson(storage, 'clipwright.editorPrefs', prefs);
        return ['clipwright.editorPrefs'];
      }
      return [];
    },
  },
];

/** 当前已记录的偏好版本（缺省 0 = 迁移机制之前的版本） */
export function readPrefVersion(storage: StorageLike | null = safeStorage()): number {
  if (!storage) return PREF_VERSION;
  try {
    const raw = storage.getItem(PREF_VERSION_KEY);
    const num = raw == null ? 0 : Number(raw);
    return Number.isFinite(num) && num >= 0 ? num : 0;
  } catch {
    return 0;
  }
}

function safeStorage(): StorageLike | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

/**
 * 执行迁移链。幂等：版本已是最新时什么都不做。
 *
 * 失败语义：把失败前的进度**保留**（已升级步骤的版本号已写入），记录 `error`，
 * 下一次启动会从失败那步继续重试——不会因为一次异常把用户偏好打回默认值。
 */
export function migrateLocalPrefs(storage: StorageLike | null = safeStorage()): MigrationReport {
  if (!storage) return { from: PREF_VERSION, to: PREF_VERSION, applied: [], backedUp: [] };

  let current = readPrefVersion(storage);
  const report: MigrationReport = { from: current, to: current, applied: [], backedUp: [] };
  if (current >= PREF_VERSION) return report;

  for (const step of MIGRATIONS) {
    if (step.to <= current) continue;
    // 先备份本步会碰的 key（保存改动前的原始内容），再执行
    for (const key of step.keys) {
      const backupKey = `${key}.backup.v${step.to - 1}`;
      try {
        if (storage.getItem(backupKey) == null) {
          const previous = storage.getItem(key);
          if (previous != null) {
            storage.setItem(backupKey, previous);
            report.backedUp.push(backupKey);
          }
        }
      } catch { /* 备份失败不阻断迁移 */ }
    }
    try {
      step.run(storage);
      // 先落版本号，成功后才承认这一步完成——版本号写不进去时宁可下次重跑
      // （各步都写成幂等的，重跑安全），也不要出现「版本说做完了、数据没改」。
      storage.setItem(PREF_VERSION_KEY, String(step.to));
      current = step.to;
      report.applied.push(step.name);
      report.to = current;
    } catch (err) {
      report.error = `${step.name}: ${err instanceof Error ? err.message : String(err)}`;
      report.to = current;
      break;
    }
  }
  return report;
}
