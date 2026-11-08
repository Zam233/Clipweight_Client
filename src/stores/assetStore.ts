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
  searchQuery: string;
  uploadProgress: number | null;
  refreshCounter: number;

  // Actions
  setActiveTab: (tab: AssetTab) => void;
  setAssets: (assets: Asset[]) => void;
  setSearchResults: (results: MaterialSearchResult[]) => void;
  addToHistory: (asset: Asset) => void;
  setLoading: (loading: boolean) => void;
  setSearchQuery: (query: string) => void;
  setUploadProgress: (progress: number | null) => void;
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
  setSearchQuery: (query) => set({ searchQuery: query }),
  setUploadProgress: (progress) => set({ uploadProgress: progress }),
  clearAssets: () => set((s) => ({ assets: [], searchResults: [], isLoading: false, uploadProgress: null, refreshCounter: s.refreshCounter + 1 })),
}));

