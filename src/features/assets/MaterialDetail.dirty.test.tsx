// @vitest-environment jsdom
/**
 * M-01（PRD §5B）：素材详情弹窗对 tags/metadata/detail 脏数据不得白屏。
 * 直接渲染 MaterialDetail，传入非数组 tags / 非对象 metadata / null detail，
 * 断言：不抛异常、渲染出内容、detail 为 null 显示空（不出现 "null" 字面）。
 */
import { describe, it, expect } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { MaterialDetail } from './AssetPanel';
import type { MaterialAsset } from '@/services/api/asset';

afterEach(cleanup);

function dirty(overrides: Partial<Record<string, unknown>>): MaterialAsset {
  return {
    id: 'x', title: '脏数据素材', type: 'image', source: 'src',
    tags: [], metadata: {}, detail: '',
    ...overrides,
  } as unknown as MaterialAsset;
}

describe('M-01: MaterialDetail 脏数据不白屏', () => {
  it('tags 非数组 / metadata 非对象 / detail=null → 正常渲染，不抛', () => {
    expect(() => render(<MaterialDetail data={dirty({
      tags: { bad: true },
      metadata: 'not-an-object',
      detail: null,
      file_size_bytes: 1024,
    })} />)).not.toThrow();
    expect(screen.getByText('脏数据素材')).toBeTruthy();
    // detail=null 不应渲染出 "null" 字面文本
    expect(document.body.textContent).not.toContain('null');
  });

  it('tags 是数组时渲染成标签，metadata 对象渲染成 JSON 文本', () => {
    render(<MaterialDetail data={dirty({
      tags: ['夜景', { name: '城市' }],
      metadata: { foo: 'bar' },
      detail: '这是描述',
    })} />);
    expect(screen.getByText('夜景')).toBeTruthy();
    expect(screen.getByText('城市')).toBeTruthy();
    expect(screen.getByText('这是描述')).toBeTruthy();
    expect(document.body.textContent).toContain('"foo"');
  });

  it('整个 data 字段都是脏对象也不白屏', () => {
    expect(() => render(<MaterialDetail data={dirty({
      type: { t: 'video' }, source: { s: 'x' }, resolution: ['a'],
      url: { u: 1 }, local_path: { p: 1 }, created_at: { c: 1 },
      title: { n: '名字' },
    })} />)).not.toThrow();
    expect(document.body.textContent).toContain('名字');
  });
});
