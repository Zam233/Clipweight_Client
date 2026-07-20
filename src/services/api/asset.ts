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

  /** Batch upload assets */
  async uploadBatch(files: File[], onProgress?: (pct: number) => void) {
    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));
    const { data } = await getApiClient().post('/api/asset/upload-batch', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      onUploadProgress: (e) => {
        if (e.total && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      },
    });
    return data;
  },

  /** Probe media file info */
  async probe(path: string) {
    const { data } = await getApiClient().get('/api/asset/probe', { params: { path } });
    return data;
  },

  /** Search materials (semantic) */
  async searchMaterials(request: MaterialSearchRequest) {
    const { data } = await getApiClient().post<MaterialSearchResult[]>(
      '/api/material/search',
      request,
    );
    return data;
  },

  /** List material sources */
  async listSources() {
    const { data } = await getApiClient().get('/api/material/sources');
    return data;
  },
};
