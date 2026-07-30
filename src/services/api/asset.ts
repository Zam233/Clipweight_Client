import { getApiClient } from './client';
import type {
  Asset,
  AssetUploadResponse,
  MaterialSearchRequest,
  MaterialSearchResult,
} from '@/types/api';

export const assetApi = {
  /** List all assets */
  async list() {
    const { data } = await getApiClient().get('/api/asset/list');
    return data as Asset[];
  },

  /** Upload a single asset */
  async upload(file: File, onProgress?: (pct: number) => void) {
    const formData = new FormData();
    formData.append('file', file);
    const { data } = await getApiClient().post<AssetUploadResponse>(
      '/api/asset/upload',
      formData,
      {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => {
          if (e.total && onProgress) {
            onProgress(Math.round((e.loaded / e.total) * 100));
          }
        },
      },
    );
    return data;
  },

  /** Search materials (semantic) */
  async searchMaterials(request: MaterialSearchRequest) {
    const params: Record<string, string> = { query: request.query };
    if (request.limit) params.top_k = String(request.limit);
    if (request.source) params.sources = request.source;
    const { data } = await getApiClient().post('/api/material/search', null, { params });
    return Array.isArray(data) ? data : [];
  },

  /** List material sources */
  async listSources() {
    const { data } = await getApiClient().get('/api/material/sources');
    return data as { id: string; name: string }[];
  },
};
