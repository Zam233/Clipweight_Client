/**
 * 副驾驶标签（PRD master-agent §19.2 / 需求 8）
 *
 * 规则（逐条可测，见 CopilotTabBar/copilotStore 测试）：
 * 1. `requirements` 永远是第一个、且**不可关闭**（不渲染关闭按钮，closeTab 是 no-op）；
 * 2. 关掉当前激活标签 → 焦点回落到 `requirements`；
 * 3. 同 id 重复添加只聚焦，不新增；
 * 4. 上限 8 个，超出返回 false（调用方提示"先关掉一个"）；
 * 5. 按 projectId 持久化到 localStorage，刷新后恢复。
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
  | 'plan';

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

/** 保证 requirements 恒在首位且不可关闭（防御脏数据）。 */
export function normalizeTabs(tabs: CopilotTab[]): CopilotTab[] {
  const rest = (tabs ?? []).filter((t) => t && t.id && t.id !== REQUIREMENTS_TAB.id);
  const seen = new Set<string>();
  const deduped: CopilotTab[] = [];
  for (const t of rest) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    deduped.push({ ...t, closable: t.kind === 'requirements' ? false : t.closable !== false });
  }
  return [REQUIREMENTS_TAB, ...deduped].slice(0, MAX_TABS);
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
  tabs: [REQUIREMENTS_TAB],
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
    set({ tabs: next, activeId: tab.id });
    persist(get());
    return true;
  },

  closeTab: (id: string) => {
    if (id === REQUIREMENTS_TAB.id) return; // 需求对话不可关
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
