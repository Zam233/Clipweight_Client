import { create } from 'zustand';
import type { Asset, MaterialSearchResult } from '@/types/api';
import { loadPrefArray, savePref } from '@/services/storage/localPrefs';

type AssetTab = 'ai' | 'library' | 'workspace' | 'history' | 'dub' | 'plugins';

interface AssetState {
  activeTab: AssetTab;
  assets: Asset[];
  searchResults: MaterialSearchResult[];
  history: Asset[];
  isLoading: boolean;
  /**
   * M-09（PRD §5B P3）：搜索词已在 AssetPanel 改为本地 useState（面板独占），
   * 这个 store 字段无任何读写方（死字段）。字段保留占位以免破坏类型引用，
   * `setSearchQuery` 已随本次清理移除。
   */
  searchQuery: string;
  /**
   * M-05（PRD §5B P2）：上传进度既可能是百分比（0–100），也可能是逐文件文本
   * （「2/5 正在上传：a.mp4」）——workspaceApi.upload 没有字节级回调，只能给后者。
   * null = 没有正在进行的上传。
   */
  uploadProgress: number | string | null;
  refreshCounter: number;

  // Actions
  setActiveTab: (tab: AssetTab) => void;
  setAssets: (assets: Asset[]) => void;
  setSearchResults: (results: MaterialSearchResult[]) => void;
  addToHistory: (asset: Asset) => void;
  setLoading: (loading: boolean) => void;
  setUploadProgress: (progress: number | string | null) => void;
  clearAssets: () => void;
}

export const useAssetStore = create<AssetState>((set) => ({
  // devplan T3.4：默认落到「工作区」——合并后它才是素材的唯一真相；
  // 旧 library 仍保留可点（回滚只需把这一行改回 'library'）。
  activeTab: 'workspace',
  assets: [],
  searchResults: [],
  history: loadPrefArray<Asset>('assetHistory'),
  isLoading: false,
  searchQuery: '',
  uploadProgress: null,
  refreshCounter: 0,

  setActiveTab: (tab) => set({ activeTab: tab }),
  setAssets: (assets) => set({ assets }),
  setSearchResults: (results) => set({ searchResults: results }),

  addToHistory: (asset) =>
    set((state) => {
      const history = [asset, ...state.history.filter((a) => a.id !== asset.id)].slice(0, 50);
      savePref('assetHistory', history);
      return { history };
    }),

  setLoading: (loading) => set({ isLoading: loading }),
  setUploadProgress: (progress) => set({ uploadProgress: progress }),
  clearAssets: () => set((s) => ({ assets: [], searchResults: [], isLoading: false, uploadProgress: null, refreshCounter: s.refreshCounter + 1 })),
}));

