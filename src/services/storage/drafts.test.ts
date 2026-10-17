import { describe, it, expect, beforeEach } from 'vitest';
import {
  DraftRepository,
  MAX_MEDIA_SNAPSHOTS,
  createMemoryBackend,
  draftAge,
  isDraftNewer,
  isQuotaError,
  type DraftBackend,
} from './drafts';

function repo(maxMediaSnapshots?: number) {
  return new DraftRepository(createMemoryBackend(), { maxMediaSnapshots });
}

/** 一个总是抛配额错误的写入后端 */
function quotaBackend(failTimes = Number.POSITIVE_INFINITY): DraftBackend {
  const inner = createMemoryBackend();
  let failures = 0;
  return {
    get: inner.get,
    keys: inner.keys,
    clear: inner.clear,
    delete: inner.delete,
    put: async (store, key, value) => {
      if (store === 'drafts' && failures < failTimes) {
        failures += 1;
        const err = new Error('The quota has been exceeded.');
        err.name = 'QuotaExceededError';
        throw err;
      }
      return inner.put(store, key, value);
    },
  };
}

const TL = { id: 'tl', width: 1920, height: 1080, fps: 30, duration_sec: 5, tracks: [] };

describe('DraftRepository 草稿', () => {
  let r: DraftRepository;
  beforeEach(() => { r = repo(); });

  it('写入后可读回，且字段完整', async () => {
    const before = Date.now();
    const res = await r.putDraft({ projectId: 'p1', name: '项目一', timeline: TL, dirty: true });
    expect(res.ok).toBe(true);
    const draft = await r.getDraft('p1');
    expect(draft).not.toBeNull();
    expect(draft!.projectId).toBe('p1');
    expect(draft!.name).toBe('项目一');
    expect(draft!.dirty).toBe(true);
    expect(draft!.savedAt).toBeGreaterThanOrEqual(before);
    expect(draft!.timeline).toEqual(TL);
  });

  it('同项目重复写入只保留最后一份', async () => {
    await r.putDraft({ projectId: 'p1', timeline: TL, dirty: true });
    await r.putDraft({ projectId: 'p1', timeline: { ...TL, duration_sec: 9 }, dirty: true });
    const list = await r.listDrafts();
    expect(list).toHaveLength(1);
    expect((list[0].timeline as { duration_sec: number }).duration_sec).toBe(9);
  });

  it('listDrafts 按写入时间倒序', async () => {
    await r.putDraft({ projectId: 'old', timeline: TL, dirty: true, savedAt: 1000 });
    await r.putDraft({ projectId: 'new', timeline: TL, dirty: true, savedAt: 2000 });
    expect((await r.listDrafts()).map((d) => d.projectId)).toEqual(['new', 'old']);
  });

  it('删除与清空', async () => {
    await r.putDraft({ projectId: 'p1', timeline: TL, dirty: true });
    await r.putDraft({ projectId: 'p2', timeline: TL, dirty: true });
    await r.deleteDraft('p1');
    expect(await r.getDraft('p1')).toBeNull();
    await r.clearDrafts();
    expect(await r.listDrafts()).toHaveLength(0);
  });

  it('后端读取到脏数据时视为无效（不让坏记录打断界面）', async () => {
    const backend = createMemoryBackend();
    await backend.put('drafts', 'bad', { projectId: 'bad' }); // 缺 savedAt / timeline
    const repo2 = new DraftRepository(backend);
    expect(await repo2.getDraft('bad')).toBeNull();
    expect(await repo2.listDrafts()).toHaveLength(0);
  });

  it('后端抛错时静默降级（草稿不是新的失败点）', async () => {
    const broken: DraftBackend = {
      get: async () => { throw new Error('boom'); },
      put: async () => { throw new Error('boom'); },
      delete: async () => { throw new Error('boom'); },
      keys: async () => { throw new Error('boom'); },
      clear: async () => { throw new Error('boom'); },
    };
    const repo2 = new DraftRepository(broken);
    expect(await repo2.getDraft('p1')).toBeNull();
    expect(await repo2.listDrafts()).toEqual([]);
    await expect(repo2.deleteDraft('p1')).resolves.toBeUndefined();
  });
});

