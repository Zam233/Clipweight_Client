// @vitest-environment jsdom
/**
 * C4：宿主侧统一可见性过滤 usableContributions。
 *
 * 所有消费方（Slot / EditorLayout / toolbar / timeline / nav / overlay / page /
 * export）都必须用它决定一条贡献是否渲染——`visibleWhen=false` 或入口内容
 * 无效（无 action / 无 layout / to 非法）的贡献不得占位。
 */
import { describe, it, expect } from 'vitest';
import { usableContributions, type SlotContribution } from './slots';

function contrib(over: Partial<SlotContribution> = {}): SlotContribution {
  return {
    kind: 'ui_slot', id: 'c1', owner: 'plug', title: 'C1', slot: 'editor.toolbar',
    ...over,
  } as SlotContribution;
}

describe('usableContributions（C4 可见性统一）', () => {
  it('visibleWhen 缺省视为可见', () => {
    const out = usableContributions([contrib()], {});
    expect(out).toHaveLength(1);
  });

  it('visibleWhen=false 的贡献被过滤（fail-closed）', () => {
    const out = usableContributions(
      [contrib({ visibleWhen: "context.never === 'yes'" })], {},
    );
    expect(out).toHaveLength(0);
  });

  it('visibleWhen 满足时保留', () => {
    const out = usableContributions(
      [contrib({ visibleWhen: "context.kind === 'video'" })],
      { kind: 'video' } as never,
    );
    expect(out).toHaveLength(1);
  });

  it('表达式解析失败按不可见处理，不抛错', () => {
    const out = usableContributions(
      [contrib({ visibleWhen: 'window.alert(1)' })], {},
    );
    expect(out).toHaveLength(0);
  });

  it('entryOk 返回 false 的贡献被过滤（入口内容有效性）', () => {
    const out = usableContributions(
      [contrib(), contrib({ id: 'c2', payload: { action: { endpoint: '/api/tool/execute' } } })],
      {},
      (c) => Boolean((c.payload as { action?: { endpoint?: string } } | undefined)?.action?.endpoint),
    );
    expect(out.map((c) => c.id)).toEqual(['c2']);
  });

  it('过滤顺序：entryOk 与 visibleWhen 同时生效', () => {
    const out = usableContributions(
      [
        contrib({ id: 'a', visibleWhen: 'context.on' }),              // 可见但无 action → 滤掉
        contrib({ id: 'b', payload: { action: { endpoint: '/api/x' } } }), // 有 action 且无 visibleWhen → 保留
        contrib({ id: 'c', visibleWhen: 'context.on', payload: { action: { endpoint: '/api/x' } } }),
        contrib({ id: 'd', payload: { action: { endpoint: '/api/x' } }, visibleWhen: "context.mode === 'other'" }),
      ],
      { on: true } as never,
      (c) => Boolean((c.payload as { action?: unknown } | undefined)?.action),
    );
    // b：无 visibleWhen（恒可见）+ 有 action → 保留
    // c：可见 + 有 action → 保留
    // d：visibleWhen 求值 false（context.mode 未定义 ≠ 'other'）→ 滤掉
    expect(out.map((c) => c.id)).toEqual(['b', 'c']);
  });
});
