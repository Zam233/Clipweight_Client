/**
 * D-0 契约测试：slot 名单冻结、图标白名单、visibleWhen 受限表达式。
 */
import { describe, it, expect } from 'vitest';
import {
  SLOT_NAMES,
  SLOT_ICON_WHITELIST,
  evalVisibleWhen,
  isSlotName,
  sanitizeIContribution,
  type SlotContribution,
} from './slots';

describe('slots 契约 (D-0)', () => {
  it('名单冻结：13 个 slot 且 isSlotName 精确校验', () => {
    expect(SLOT_NAMES).toHaveLength(13);
    expect(isSlotName('editor.right-panel')).toBe(true);
    expect(isSlotName('editor.middle-panel')).toBe(false);
    expect(isSlotName(42)).toBe(false);
  });

  it('visibleWhen：真值判断与四种比较', () => {
    const ctx = { hasSelection: true, clipKind: 'video', playing: false, hasTimeline: true };
    expect(evalVisibleWhen(undefined, ctx)).toBe(true);
    expect(evalVisibleWhen('context.hasSelection', ctx)).toBe(true);
    expect(evalVisibleWhen('context.playing', ctx)).toBe(false);
    expect(evalVisibleWhen("context.clipKind === 'video'", ctx)).toBe(true);
    expect(evalVisibleWhen("context.clipKind === 'audio'", ctx)).toBe(false);
    expect(evalVisibleWhen("context.clipKind !== 'audio'", ctx)).toBe(true);
    expect(evalVisibleWhen('context.hasTimeline === true', ctx)).toBe(true);
  });

  it('visibleWhen：非法表达式一律 false（拒绝 eval）', () => {
    const ctx = { hasSelection: true };
    expect(evalVisibleWhen('alert(1)', ctx)).toBe(false);
    expect(evalVisibleWhen('window.location', ctx)).toBe(false);
    expect(evalVisibleWhen('context.hasSelection === true || true', ctx)).toBe(false);
    expect(evalVisibleWhen("context.a === 'x' + 'y'", ctx)).toBe(false);
    expect(evalVisibleWhen('hasSelection', ctx)).toBe(false); // 缺 context. 前缀
  });

  it('icon 白名单：非法图标被剥离，order 缺省 100', () => {
    const ok: SlotContribution = { slot: 'editor.right-panel', id: 'a', title: 'A', icon: 'Palette', order: 50 };
    expect(sanitizeIContribution(ok)).toMatchObject({ icon: 'Palette', order: 50 });
    const bad: SlotContribution = { slot: 'editor.right-panel', id: 'b', title: 'B', icon: 'Skull' };
    expect(sanitizeIContribution(bad).icon).toBeUndefined();
    expect(sanitizeIContribution(bad).order).toBe(100);
  });

  it('图标白名单本身是闭集', () => {
    expect(SLOT_ICON_WHITELIST.length).toBeGreaterThan(20);
    expect(SLOT_ICON_WHITELIST).not.toContain('eval');
  });
});
