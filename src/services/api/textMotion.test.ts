import { describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const post = vi.fn();
vi.mock('./client', () => ({
  getApiClient: () => ({ get, post }),
}));

import { textMotionApi } from './textMotion';

describe('textMotionApi contract', () => {
  it('treats endpoints as contracts and returns typed arrays', async () => {
    get.mockResolvedValueOnce({ data: { style_packs: [{ id: 'a', name: 'A', style: {} }] } });
    await expect(textMotionApi.stylePacks()).resolves.toEqual([
      { id: 'a', name: 'A', style: {} },
    ]);
    get.mockResolvedValueOnce({ data: {} });
    await expect(textMotionApi.assetPacks()).resolves.toEqual([]);
  });

  it('posts validate/compile/author without inventing endpoints', async () => {
    const payload = {
      clip_id: 'c', base_hash: 'h', schema_version: 'motion_spec/1',
      capability_version: 'v1', draft_spec: {
        schema: 'motion_spec/1', spec_id: 's', duration_sec: 1,
        canvas: { width: 1, height: 1 }, requires: ['text'], layers: [],
      },
    } as never;
    post.mockResolvedValueOnce({ data: { ok: true, errors: [], warnings: [] } });
    await textMotionApi.validateSpec(payload);
    expect(post).toHaveBeenCalledWith('/api/text-animation/validate-spec', payload);

    post.mockResolvedValueOnce({ data: { task_id: 't', clip_id: 'c', status: 'authoring' } });
    await textMotionApi.startAuthor({ clip_id: 'c' });
    expect(post).toHaveBeenCalledWith('/api/text-animation/author', { clip_id: 'c' });
  });
});
