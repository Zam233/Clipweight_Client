import { create } from 'zustand';

interface SettingsState {
  apiBaseUrl: string;
  wsUrl: string;
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
  defaultFps: number;
  defaultResolution: { width: number; height: number };

  // Actions
  setApiBaseUrl: (url: string) => void;
  setWsUrl: (url: string) => void;
  setTheme: (theme: 'dark' | 'light') => void;
  setLanguage: (lang: 'zh' | 'en') => void;
  setAuthToken: (token: string | null) => void;
  setAutoSave: (enabled: boolean) => void;
  setSnapEnabled: (enabled: boolean) => void;
  setSnapThreshold: (px: number) => void;
  setSnapToGrid: (enabled: boolean) => void;
  setSnapGridSec: (sec: number) => void;
  setDefaultFps: (fps: number) => void;
  setDefaultResolution: (res: { width: number; height: number }) => void;
}

export const useSettingsStore = create<SettingsState>((set) => ({
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
  wsUrl: import.meta.env.VITE_WS_URL || 'ws://localhost:8000/ws',
  theme: 'dark',
  language: 'zh',
  authToken: null,
  autoSave: true,
  autoSaveIntervalSec: 30,
  maxUndoHistory: 200,
  snapEnabled: true,
  snapThresholdPx: 8,
  snapToGrid: false,
  snapGridSec: 1,
  defaultFps: 30,
  defaultResolution: { width: 1920, height: 1080 },

  setApiBaseUrl: (url) => set({ apiBaseUrl: url }),
  setWsUrl: (url) => set({ wsUrl: url }),
  setTheme: (theme) => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
    set({ theme });
  },
  setLanguage: (lang) => set({ language: lang }),
  setAuthToken: (token) => set({ authToken: token }),
  setAutoSave: (enabled) => set({ autoSave: enabled }),
  setSnapEnabled: (enabled) => set({ snapEnabled: enabled }),
  setSnapThreshold: (px) => set({ snapThresholdPx: px }),
  setSnapToGrid: (enabled) => set({ snapToGrid: enabled }),
  setSnapGridSec: (sec) => set({ snapGridSec: sec }),
  setDefaultFps: (fps) => set({ defaultFps: fps }),
  setDefaultResolution: (res) => set({ defaultResolution: res }),
}));
