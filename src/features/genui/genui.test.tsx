// @vitest-environment jsdom
/**
 * GenUI 前端契约测试（校验器 + 渲染器的安全边界）。
 *
 * 与后端 `tests/clipwright/test_genui_spec.py` 是一对：两边规则必须同步，
 * 但**各自独立**（前端不依赖后端服务，后端不依赖前端构建）。
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen, fireEvent } from '@testing-library/react';
import { GenUISpecRenderer } from './GenUISpecRenderer';
import { hasGenUI, validateGenUISpec } from './validate';

afterEach(() => cleanup());


import contractJson from './contract.json';
import { contractFromContribution, type DisplaySpecContract } from './contractSource';
import { hasGenUI as hasGenUIWithContract, validateGenUISpec as validateWithContract } from './validate';

/**
 * 测试用契约：**由插件契约副本构造**（不是手写一份"应该长这样"的规则），
 * 这样前端校验器与插件契约之间的漂移会在测试里直接暴露。
 */
const CONTRACT = contractFromContribution({
  kind: 'display_spec',
  id: 'brief',
  meta: { ...(contractJson as Record<string, unknown>), spec_id: 'brief', source: 'brief', order: 100, trust: 'sanitize' },
}) as DisplaySpecContract;
if (!CONTRACT) throw new Error('contract.json 形状不合法，无法构造测试契约');

const validate = (raw: unknown, contract: DisplaySpecContract | null = CONTRACT) =>
  validateWithContract(raw, contract);
const has = (raw: unknown, contract: DisplaySpecContract | null = CONTRACT) =>
  hasGenUIWithContract(raw, contract);

const valid = {
  version: 1,
  title: '简报',
  items: [
    { type: 'text', content: '核心目标' },
    { type: 'table', columns: ['维度', '内容'], rows: [['受众', '年轻人']] },
  ],
};

describe('validateGenUISpec', () => {
  it('合法 spec 原样通过', () => {
    const { spec, problems } = validate(valid);
    expect(problems).toEqual([]);
    expect(spec?.items).toHaveLength(2);
    expect(spec?.version).toBe(1);
  });

  it('缺省 version 视为当前版本', () => {
    const { spec } = validate({ items: [{ type: 'text', content: 'x' }] });
    expect(spec?.version).toBe(1);
  });

  it('版本不符整块丢弃（宿主回落原卡片）', () => {
    const { spec, problems } = validate({ version: 9, items: [{ type: 'text', content: 'x' }] });
    expect(spec).toBeNull();
    expect(problems.join()).toContain('版本');
  });

  it('未知组件降级为占位但兄弟节点保留', () => {
    const { spec } = validate({
      items: [{ type: 'hero', title: 'x' }, { type: 'text', content: '兄弟节点' }],
    });
    expect(spec?.items.map((n) => n.type)).toEqual(['text', 'text']);
    expect((spec?.items[0] as { content: string }).content).toContain('hero');
    expect((spec?.items[1] as { content: string }).content).toBe('兄弟节点');
  });

  it('危险键被剔除（原型污染防线）', () => {
    const dirty = JSON.parse('{"items":[{"type":"card","__proto__":{"polluted":true},"items":[{"type":"text","content":"in"}]}]}');
    const { spec } = validate(dirty);
    expect(JSON.stringify(spec)).not.toContain('__proto__');
  });

  it('非白名单动作被丢弃，白名单动作保留', () => {
    const { spec, problems } = validate({
      items: [
        { type: 'text', content: '坏', action: { type: 'fetch', url: 'https://evil' } },
        { type: 'text', content: '好', action: { type: 'ask', payload: { prompt: '继续' } } },
      ],
    });
    expect(spec?.items[0].action).toBeUndefined();
    expect(spec?.items[1].action?.type).toBe('ask');
    expect(problems.join()).toContain('fetch');
  });

  it('文本超长截断、表格列数封顶', () => {
    const long = '字'.repeat(5000);
    const cols = Array.from({ length: 20 }, (_, i) => `c${i}`);
    const { spec } = validate({
      items: [
        { type: 'text', content: long },
        { type: 'table', columns: cols, rows: [[...cols]] },
      ],
    });
    expect((spec?.items[0] as { content: string }).content.endsWith('（已截断）')).toBe(true);
    expect((spec?.items[1] as { columns: string[] }).columns).toHaveLength(12);
  });

  it('空/非对象输入返回 null', () => {
    expect(validate(null).spec).toBeNull();
    expect(validate('').spec).toBeNull();
    expect(validate({ items: [] }).spec).toBeNull();
    expect(has(valid)).toBe(true);
    expect(has({})).toBe(false);
  });

  // 计划 T2.2：老会话 / 无 spec 三种形态都必须"整块不渲染、原卡片完好"
  it.each([
    ['undefined', undefined],
    ['空对象', {}],
    ['空 items', { version: 1, items: [] }],
  ])('%s 不可用 → hasGenUI=false 且渲染器返回 null', (_label, raw) => {
    expect(has(raw)).toBe(false);
    const { container } = render(<GenUISpecRenderer contract={CONTRACT} rawSpec={raw} />);
    expect(container.querySelector('[data-testid="genui-spec"]')).toBeNull();
  });
});

