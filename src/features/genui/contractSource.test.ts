// @vitest-environment jsdom
/**
 * 契约获取（B4-T4.1）：缓存 / 失效 / 失败静默 / `resolveDisplaySpecs` 兼容老键。
 *
 * 这些用例守住一条底线：**宿主永远不猜契约**——拿不到就返回空 Map，由调用方决定不渲染。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  contractsFromResponse,
  contractFromContribution,
  fetchDisplaySpecContracts,
  invalidateDisplaySpecContracts,
  resolveDisplaySpecs,
} from './contractSource';
import contractJson from './contract.json';

const mocks = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/services/api', () => ({ getApiClient: () => ({ get: mocks.get }) }));

const meta = {
  ...(contractJson as Record<string, unknown>),
  spec_id: 'brief',
  source: 'brief',
  order: 100,
  trust: 'sanitize',
};

const response = {
  contributions: [
    { kind: 'display_spec', id: 'brief', owner: 'genui', meta },
    {
      kind: 'display_spec',
      id: 'plan',
      owner: 'genui',
      meta: { ...meta, spec_id: 'plan', source: 'plan', order: 110, trust: 'recipe_only' },
    },
    { kind: 'prompt', id: 'genui_requirements_prompt', meta: {} },
    // 形状坏的条目：必须被跳过，不能让整张 Map 变脏
    { kind: 'display_spec', id: 'broken', meta: { spec_id: 'other' } },
  ],
};

beforeEach(() => {
  mocks.get.mockReset();
  invalidateDisplaySpecContracts();
});

describe('contractFromContribution', () => {
  it('只收 kind=display_spec 且 spec_id == id 的条目', () => {
    const contract = contractFromContribution(response.contributions[0]);
    expect(contract?.specId).toBe('brief');
    expect(contract?.components.length).toBeGreaterThan(0);
    expect(contract?.limits.max_nodes).toBe(100);
    expect(contractFromContribution(response.contributions[2])).toBeNull();
    expect(contractFromContribution(response.contributions[3])).toBeNull();
  });
});

describe('contractsFromResponse', () => {
  it('组装 Map 并跳过坏条目', () => {
    const map = contractsFromResponse(response);
    expect([...map.keys()]).toEqual(['brief', 'plan']);
    expect(map.get('plan')?.trust).toBe('recipe_only');
  });

  it('空响应 → 空 Map', () => {
    expect(contractsFromResponse(null).size).toBe(0);
    expect(contractsFromResponse({}).size).toBe(0);
  });
});

describe('fetchDisplaySpecContracts', () => {
  it('成功时请求统一出口并组装契约', async () => {
    mocks.get.mockResolvedValue(response);
    const map = await fetchDisplaySpecContracts();
    expect(mocks.get).toHaveBeenCalledWith('/api/plugin/contributions?kind=display_spec');
    expect(map.size).toBe(2);
  });

  it('30s 内复用缓存（不再发请求）', async () => {
    mocks.get.mockResolvedValue(response);
    await fetchDisplaySpecContracts();
    await fetchDisplaySpecContracts();
    expect(mocks.get).toHaveBeenCalledTimes(1);
  });

  it('失效后重新请求', async () => {
    mocks.get.mockResolvedValue(response);
    await fetchDisplaySpecContracts();
    invalidateDisplaySpecContracts();
    await fetchDisplaySpecContracts();
    expect(mocks.get).toHaveBeenCalledTimes(2);
  });

  it('失败时静默返回空 Map（插件面不阻塞宿主）', async () => {
    mocks.get.mockRejectedValue(new Error('boom'));
    const map = await fetchDisplaySpecContracts();
    expect(map.size).toBe(0);
  });
});

describe('resolveDisplaySpecs', () => {
  it('优先新形状 display_specs（每个键一项）', () => {
    const out = resolveDisplaySpecs(
      { display_specs: { brief: { items: [] }, plan: { items: [] } } },
      'brief',
    );
    expect(out.map((x) => x.specId)).toEqual(['brief', 'plan']);
  });

  it('没有新形状时回退老键 genui（当作 surface 那一份）', () => {
    const out = resolveDisplaySpecs({ genui: { version: 1, items: [] } }, 'plan');
    expect(out).toEqual([{ specId: 'plan', raw: { version: 1, items: [] } }]);
  });

  it('新形状优先于老键', () => {
    const out = resolveDisplaySpecs(
      { display_specs: { brief: { items: [] } }, genui: { items: [{ type: 'text' }] } },
      'brief',
    );
    expect(out).toHaveLength(1);
    expect(out[0].raw).toEqual({ items: [] });
  });

  it('两者都没有 / 非对象 → 空数组', () => {
    expect(resolveDisplaySpecs({}, 'brief')).toEqual([]);
    expect(resolveDisplaySpecs(null, 'brief')).toEqual([]);
    expect(resolveDisplaySpecs('x', 'brief')).toEqual([]);
    expect(resolveDisplaySpecs({ display_specs: {} }, 'brief')).toEqual([]);
  });
});
