import { create } from 'zustand';
import { loadPref, savePref } from '@/services/storage/localPrefs';

interface SettingsState {
  apiBaseUrl: string;
  theme: 'dark' | 'light';
  language: 'zh' | 'en';
  authToken: string | null;
  autoSave: boolean;
  autoSaveIntervalSec: number;
  maxUndoHistory: number;
  snapEnabled: boolean;
  snapThresholdPx: number;
  snapToGrid: boolean;
  snapGridSec: number;
  cheatSheetOpen: boolean;
  showFramesInRuler: boolean;
  /** O6: 预览性能诊断面板（每帧耗时/缓存命中率） */
  showPerfPanel: boolean;
  defaultFps: number;
  defaultResolution: { width: number; height: number };
  /** 轮 89：后端离线时是否回退演示假数据（生产默认关；仅本地体验可开） */
  allowDemoFallback: boolean;

  // Actions
  setApiBaseUrl: (url: string) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setLanguage: (lang: 'zh' | 'en') => void;
  setAuthToken: (token: string | null) => void;
  setAutoSave: (enabled: boolean) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setSnapThreshold: (px: number) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setSnapGridSec: (sec: number) => void;
  setCheatSheetOpen: (open: boolean) => void;
  setShowFramesInRuler: (v: boolean) => void;
  setShowPerfPanel: (v: boolean) => void;
  setDefaultFps: (fps: number) => void;
  setDefaultResolution: (res: { width: number; height: number }) => void;
  setAllowDemoFallback: (v: boolean) => void;
}

/** Load persisted editor preferences. */
function loadEditorPrefs() {
  const raw = loadPref<Record<string, unknown>>('editorPrefs', {});
  const num = (v: unknown, def: number, lo: number, hi: number) =>
    typeof v === 'number' && isFinite(v) ? Math.min(Math.max(v, lo), hi) : def;
  // E7: 未存偏好时跟随系统深浅色（prefers-color-scheme）
  const systemPrefersLight =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: light)').matches
      : false;
  return {
    snapEnabled: typeof raw.snapEnabled === 'boolean' ? raw.snapEnabled : true,
    snapThresholdPx: num(raw.snapThresholdPx, 8, 0, 100),
    snapToGrid: typeof raw.snapToGrid === 'boolean' ? raw.snapToGrid : false,
    snapGridSec: num(raw.snapGridSec, 1, 0.05, 60),
    showFramesInRuler: typeof raw.showFramesInRuler === 'boolean' ? raw.showFramesInRuler : false,
    showPerfPanel: typeof raw.showPerfPanel === 'boolean' ? raw.showPerfPanel : false,
    theme:
      raw.theme === 'light' ? ('light' as const)
      : raw.theme === 'dark' ? ('dark' as const)
      : systemPrefersLight ? ('light' as const)
      : ('dark' as const),
  };
}

/** 加载持久化的连接配置（仅 API 地址）。WS 已移除（W9）。
 * 安全约束：access token 仅存内存，绝不落 localStorage（审计 P0 修复）。
 * 旧版本曾把 authToken 写入 connectionPrefs，这里读取时主动擦除残留。 */
function loadConnectionPrefs() {
  const raw = loadPref<Record<string, unknown>>('connectionPrefs', {});
  if (raw.authToken !== undefined) {
    // 迁移：清除历史遗留的明文 token
    savePref('connectionPrefs', {
      apiBaseUrl: typeof raw.apiBaseUrl === 'string' && raw.apiBaseUrl !== '' ? raw.apiBaseUrl : '',
    });
  }
  // P2-09: 显式空串 = 用户清空（不回落环境变量）；键缺失 = 未设置（回落）
  if (typeof raw.apiBaseUrl === 'string') {
    return { apiBaseUrl: raw.apiBaseUrl };
  }
  return {};
}

const prefs = loadEditorPrefs();
// P2-02: 三个死设置接线——读取端补齐默认帧率/分辨率/自动保存偏好
const rawFps = (prefs as Record<string, unknown>).defaultFps;
const rawRes = (prefs as Record<string, unknown>).defaultResolution as { width?: number; height?: number } | undefined;
const rawAutoSave = (prefs as Record<string, unknown>).autoSave;
const connPrefs = loadConnectionPrefs();
// 轮 89：演示回退开关持久化在 editorPrefs
const rawAllowDemoFallback = loadPref<Record<string, unknown>>('editorPrefs', {}).allowDemoFallback;