describe('GenUISpecRenderer', () => {
  it('渲染文本与表格，且没有 spec 时什么都不渲染', () => {
    const { container, rerender } = render(<GenUISpecRenderer contract={CONTRACT} rawSpec={valid} />);
    expect(screen.getByText('核心目标')).toBeTruthy();
    expect(screen.getByText('年轻人')).toBeTruthy();
    expect(container.querySelector('[data-testid="genui-spec"]')).toBeTruthy();

    rerender(<GenUISpecRenderer contract={CONTRACT} rawSpec={{ version: 42 }} />);
    expect(container.querySelector('[data-testid="genui-spec"]')).toBeNull();
  });

  it('没有宿主回调时动作按钮禁用（不假装可点）', () => {
    render(<GenUISpecRenderer contract={CONTRACT} rawSpec={{
      items: [{ type: 'text', content: '带动作', action: { type: 'ask', label: '继续追问' } }],
    }} />);
    const btn = screen.getByRole('button', { name: '继续追问' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('宿主只支持 ask 时，其它类型仍禁用', () => {
    render(<GenUISpecRenderer contract={CONTRACT}
      rawSpec={{ items: [{ type: 'text', content: 'a', action: { type: 'confirm', label: '确认' } }] }}
      supportedActions={['ask']}
      onAction={() => {}}
    />);
    const btn = screen.getByRole('button', { name: '确认' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('宿主回调存在时 ask 可点并回传节点 id', () => {
    const onAction = vi.fn();
    render(<GenUISpecRenderer contract={CONTRACT}
      rawSpec={{ items: [{ type: 'text', content: 'a', action: { type: 'ask', label: '追问', payload: { prompt: '再细一点' } } }] }}
      supportedActions={['ask']}
      onAction={onAction}
    />);
    const btn = screen.getByRole('button', { name: '追问' });
    fireEvent.click(btn);
    expect(onAction).toHaveBeenCalledTimes(1);
    const event = onAction.mock.calls[0][0];
    expect(event.nodeId).toBe('n0');
    expect(event.action.payload.prompt).toBe('再细一点');
  });

  it('模型给的文本一律按字符串渲染（不执行 HTML）', () => {
    const { container } = render(<GenUISpecRenderer contract={CONTRACT} rawSpec={{
      items: [{ type: 'text', content: '<img src=x onerror=alert(1)>' }],
    }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });

  it('手风琴用原生 details（本地展开，不发请求）', () => {
    const { container } = render(<GenUISpecRenderer contract={CONTRACT} rawSpec={{
      items: [{
        type: 'accordion',
        items: [{ title: '分组一', items: [{ type: 'text', content: '里面' }] }],
      }],
    }} />);
    expect(container.querySelector('details')).toBeTruthy();
    expect(screen.getByText('分组一')).toBeTruthy();
  });
});

// ── Batch 3（T3.1 契约同源 / T3.2 整块上限）──────────────────────────────

import contract from './contract.json';
import {
  CONTAINER_TYPES,
  GENUI_TEXT_SIZES,
  GENUI_TONES,
  MAX_ARRAY_ITEMS,
  MAX_ACTION_PAYLOAD_CHARS,
  MAX_DEPTH,
  MAX_NODES,
  MAX_OPTION_CHARS,
  MAX_SELECT_OPTIONS,
  MAX_SPEC_BYTES,
  MAX_TABLE_COLS,
  MAX_TEXT_CHARS,
} from './validate';
import { GENUI_ACTION_KINDS, GENUI_COMPONENT_TYPES, GENUI_VERSION } from './types';

describe('ContractSingleSource（T3.1）', () => {
  it('常量与 contract.json 逐项一致（改一边忘另一边必须红）', () => {
    expect(contract.version).toBe(GENUI_VERSION);
    expect([...contract.components].sort()).toEqual([...GENUI_COMPONENT_TYPES].sort());
    expect(new Set(GENUI_COMPONENT_TYPES).size).toBe(contract.components.length);
    expect([...contract.containers].sort()).toEqual([...CONTAINER_TYPES].sort());
    expect([...contract.actions].sort()).toEqual([...GENUI_ACTION_KINDS].sort());
    expect([...contract.tones].sort()).toEqual([...GENUI_TONES].sort());
    expect([...contract.text_sizes].sort()).toEqual([...GENUI_TEXT_SIZES].sort());
  });

  it('上限与 contract.json 逐项一致', () => {
    expect(contract.limits).toEqual({
      max_nodes: MAX_NODES,
      max_depth: MAX_DEPTH,
      max_text_chars: MAX_TEXT_CHARS,
      max_spec_bytes: MAX_SPEC_BYTES,
      max_array_items: MAX_ARRAY_ITEMS,
      max_table_cols: MAX_TABLE_COLS,
      max_action_payload_chars: MAX_ACTION_PAYLOAD_CHARS,
      max_select_options: MAX_SELECT_OPTIONS,
      max_option_chars: MAX_OPTION_CHARS,
    });
  });
});

describe('MAX_SPEC_BYTES（T3.2 前端补齐）', () => {
  it('清洗后超过 64K 字符 → 整块丢弃', () => {
    const filler = 'x'.repeat(4000);
    const items = Array.from({ length: 40 }, () => ({ type: 'text', content: filler }));
    const { spec, problems } = validate({ version: 1, items });
    expect(spec).toBeNull();
    expect(problems.join()).toContain('字符');
  });

  it('未超限的 spec 照常通过', () => {
    const { spec } = validate({
      version: 1,
      items: [{ type: 'text', content: 'x'.repeat(1000) }],
    });
    expect(spec).not.toBeNull();
  });
});

// ── Batch 5（T5.1 表格本地排序 / 筛选）──────────────────────────────

import { filterTableRows, sortTableRows } from './GenUISpecRenderer';

const _tableRows = (n: number) => Array.from({ length: n }, (_, i) => [`r${i}`, String(n - i)]);
const _tableSpec = (n: number) => ({
  version: 1,
  items: [{ type: 'table', columns: ['名称', '数值'], rows: _tableRows(n) }],
});

describe('表格本地排序/筛选（T5.1）', () => {
  it('≥8 行出现控件；9 行表点表头后正文变化', () => {
    render(<GenUISpecRenderer contract={CONTRACT} rawSpec={_tableSpec(9)} />);
    expect(screen.getByTestId('genui-table-filter')).toBeTruthy();
    const bodyText = () => screen.getByTestId('genui-table-body').textContent || '';
    const before = bodyText();
    fireEvent.click(screen.getByTestId('genui-table-sort-1'));
    expect(bodyText()).not.toBe(before);
  });

  it('筛选后行数减少且计数可见', () => {
    render(<GenUISpecRenderer contract={CONTRACT} rawSpec={_tableSpec(9)} />);
    fireEvent.change(screen.getByTestId('genui-table-filter'), { target: { value: 'r1' } });
    expect(screen.getByText(/1\/9\s*行/)).toBeTruthy();
    expect(screen.getByTestId('genui-table-body').textContent).toContain('r1');
    expect(screen.getByTestId('genui-table-body').textContent).not.toContain('r2');
  });

  it('6 行表不出现排序/筛选控件', () => {
    render(<GenUISpecRenderer contract={CONTRACT} rawSpec={_tableSpec(6)} />);
    expect(screen.queryByTestId('genui-table-filter')).toBeNull();
    expect(screen.queryByTestId('genui-table-sort-1')).toBeNull();
  });

  it('纯函数：数字列按数值排序（不是字典序）、筛选不区分大小写', () => {
    expect(sortTableRows([['a', '10'], ['b', '9']], 1, 1)[0][0]).toBe('b');
    expect(sortTableRows([['a', '10'], ['b', '9']], 1, -1)[0][0]).toBe('a');
    expect(filterTableRows([['Abc'], ['xyz']], 'ab')).toEqual([['Abc']]);
    expect(filterTableRows([['Abc']], '')).toEqual([['Abc']]);
  });
});

// ── P4.2：select / confirm 动作 ──────────────────────────────────────

describe('select / confirm 动作（P4.2）', () => {
  const specWith = (action: unknown) => ({
    version: 1,
    items: [{ type: 'text', content: '要不要这样？', action }],
  });

  it('select 渲染选项组，点击回传 {value} 而不是模型自定义文案', () => {
    const onAction = vi.fn();
    render(<GenUISpecRenderer contract={CONTRACT}
      rawSpec={specWith({ type: 'select', label: '选一个', payload: { options: ['4 分钟', '8 分钟'] } })}
      supportedActions={['ask', 'select', 'confirm']}
      onAction={onAction}
    />);
    fireEvent.click(screen.getByTestId('genui-select-8 分钟'));
    expect(onAction).toHaveBeenCalledTimes(1);
    const event = onAction.mock.calls[0][0];
    expect(event.action.type).toBe('select');
    expect(event.action.payload).toEqual({ value: '8 分钟' });
    expect(event.action.label).toBe('选一个');
  });

  it('select 无可用选项时整条动作被丢弃（节点保留）', () => {
    const { spec } = validate(specWith({ type: 'select', payload: { options: [] } }));
    expect(spec?.items[0].action).toBeUndefined();
    expect(spec?.items[0].type).toBe('text');
  });

  it('select 选项去重 + 封顶 + 逐项截断', () => {
    const long = 'x'.repeat(MAX_OPTION_CHARS + 10);
    // 长选项放最前：否则总数封顶会先截断，压根走不到「单选项截断」分支
    const options = [long, 'A', 'A', '', 3, ...Array.from({ length: MAX_SELECT_OPTIONS + 3 }, (_, i) => `o${i}`)];
    const { spec } = validate(specWith({ type: 'select', payload: { options } }));
    const cleaned = (spec?.items[0].action?.payload?.options ?? []) as string[];
    expect(cleaned.length).toBe(MAX_SELECT_OPTIONS);
    expect(new Set(cleaned).size).toBe(cleaned.length);
    // 纯截断：长度不超上限，且**不带**「…（已截断）」标记（按钮文案不该有它）
    expect(cleaned.every((o) => o.length <= MAX_OPTION_CHARS)).toBe(true);
    expect(cleaned.some((o) => o.includes('已截断'))).toBe(false);
  });

  it('confirm 可点并把 scope 一起回传（宿主据此决定确认哪个）', () => {
    const onAction = vi.fn();
    render(<GenUISpecRenderer contract={CONTRACT}
      rawSpec={specWith({ type: 'confirm', label: '就按这个来' })}
      scope="plan"
      supportedActions={['ask', 'select', 'confirm']}
      onAction={onAction}
    />);
    fireEvent.click(screen.getByTestId('genui-action-confirm'));
    expect(onAction.mock.calls[0][0].scope).toBe('plan');
  });

  it('hideActions（审阅覆盖层）不渲染任何动作控件', () => {
    render(<GenUISpecRenderer contract={CONTRACT}
      rawSpec={specWith({ type: 'confirm', label: '确认' })}
      supportedActions={['confirm']}
      onAction={() => {}}
      hideActions
    />);
    expect(screen.queryByTestId('genui-action-confirm')).toBeNull();
    expect(screen.getByText('要不要这样？')).toBeTruthy();
  });
});

describe('契约驱动（B4）', () => {
  it('契约声明了前端未实现的组件 → 降级为占位文本', () => {
    const wide: DisplaySpecContract = { ...CONTRACT, components: [...CONTRACT.components, 'mermaid'] };
    const { spec } = validateWithContract(
      { version: 1, items: [{ type: 'mermaid', content: 'graph TD' }, { type: 'text', content: '兄弟节点' }] },
      wide,
    );
    expect(spec?.items[0].type).toBe('text');
    expect((spec?.items[0] as { content: string }).content).toContain('mermaid');
    expect((spec?.items[1] as { content: string }).content).toBe('兄弟节点');
  });

  it('没有契约 → 不渲染、不猜白名单', () => {
    const { spec, problems } = validateWithContract({ version: 1, items: [{ type: 'text', content: 'x' }] }, null);
    expect(spec).toBeNull();
    expect(problems.join()).toContain('契约');
    const { container } = render(<GenUISpecRenderer rawSpec={{ version: 1, items: [{ type: 'text', content: 'x' }] }} />);
    expect(container.querySelector('[data-testid="genui-spec"]')).toBeNull();
  });
});
