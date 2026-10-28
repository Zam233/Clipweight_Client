// @vitest-environment jsdom
/**
 * 副驾驶标签（PRD §19.2 / 需求 8；2026-10-28 PRD B1 单层标签）：
 * 固定标签（需求对话 + 执行日志）不可关、去重、上限、持久化。
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  FIXED_TABS,
  LOGS_TAB,
  MAX_TABS,
  REQUIREMENTS_TAB,
  normalizeTabs,
  useCopilotStore,
} from './copilotStore';

const reset = () => {
  localStorage.clear();
  useCopilotStore.setState({
    projectId: 'p1',
    tabs: [...FIXED_TABS],
    activeId: REQUIREMENTS_TAB.id,
  });
};

describe('copilotStore', () => {
  beforeEach(reset);

  it('requirements 恒在首位且不可关闭', () => {
    const s = useCopilotStore.getState();
    expect(s.tabs[0].id).toBe('requirements');
    expect(s.tabs[0].closable).toBe(false);

    s.closeTab('requirements');
    expect(useCopilotStore.getState().tabs.some((t) => t.id === 'requirements')).toBe(true);
    expect(useCopilotStore.getState().activeId).toBe('requirements');
  });

  it('B1：执行日志（logs）是第二个固定标签，不可关闭', () => {
    const s = useCopilotStore.getState();
    expect(s.tabs[1].id).toBe(LOGS_TAB.id);
    expect(s.tabs[1].kind).toBe('logs');
    expect(s.tabs[1].title).toBe('执行日志');
    expect(s.tabs[1].closable).toBe(false);

    s.closeTab(LOGS_TAB.id);
    expect(useCopilotStore.getState().tabs.some((t) => t.id === LOGS_TAB.id)).toBe(true);
  });

  it('可以新增并关闭其他标签，焦点回落到 requirements', () => {
    const s = useCopilotStore.getState();
    expect(s.openTab({ id: 'task-run:current', kind: 'task-run', title: '任务运行', closable: true })).toBe(true);

    const after = useCopilotStore.getState();
    expect(after.tabs).toHaveLength(FIXED_TABS.length + 1);
    expect(after.activeId).toBe('task-run:current');

    after.closeTab('task-run:current');
    expect(useCopilotStore.getState().tabs).toHaveLength(FIXED_TABS.length);
    expect(useCopilotStore.getState().activeId).toBe('requirements');
  });

  it('同 id 重复添加只聚焦，不新增', () => {
    const s = useCopilotStore.getState();
    s.openTab({ id: 'docs:list', kind: 'docs', title: '文档', closable: true });
    s.openTab({ id: 'docs:list', kind: 'docs', title: '文档', closable: true });
    expect(useCopilotStore.getState().tabs).toHaveLength(FIXED_TABS.length + 1);
    expect(useCopilotStore.getState().activeId).toBe('docs:list');
  });

  it('超过上限时返回 false 且不新增', () => {
    const s = useCopilotStore.getState();
    for (let i = 1; i <= MAX_TABS - FIXED_TABS.length; i += 1) {
      expect(s.openTab({ id: `t${i}`, kind: 'docs', title: `t${i}`, closable: true })).toBe(true);
    }
    expect(useCopilotStore.getState().tabs).toHaveLength(MAX_TABS);
    expect(s.openTab({ id: 'overflow', kind: 'docs', title: 'overflow', closable: true })).toBe(false);
    expect(useCopilotStore.getState().tabs).toHaveLength(MAX_TABS);
  });

  it('按 projectId 持久化并在 bindProject 后恢复', () => {
    const s = useCopilotStore.getState();
    s.openTab({ id: 'workspace', kind: 'workspace', title: '工作区', closable: true });

    const other = useCopilotStore.getState();
    other.bindProject('p2');
    expect(useCopilotStore.getState().tabs).toHaveLength(FIXED_TABS.length);

    useCopilotStore.getState().bindProject('p1');
    const restored = useCopilotStore.getState();
    expect(restored.tabs.some((t) => t.id === 'workspace')).toBe(true);
    expect(restored.activeId).toBe('workspace');
  });

  it('normalizeTabs 清理脏数据（重复/缺 requirements/不可关标记）', () => {
    const tabs = normalizeTabs([
      { id: 'x', kind: 'docs', title: 'x', closable: true },
      { id: 'x', kind: 'docs', title: 'x', closable: true },
      { id: 'requirements', kind: 'requirements', title: '需求对话', closable: true },
    ]);
    expect(tabs[0].id).toBe('requirements');
    expect(tabs[0].closable).toBe(false);
    expect(tabs.filter((t) => t.id === 'x')).toHaveLength(1);
  });

  it('B1：旧持久化数据（只有 requirements）绑定后补出 logs 且限长', () => {
    // 旧版本会话只存了 requirements + 若干动态标签，没有 logs
    const legacy = [
      { id: 'requirements', kind: 'requirements' as const, title: '需求对话', closable: false },
      ...Array.from({ length: 10 }, (_, i) => ({
        id: `old${i}`, kind: 'docs' as const, title: `old${i}`, closable: true,
      })),
    ];
    const normalized = normalizeTabs(legacy);
    expect(normalized[0].id).toBe('requirements');
    expect(normalized[1].id).toBe('logs');
    expect(normalized).toHaveLength(MAX_TABS); // 固定标签 + 动态标签不超过上限
    expect(normalized.filter((t) => t.id === 'logs')).toHaveLength(1); // 不重复插入
  });
});