export const useSettingsStore = create<SettingsState>((set) => ({
  // P0-11: 默认空串（同源）；持久化的旧 localStorage 值仍会被 loadConnectionPrefs 采用——
  // 仅当用户显式在设置中清空 API 地址时回落到空串。WS 已移除（W9）。
  apiBaseUrl: connPrefs.apiBaseUrl ?? import.meta.env.VITE_API_BASE_URL ?? '',
  theme: prefs.theme,
  language: 'zh',
  authToken: null,
  autoSave: typeof rawAutoSave === 'boolean' ? rawAutoSave : true,
  autoSaveIntervalSec: 30,
  maxUndoHistory: 200,
  snapEnabled: prefs.snapEnabled,
  snapThresholdPx: prefs.snapThresholdPx,
  snapToGrid: prefs.snapToGrid,
  snapGridSec: prefs.snapGridSec,
  cheatSheetOpen: false,
  showFramesInRuler: prefs.showFramesInRuler,
  // O6: 性能诊断默认关（面向排障，不是日常 UI）
  showPerfPanel: prefs.showPerfPanel,
  defaultFps: typeof rawFps === 'number' && rawFps > 0 ? rawFps : 30,
  defaultResolution: {
    width: typeof rawRes?.width === 'number' ? rawRes.width : 1920,
    height: typeof rawRes?.height === 'number' ? rawRes.height : 1080,
  },
  // 轮 89：演示回退默认关闭——生产环境后端不可达时应显示错误而非假数据
  allowDemoFallback: typeof rawAllowDemoFallback === 'boolean' ? rawAllowDemoFallback : false,

  setApiBaseUrl: (url) => { set({ apiBaseUrl: url }); persistConnectionPrefs(); },
  setTheme: (theme) => {
    if (typeof document !== 'undefined') {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      document.documentElement.classList.toggle('light', theme === 'light');
    }
    set({ theme });
    persistEditorPrefs();
  },
  setLanguage: (lang) => set({ language: lang }),
  // token 仅驻留内存，不持久化（审计 P0 修复）
  setAuthToken: (token) => { set({ authToken: token }); },
  setAutoSave: (enabled) => { set({ autoSave: enabled }); persistEditorPrefs(); },
  setSnapEnabled: (enabled) => { set({ snapEnabled: enabled }); persistEditorPrefs(); },
  setSnapThreshold: (px) => { set({ snapThresholdPx: px }); persistEditorPrefs(); },
  setSnapToGrid: (enabled) => { set({ snapToGrid: enabled }); persistEditorPrefs(); },
  setSnapGridSec: (sec) => { set({ snapGridSec: sec }); persistEditorPrefs(); },
  setCheatSheetOpen: (open) => set({ cheatSheetOpen: open }),
  setShowFramesInRuler: (v) => { set({ showFramesInRuler: v }); persistEditorPrefs(); },
  setShowPerfPanel: (v) => { set({ showPerfPanel: v }); persistEditorPrefs(); },
  setDefaultFps: (fps) => { set({ defaultFps: fps }); persistEditorPrefs(); },
  setDefaultResolution: (res) => { set({ defaultResolution: res }); persistEditorPrefs(); },
  setAllowDemoFallback: (v) => { set({ allowDemoFallback: v }); persistEditorPrefs(); },
}));

function persistEditorPrefs() {
  const s = useSettingsStore.getState();
  savePref('editorPrefs', {
    snapEnabled: s.snapEnabled,
    snapThresholdPx: s.snapThresholdPx,
    snapToGrid: s.snapToGrid,
    snapGridSec: s.snapGridSec,
    showFramesInRuler: s.showFramesInRuler,
    showPerfPanel: s.showPerfPanel,
    theme: s.theme,
    allowDemoFallback: s.allowDemoFallback,
    // P2-02: 默认帧率/分辨率/自动保存持久化（原死设置）
    defaultFps: s.defaultFps,
    defaultResolution: s.defaultResolution,
    autoSave: s.autoSave,
  });
}

/** 持久化连接配置到 localStorage（键：clipwright.connectionPrefs）。仅含 API 地址。 */
function persistConnectionPrefs() {
  const s = useSettingsStore.getState();
  savePref('connectionPrefs', {
    apiBaseUrl: s.apiBaseUrl,
  });
}

// Apply stored theme on module load
// 注意：Store 可能被非 DOM 环境（node 单测 / SSR）导入，模块级 DOM 访问必须守卫
if (typeof document !== 'undefined') {
  document.documentElement.classList.toggle('dark', prefs.theme === 'dark');
  document.documentElement.classList.toggle('light', prefs.theme === 'light');
}
