// @vitest-environment jsdom
/**
 * 挂载块（B4-T4.4）：三种输入形态的可见性，以及"契约缺失就不渲染"。
 *
 * 锚点固定为 `brief-genui` / `plan-genui`（既有测试与用户习惯都依赖它）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { DisplaySpecsBlock } from './DisplaySpecsBlock';
import { invalidateDisplaySpecContracts } from './contractSource';
import contractJson from './contract.json';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/services/api', () => ({ getApiClient: () => ({ get: mocks.get }) }));

const baseMeta = {
  ...(contractJson as Record<string, unknown>),
  source: 'brief',
  order: 100,
  trust: 'sanitize',
};

function contractsResponse() {
  return {
    contributions: [
      { kind: 'display_spec', id: 'brief', meta: { ...baseMeta, spec_id: 'brief' } },
      {
        kind: 'display_spec',
        id: 'plan',
        meta: { ...baseMeta, spec_id: 'plan', source: 'plan', order: 110, trust: 'recipe_only' },
      },
    ],
  };
}

const spec = { version: 1, items: [{ type: 'text', content: '结构化内容' }] };

afterEach(() => {
  cleanup();
  invalidateDisplaySpecContracts();
});

describe('DisplaySpecsBlock', () => {
  it('display_specs 有值且契约可用 → 渲染 braced 块', async () => {
    mocks.get.mockResolvedValue(contractsResponse());
    render(<DisplaySpecsBlock obj={{ display_specs: { brief: spec } }} surface="brief" testId="brief-genui" />);
    await waitFor(() => expect(screen.getByTestId('brief-genui')).toBeTruthy());
    expect(screen.getByText('结构化内容')).toBeTruthy();
  });

  it('只有老键 genui → 仍渲染（读路径兼容）', async () => {
    mocks.get.mockResolvedValue(contractsResponse());
    render(<DisplaySpecsBlock obj={{ genui: spec }} surface="brief" testId="brief-genui" />);
    await waitFor(() => expect(screen.getByTestId('brief-genui')).toBeTruthy());
  });

  it('两者都没有 → 整块不渲染（业务字段由卡片自己显示）', async () => {
    mocks.get.mockResolvedValue(contractsResponse());
    render(<DisplaySpecsBlock obj={{ title: 'T' }} surface="brief" testId="brief-genui" />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('brief-genui')).toBeNull();
  });

  it('契约拉不到（插件被禁用）→ 不渲染、不猜规则', async () => {
    mocks.get.mockRejectedValue(new Error('offline'));
    render(<DisplaySpecsBlock obj={{ display_specs: { brief: spec } }} surface="brief" testId="brief-genui" />);
    await new Promise((r) => setTimeout(r, 10));
    expect(screen.queryByTestId('brief-genui')).toBeNull();
  });
});
