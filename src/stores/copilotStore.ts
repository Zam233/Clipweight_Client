/**
 * 副驾驶标签（PRD master-agent §19.2 / 需求 8；2026-10-28 PRD B1 统一单层标签；
 * 2026-10-31 用户定稿：轨迹固定放在需求对话右侧，执行日志撤删、能力并入轨迹）
 *
 * 规则（逐条可测，见 CopilotTabBar/copilotStore 测试）：
 * 1. `requirements`（需求对话）永远是第一个，`trace`（轨迹）紧随其右，两者**不可关闭**；
 * 2. 关掉当前激活标签 → 焦点回落到 `requirements`；
 * 3. 同 id 重复添加只聚焦，不新增；
 * 4. 上限 8 个，超出返回 false（调用方提示"先关掉一个"）；
 * 5. 按 projectId 持久化到 localStorage，刷新后恢复（旧数据缺 trace 时绑定时补上，
 *    旧的 `logs`（执行日志）标签在绑定时被丢弃——它的内容已并进轨迹的「日志」视图）。
 */
import { create } from 'zustand';
import { loadPref, savePref } from '@/services/storage/localPrefs';

export type CopilotTabKind =
  | 'requirements'
  | 'task-run'
  | 'subagent'
  | 'stage'
  | 'workspace'
  | 'docs'
  | 'plan'
  /** 产物预览（点产物默认在应用内新开一个这种标签；Ctrl+点击走系统打开） */
  | 'artifact';

export interface CopilotTab {
  id: string;
  kind: CopilotTabKind;
  title: string;
  closable: boolean;
  payload?: {
    taskId?: string;
    subagentId?: string;
    stage?: string;
    path?: string;
    projectId?: string;
  };
}

export const MAX_TABS = 8;
export const REQUIREMENTS_TAB: CopilotTab = {
  id: 'requirements',
  kind: 'requirements',
  title: '需求对话',
  closable: false,
};
/**
 * 轨迹：与需求对话同级、**固定**（用户 2026-10-31 定稿）。
 *
 * 取代了原「执行日志」标签：日志内容并入轨迹的「日志」视图，轨迹默认给事件流 +
 * 右侧详情检查器（概述/参数/结果/Schema/计时）。`kind: 'task-run'` 表示它渲染的是
 * 当前任务的执行轨迹——不绑定具体 taskId，跟着 taskStore 里"当前任务"走。
 */
export const TRACE_TAB: CopilotTab = {
  id: 'trace',
  kind: 'task-run',
  title: '轨迹',
  closable: false,
};
/** 固定标签（顺序即渲染顺序，不可关闭、不可重排到末尾之前）。 */
export const FIXED_TABS: readonly CopilotTab[] = [REQUIREMENTS_TAB, TRACE_TAB];


const PREFS_KEY = 'cw_copilot_tabs';

interface Persisted {
  [projectId: string]: { tabs: CopilotTab[]; activeId: string };
}

function readAll(): Persisted {
  try {
    const raw = loadPref<Persisted>(PREFS_KEY, {});
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
}

function writeAll(data: Persisted): void {
  try {
    savePref(PREFS_KEY, data);
  } catch {
    /* 持久化失败不影响会话内使用 */
  }
}

/** 保证固定标签（需求对话 + 轨迹）恒在首位且不可关闭（防御脏数据/旧持久化）。 */
export function normalizeTabs(tabs: CopilotTab[]): CopilotTab[] {
  const fixedIds = new Set(FIXED_TABS.map((t) => t.id));
  const rest = (tabs ?? []).filter((t) => {
    if (!t || !t.id) return false;
    if (fixedIds.has(t.id)) return false;
    // 旧「执行日志」标签已撤删（内容并进轨迹的「日志」视图）→ 绑定时丢掉；
    // 旧的可关闭「轨迹」标签（kind=task-run）也丢掉，避免与固定轨迹重复。
    const kind = String((t as { kind?: string }).kind || '');
    if (kind === 'logs') return false;
    if (kind === 'task-run') return false;
    return true;
  });
  const seen = new Set<string>();
  const deduped: CopilotTab[] = [];
  for (const t of rest) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    deduped.push({ ...t, closable: t.closable !== false });
  }
  return [...FIXED_TABS, ...deduped].slice(0, MAX_TABS);
}

interface CopilotState {
  projectId: string;
  tabs: CopilotTab[];
  activeId: string;
  /** 切项目：载入该项目的标签集合（没有则只有需求对话） */
  bindProject: (projectId: string) => void;
  openTab: (tab: CopilotTab) => boolean;
  closeTab: (id: string) => void;
  setActive: (id: string) => void;
  reorder: (from: number, to: number) => void;
}

function persist(state: CopilotState): void {
  if (!state.projectId) return;
  const all = readAll();
  all[state.projectId] = { tabs: state.tabs, activeId: state.activeId };
  writeAll(all);
}

export const useCopilotStore = create<CopilotState>((set, get) => ({
  projectId: '',
  tabs: [...FIXED_TABS],
  activeId: REQUIREMENTS_TAB.id,

  bindProject: (projectId: string) => {
    const saved = readAll()[projectId];
    const tabs = normalizeTabs(saved?.tabs ?? []);
    const activeId = tabs.some((t) => t.id === saved?.activeId)
      ? String(saved?.activeId)
      : REQUIREMENTS_TAB.id;
    set({ projectId, tabs, activeId });
    // 脏数据（缺 requirements / 重复 / 超限）在绑定时就地修正并回写，避免每次刷新都要修一遍
    if (saved && JSON.stringify(saved.tabs ?? []) !== JSON.stringify(tabs)) {
      persist(get());
    }
  },

  openTab: (tab: CopilotTab) => {
    const state = get();
    const existing = state.tabs.find((t) => t.id === tab.id);
    if (existing) {
      set({ activeId: existing.id });
      persist(get());
      return true;
    }
    if (state.tabs.length >= MAX_TABS) return false;
    const next = normalizeTabs([...state.tabs, tab]);
    // 被规范化丢弃的标签（旧 logs、可关闭轨迹等）不能聚焦——否则 activeId 指向不存在的标签
    if (!next.some((t) => t.id === tab.id)) return false;
    set({ tabs: next, activeId: tab.id });
    persist(get());
    return true;
  },

  closeTab: (id: string) => {
    if (FIXED_TABS.some((t) => t.id === id)) return; // 需求对话 / 轨迹不可关
    const state = get();
    const idx = state.tabs.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const tabs = state.tabs.filter((t) => t.id !== id);
    const activeId = state.activeId === id ? REQUIREMENTS_TAB.id : state.activeId;
    set({ tabs, activeId });
    persist(get());
  },

  setActive: (id: string) => {
    if (!get().tabs.some((t) => t.id === id)) return;
    set({ activeId: id });
    persist(get());
  },

  reorder: (from: number, to: number) => {
    const state = get();
    const tabs = [...state.tabs];
    if (from <= 0 || to <= 0 || from >= tabs.length || to >= tabs.length) return;
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    set({ tabs: normalizeTabs(tabs) });
    persist(get());
  },
}));
