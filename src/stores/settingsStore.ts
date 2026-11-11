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
  /**
   * 连续播放（devplan M1 回滚开关；**本键是新增项，不是历史开关**）。
   *
   * 开 = 新路径：视频元素连续解码 + 播放中不逐帧 seek + 解码池限流（≤2 路）；
   * 关 = 旧路径：每帧 seek 取帧（会看到「一帧一帧」，作为 A/B 与回滚手段）。
   * 现按 PRD W1.1 改为**默认开启**（缺省 true）；用户显式存过 false 则尊重其选择。
   */
  previewContinuousPlayback: boolean;
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
  setPreviewContinuousPlayback: (v: boolean) => void;
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
    /**
     * E-07：三项「死设置」以前不在这个返回值里，读取端从返回值取恒为 undefined，
     * 于是刷新后 autoSave 永远 true、默认帧率/分辨率永远回落硬编码。现在统一校验后返回。
     */
    autoSave: typeof raw.autoSave === 'boolean' ? raw.autoSave : true,
    // E-07：非法值不应被"钳到边界"当成有效偏好——损坏数据直接回落默认。
    defaultFps: typeof raw.defaultFps === 'number'
      && isFinite(raw.defaultFps) && raw.defaultFps >= 1 && raw.defaultFps <= 240
      ? Math.round(raw.defaultFps) : 30,
    defaultResolution: (() => {
      const res = raw.defaultResolution;
      if (!res || typeof res !== 'object' || Array.isArray(res)) return { width: 1920, height: 1080 };
      const r = res as Record<string, unknown>;
      const valid = (v: unknown) => typeof v === 'number' && isFinite(v) && v >= 16 && v <= 7680;
      if (!valid(r.width) || !valid(r.height)) return { width: 1920, height: 1080 };
      return { width: Math.round(r.width as number), height: Math.round(r.height as number) };
    })(),
    /**
     * 连续播放（devplan M1 · PRD W1.1/W1.2）。
     *
     * 默认值 = `true`（新路径：连续解码 + 解码池）。**只改变"从没存过这个偏好"的行为**：
     * 用户显式存过 `false` 就尊重他——覆盖显式偏好会让升级后资源占用突变，
     * 而他当初关掉它一定是有原因的（老机器/远程桌面）。
     * 验收期仍保留设置项做 A/B，达标后再另开变更移除开关。
     */
    previewContinuousPlayback: typeof raw.previewContinuousPlayback === 'boolean'
      ? raw.previewContinuousPlayback
      : true,
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
// E-07：三项设置现在由 loadEditorPrefs 统一校验并返回，不再从返回值里读不存在的键。
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
  autoSave: prefs.autoSave,
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
  previewContinuousPlayback: prefs.previewContinuousPlayback,
  defaultFps: prefs.defaultFps,
  defaultResolution: prefs.defaultResolution,
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
  setPreviewContinuousPlayback: (v) => { set({ previewContinuousPlayback: v }); persistEditorPrefs(); },
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
    // devplan M1：连续播放开关（默认关；人工验收后由用户开启）
    previewContinuousPlayback: s.previewContinuousPlayback,
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


