// @vitest-environment jsdom
/**
 * M-01（PRD §5B）：getMaterialAsset 对响应零校验直接返回，脏数据会白屏。
 * 详情入口必须把响应归一化为安全的 {tags: string[], metadata: Record, detail: string}：
 * - tags 非数组按空处理；
 * - metadata 非对象按空对象；
 * - detail 为 null 显示空（不抛、不渲染 "null"）；
 * - 任何脏形状都不白屏。
 *
 * 先红后绿：这些用例在归一化实现落地前失败。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: { get: vi.fn() },
}));

vi.mock('./client', () => ({
  getApiClient: () => ({ get: mocks.get }),
}));

import { assetApi, normalizeMaterialAsset } from './asset';

beforeEach(() => { vi.clearAllMocks(); });

describe('M-01: normalizeMaterialAsset 脏数据安全归一化', () => {
  it('tags 是数组时保留为字符串数组（对象元素取 name/label/title）', () => {
    const out = normalizeMaterialAsset({
      tags: ['夜景', { name: '城市' }, 3, null, { label: '延时' }],
      metadata: { foo: 'bar' },
    });
    expect(out.tags).toContain('夜景');
    expect(out.tags).toContain('城市');
    expect(out.tags).toContain('延时');
  });

  it('tags 非数组（对象/字符串/null）→ 空数组，不抛', () => {
    expect(normalizeMaterialAsset({ tags: { a: 1 } }).tags).toEqual([]);
    expect(normalizeMaterialAsset({ tags: 'night' }).tags).toEqual([]);
    expect(normalizeMaterialAsset({ tags: null }).tags).toEqual([]);
    expect(normalizeMaterialAsset({}).tags).toEqual([]);
  });

  it('metadata 非对象（数组/字符串/null）→ 空对象，不抛', () => {
    expect(normalizeMaterialAsset({ metadata: [1, 2] }).metadata).toEqual({});
    expect(normalizeMaterialAsset({ metadata: 'oops' }).metadata).toEqual({});
    expect(normalizeMaterialAsset({ metadata: null }).metadata).toEqual({});
  });

  it('metadata 是对象时原样保留（含嵌套对象）', () => {
    const meta = { a: 1, nested: { x: [1, 2] } };
    expect(normalizeMaterialAsset({ metadata: meta }).metadata).toEqual(meta);
  });

  it('detail 为 null/undefined/对象 → 空串或 JSON 文本，绝不返回 null', () => {
    expect(normalizeMaterialAsset({ detail: null }).detail).toBe('');
    expect(normalizeMaterialAsset({}).detail).toBe('');
    expect(normalizeMaterialAsset({ detail: { msg: 'hi' } }).detail).toContain('hi');
  });

  it('整个响应是标量 / null 时不抛，返回安全缺省', () => {
    expect(() => normalizeMaterialAsset(null)).not.toThrow();
    expect(normalizeMaterialAsset(null).tags).toEqual([]);
    expect(normalizeMaterialAsset(42).metadata).toEqual({});
    expect(normalizeMaterialAsset('x').detail).toBe('');
  });

  it('其余标量字段过 asText（对象是脏数据也不炸）', () => {
    const out = normalizeMaterialAsset({
      id: { name: 'a' }, title: 123, type: 'video', source: null,
      url: ['http://x'], local_path: { p: '/tmp/a' }, resolution: 5,
    });
    expect(typeof out.id).toBe('string');
    expect(typeof out.title).toBe('string');
    expect(typeof out.url).toBe('string');
    expect(typeof out.local_path).toBe('string');
    expect(out.title).toBe('123');
  });
});

describe('M-01: assetApi.getMaterialAsset 返回归一化后的形状', () => {
  it('后端返回脏数据 → 详情数据 tags 为数组、metadata 为对象', async () => {
    mocks.get.mockResolvedValue({
      data: {
        id: 'x', title: 'X', type: 'image',
        tags: { bad: true }, metadata: 'not-an-object', detail: null,
      },
    });
    const d = await assetApi.getMaterialAsset('src', 'x');
    expect(d.tags).toEqual([]);
    expect(d.metadata).toEqual({});
    expect(d.detail).toBe('');
  });

  it('后端返回 null → 仍返回安全缺省对象而非 null', async () => {
    mocks.get.mockResolvedValue({ data: null });
    const d = await assetApi.getMaterialAsset('src', 'x');
    expect(d).toBeTruthy();
    expect(d.tags).toEqual([]);
    expect(d.metadata).toEqual({});
  });
});