describe('DraftRepository 媒体快照', () => {
  it('写入/读回，并按 bucket 保留最新若干张缩略图', async () => {
    const r = repo();
    const thumbnails: Record<string, string> = {};
    for (let i = 0; i < 40; i += 1) thumbnails[String(i)] = `data:image/png;base64,${i}`;
    await r.putMediaSnapshot({ assetId: 'a1', durationSec: 12.5, thumbnails, waveform: [0, 1, 2] });
    const snap = await r.getMediaSnapshot('a1');
    expect(snap!.durationSec).toBe(12.5);
    expect(snap!.waveform).toEqual([0, 1, 2]);
    const keys = Object.keys(snap!.thumbnails!).map(Number).sort((a, b) => a - b);
    expect(keys).toHaveLength(24);
    expect(keys[0]).toBe(16); // 保留最大的 24 个 bucket（最新的画面）
  });

  it('超过条数上限时淘汰最旧（保留最近使用的）', async () => {
    const r = repo(3);
    for (let i = 0; i < 5; i += 1) {
      await r.putMediaSnapshot({ assetId: `a${i}`, durationSec: i + 1, updatedAt: 1000 + i });
    }
    const list = await r.listMediaSnapshots();
    expect(list.map((s) => s.assetId)).toEqual(['a4', 'a3', 'a2']);
    expect(await r.getMediaSnapshot('a0')).toBeNull();
  });

  it('默认上限常量合理', () => {
    expect(MAX_MEDIA_SNAPSHOTS).toBeGreaterThan(50);
  });

  it('配额不足时先淘汰一半媒体快照再重试成功', async () => {
    const backend = quotaBackend(1);
    const r = new DraftRepository(backend);
    for (let i = 0; i < 4; i += 1) {
      await backend.put('media_snapshots', `a${i}`, { assetId: `a${i}`, durationSec: 1, updatedAt: 1000 + i });
    }
    const res = await r.putDraft({ projectId: 'p1', timeline: TL, dirty: true });
    expect(res.ok).toBe(true);
    // 淘汰了一半（4 → 2）
    expect(await r.listMediaSnapshots()).toHaveLength(2);
  });

  it('配额持续不足时返回 quota（不静默吞掉）', async () => {
    const r = new DraftRepository(quotaBackend());
    const res = await r.putDraft({ projectId: 'p1', timeline: TL, dirty: true });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('quota');
  });
});

describe('isQuotaError', () => {
  it('按 name 与消息双判', () => {
    const byName = new Error('x');
    byName.name = 'QuotaExceededError';
    expect(isQuotaError(byName)).toBe(true);
    expect(isQuotaError(new Error('The quota has been exceeded.'))).toBe(true);
    expect(isQuotaError(new Error('network down'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError('quota')).toBe(false);
  });
});

describe('isDraftNewer（要不要提示恢复）', () => {
  const draft = (savedAt: number, dirty = true) => ({
    projectId: 'p1', timeline: TL, savedAt, dirty,
  });

  it('草稿比服务端新 → 提示', () => {
    expect(isDraftNewer(draft(3000), '1970-01-01T00:00:01.000Z')).toBe(true);
  });

  it('服务端更新 → 不提示', () => {
    expect(isDraftNewer(draft(1000), '2030-01-01T00:00:00.000Z')).toBe(false);
  });

  it('1 秒容差：差 500ms 不提示，差 1.5 秒提示', () => {
    expect(isDraftNewer(draft(1500), 1000)).toBe(false);
    expect(isDraftNewer(draft(2500), 1000)).toBe(true);
  });

  it('没有服务端时间时保守提示（宁可多问一次也不丢改动）', () => {
    expect(isDraftNewer(draft(1000), undefined)).toBe(true);
    expect(isDraftNewer(draft(1000), null)).toBe(true);
    expect(isDraftNewer(draft(1000), 'not-a-date')).toBe(true);
  });

  it('不脏的草稿与空草稿都不提示', () => {
    expect(isDraftNewer(draft(2000, false), 1000)).toBe(false);
    expect(isDraftNewer(null, 1000)).toBe(false);
  });
});

describe('draftAge', () => {
  const now = 1_700_000_000_000;
  it('分档文案', () => {
    expect(draftAge(now - 2000, now)).toBe('刚刚');
    expect(draftAge(now - 30_000, now)).toBe('30 秒前');
    expect(draftAge(now - 5 * 60_000, now)).toBe('5 分钟前');
    expect(draftAge(now - 3 * 3_600_000, now)).toBe('3 小时前');
    expect(draftAge(now - 2 * 86_400_000, now)).toBe('2 天前');
  });
});
