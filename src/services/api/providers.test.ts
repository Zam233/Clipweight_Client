import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mocks } = vi.hoisted(() => ({
  mocks: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('./client', () => ({
  getApiClient: () => ({
    get: mocks.get, post: mocks.post, put: mocks.put, delete: mocks.delete,
  }),
}));

import {
  providersApi, providersForKind, buildSourcePayload, KIND_ROLES, ROLE_LABELS,
  type AvailableProviders,
} from './providers';

const AVAILABLE: AvailableProviders = {
  llm_provider: ['openai', 'plugin-llm'],
  tts_provider: ['qwen-tts'],
  embedding_provider: ['openai', 'local'],
  rerank_provider: ['http'],
  role_kinds: {
    main: 'llm', flash: 'llm', vision: 'llm',
    embed: 'embedding', rerank: 'rerank', tts: 'tts',
  },
  tts_aliases: { qwen_tts: 'qwen-tts' },
};

describe('providersApi', () => {
  beforeEach(() => vi.clearAllMocks());

  it('list 归一化缺字段的响应', async () => {
    mocks.get.mockResolvedValue({ data: {} });
    const out = await providersApi.list();
    expect(out).toEqual({ sources: [], roles: {} });
  });

  it('list 按类型过滤时带上 kind 参数', async () => {
    mocks.get.mockResolvedValue({ data: { sources: [{ id: 's1' }], roles: { main: { source_id: 's1', model: 'm' } } } });
    const out = await providersApi.list('llm');
    expect(mocks.get).toHaveBeenCalledWith('/api/providers', { params: { kind: 'llm' } });
    expect(out.sources).toHaveLength(1);
    expect(out.roles.main?.model).toBe('m');
  });

  it('available 提供缺省值', async () => {
    mocks.get.mockResolvedValue({ data: { llm_provider: ['openai'] } });
    const out = await providersApi.available();
    expect(out.llm_provider).toEqual(['openai']);
    expect(out.tts_provider).toEqual([]);
    expect(out.tts_aliases).toEqual({});
  });

  it('setRole 发送 role/source_id/model', async () => {
    mocks.put.mockResolvedValue({ data: { ok: true } });
    await providersApi.setRole('vision', 's2', 'gpt-4o');
    expect(mocks.put).toHaveBeenCalledWith('/api/providers/roles', {
      role: 'vision', source_id: 's2', model: 'gpt-4o',
    });
  });

  it('deleteModel 对模型 id 做 URL 编码', async () => {
    mocks.delete.mockResolvedValue({ data: { models: [] } });
    await providersApi.deleteModel('s1', 'qwen/max:latest');
    expect(mocks.delete).toHaveBeenCalledWith('/api/providers/s1/models/qwen%2Fmax%3Alatest');
  });

  it('fetchModels 缺省返回空列表并透出 note', async () => {
    mocks.post.mockResolvedValue({ data: { note: '获取失败：timeout' } });
    const out = await providersApi.fetchModels('s1');
    expect(out.models).toEqual([]);
    expect(out.note).toBe('获取失败：timeout');
  });

  it('upsertModel 走 upsert 端点', async () => {
    mocks.post.mockResolvedValue({ data: { id: 's1', models: [{ id: 'm1' }] } });
    const out = await providersApi.upsertModel('s1', { id: 'm1', name: 'M1', enabled: true });
    expect(mocks.post).toHaveBeenCalledWith('/api/providers/s1/models/upsert', {
      id: 'm1', name: 'M1', enabled: true,
    });
    expect(out.models).toEqual([{ id: 'm1' }]);
  });
});

describe('providersForKind', () => {
  it('按类型取门面列表', () => {
    expect(providersForKind(AVAILABLE, 'llm')).toEqual(['openai', 'plugin-llm']);
    expect(providersForKind(AVAILABLE, 'embedding')).toEqual(['openai', 'local']);
    expect(providersForKind(AVAILABLE, 'rerank')).toEqual(['http']);
    expect(providersForKind(AVAILABLE, 'tts')).toEqual(['qwen-tts']);
  });

  it('available 为空时返回空数组（不抛异常）', () => {
    expect(providersForKind(null, 'llm')).toEqual([]);
  });

  it('每种类型都有角色定义与中文标签', () => {
    expect(KIND_ROLES.llm).toEqual(['main', 'flash', 'vision']);
    for (const roles of Object.values(KIND_ROLES)) {
      for (const r of roles) expect(ROLE_LABELS[r]).toBeTruthy();
    }
  });
});

describe('buildSourcePayload', () => {
  it('裁剪空值、聚合请求头、数值化超时', () => {
    const payload = buildSourcePayload({
      name: '  deepseek  ', kind: 'llm', provider: 'openai',
      baseUrl: ' https://api.deepseek.com ', timeoutSec: ' 90 ',
      proxy: ' http://127.0.0.1:7890 ',
      headers: [{ key: ' X-Tenant ', value: 'cw' }, { key: '  ', value: 'drop' }],
      keys: ['sk-1', '  ', 'sk-2'],
    });
    expect(payload).toEqual({
      name: 'deepseek', kind: 'llm', provider: 'openai',
      base_url: 'https://api.deepseek.com', proxy: 'http://127.0.0.1:7890',
      headers: { 'X-Tenant': 'cw' },
      api_keys: ['sk-1', 'sk-2'],
      timeout_sec: 90,
    });
  });

  it('超时非法或为空时不发送该字段', () => {
    for (const t of ['', 'abc', '0', '-3']) {
      const payload = buildSourcePayload({
        name: 's', kind: 'llm', provider: 'openai', baseUrl: '', timeoutSec: t,
        proxy: '', headers: [], keys: [],
      });
      expect(payload.timeout_sec).toBeUndefined();
    }
  });

  it('掩码条目原样回传（后端据此保留旧密钥）', () => {
    const payload = buildSourcePayload({
      name: 's', kind: 'llm', provider: 'openai', baseUrl: '', timeoutSec: '',
      proxy: '', headers: [], keys: ['sk-a****'],
    });
    expect(payload.api_keys).toEqual(['sk-a****']);
  });
});
