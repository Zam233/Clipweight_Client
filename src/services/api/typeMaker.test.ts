// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { typeMakerApi } from './typeMaker';

const { client } = vi.hoisted(() => ({
  client: { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn() },
}));

vi.mock('./client', () => ({ getApiClient: () => client }));

describe('typeMakerApi 规范相关端点（F-01/F-02）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.get.mockResolvedValue({ data: {} });
    client.post.mockResolvedValue({ data: {} });
    client.put.mockResolvedValue({ data: {} });
  });

  it('validate 走 /validate 并透传定义', async () => {
    client.post.mockResolvedValue({ data: { ok: false, errors: [{ code: 'dangling_number', message: 'x' }], warnings: [] } });
    const result = await typeMakerApi.validate({ id: 'demo', prompts: { genre: { text: 'x 800ms' } } });
    expect(client.post).toHaveBeenCalledWith('/api/type-maker/validate', expect.objectContaining({ id: 'demo' }));
    expect(result.ok).toBe(false);
    expect(result.errors[0].code).toBe('dangling_number');
  });

  it('resolve 带上 user_params', async () => {
    client.post.mockResolvedValue({ data: { params: {}, conflicts: [], traits: [], deformation: null, prompts: {}, trace: {}, dropped_slots: [] } });
    await typeMakerApi.resolve({ id: 'demo', user_params: { min_shot_ms: 300 } });
    expect(client.post).toHaveBeenCalledWith(
      '/api/type-maker/resolve',
      expect.objectContaining({ user_params: { min_shot_ms: 300 } }),
    );
  });

  it('genreCheck 用 type id 拼路径', async () => {
    client.post.mockResolvedValue({ data: { ok: true, judge: 'skipped', traits: [], mismatches: [], warnings: [] } });
    const result = await typeMakerApi.genreCheck('lyric_mv', { timeline: {}, bpm: 130 });
    expect(client.post).toHaveBeenCalledWith('/api/type-maker/lyric_mv/genre-check', {
      timeline: {},
      bpm: 130,
    });
    expect(result.judge).toBe('skipped');
  });

  it('get 返回带 prompts 的定义', async () => {
    client.get.mockResolvedValue({ data: { id: 'demo', prompts: { genre: { text: 'g' } }, param_rules: [], signature_traits: [] } });
    const definition = await typeMakerApi.get('demo');
    expect(definition.prompts?.genre.text).toBe('g');
  });

  it('update 走 PUT', async () => {
    client.put.mockResolvedValue({ data: { status: 'updated', id: 'demo' } });
    await typeMakerApi.update('demo', { name: '新名字' });
    expect(client.put).toHaveBeenCalledWith('/api/type-maker/demo', { name: '新名字' });
  });
});
