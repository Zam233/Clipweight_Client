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
    const { spec, problems } = validateGenUISpec(valid);
    expect(problems).toEqual([]);
    expect(spec?.items).toHaveLength(2);
    expect(spec?.version).toBe(1);
  });

  it('缺省 version 视为当前版本', () => {
    const { spec } = validateGenUISpec({ items: [{ type: 'text', content: 'x' }] });
    expect(spec?.version).toBe(1);
  });

  it('版本不符整块丢弃（宿主回落原卡片）', () => {
    const { spec, problems } = validateGenUISpec({ version: 9, items: [{ type: 'text', content: 'x' }] });
    expect(spec).toBeNull();
    expect(problems.join()).toContain('版本');
  });

  it('未知组件降级为占位但兄弟节点保留', () => {
    const { spec } = validateGenUISpec({
      items: [{ type: 'hero', title: 'x' }, { type: 'text', content: '兄弟节点' }],
    });
    expect(spec?.items.map((n) => n.type)).toEqual(['text', 'text']);
    expect((spec?.items[0] as { content: string }).content).toContain('hero');
    expect((spec?.items[1] as { content: string }).content).toBe('兄弟节点');
  });

  it('危险键被剔除（原型污染防线）', () => {
    const dirty = JSON.parse('{"items":[{"type":"card","__proto__":{"polluted":true},"items":[{"type":"text","content":"in"}]}]}');
    const { spec } = validateGenUISpec(dirty);
    expect(JSON.stringify(spec)).not.toContain('__proto__');
  });

  it('非白名单动作被丢弃，白名单动作保留', () => {
    const { spec, problems } = validateGenUISpec({
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
    const { spec } = validateGenUISpec({
      items: [
        { type: 'text', content: long },
        { type: 'table', columns: cols, rows: [[...cols]] },
      ],
    });
    expect((spec?.items[0] as { content: string }).content.endsWith('（已截断）')).toBe(true);
    expect((spec?.items[1] as { columns: string[] }).columns).toHaveLength(12);
  });

  it('空/非对象输入返回 null', () => {
    expect(validateGenUISpec(null).spec).toBeNull();
    expect(validateGenUISpec('').spec).toBeNull();
    expect(validateGenUISpec({ items: [] }).spec).toBeNull();
    expect(hasGenUI(valid)).toBe(true);
    expect(hasGenUI({})).toBe(false);
  });

  // 计划 T2.2：老会话 / 无 spec 三种形态都必须"整块不渲染、原卡片完好"
  it.each([
    ['undefined', undefined],
    ['空对象', {}],
    ['空 items', { version: 1, items: [] }],
  ])('%s 不可用 → hasGenUI=false 且渲染器返回 null', (_label, raw) => {
    expect(hasGenUI(raw)).toBe(false);
    const { container } = render(<GenUISpecRenderer rawSpec={raw} />);
    expect(container.querySelector('[data-testid="genui-spec"]')).toBeNull();
  });
});

describe('GenUISpecRenderer', () => {
  it('渲染文本与表格，且没有 spec 时什么都不渲染', () => {
    const { container, rerender } = render(<GenUISpecRenderer rawSpec={valid} />);
    expect(screen.getByText('核心目标')).toBeTruthy();
    expect(screen.getByText('年轻人')).toBeTruthy();
    expect(container.querySelector('[data-testid="genui-spec"]')).toBeTruthy();

    rerender(<GenUISpecRenderer rawSpec={{ version: 42 }} />);
    expect(container.querySelector('[data-testid="genui-spec"]')).toBeNull();
  });

  it('没有宿主回调时动作按钮禁用（不假装可点）', () => {
    render(<GenUISpecRenderer rawSpec={{
      items: [{ type: 'text', content: '带动作', action: { type: 'ask', label: '继续追问' } }],
    }} />);
    const btn = screen.getByRole('button', { name: '继续追问' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('宿主只支持 ask 时，其它类型仍禁用', () => {
    render(<GenUISpecRenderer
      rawSpec={{ items: [{ type: 'text', content: 'a', action: { type: 'confirm', label: '确认' } }] }}
      supportedActions={['ask']}
      onAction={() => {}}
    />);
    const btn = screen.getByRole('button', { name: '确认' }) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
  });

  it('宿主回调存在时 ask 可点并回传节点 id', () => {
    const onAction = vi.fn();
    render(<GenUISpecRenderer
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
    const { container } = render(<GenUISpecRenderer rawSpec={{
      items: [{ type: 'text', content: '<img src=x onerror=alert(1)>' }],
    }} />);
    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeTruthy();
  });

  it('手风琴用原生 details（本地展开，不发请求）', () => {
    const { container } = render(<GenUISpecRenderer rawSpec={{
      items: [{
        type: 'accordion',
        items: [{ title: '分组一', items: [{ type: 'text', content: '里面' }] }],
      }],
    }} />);
    expect(container.querySelector('details')).toBeTruthy();
    expect(screen.getByText('分组一')).toBeTruthy();
  });
});
