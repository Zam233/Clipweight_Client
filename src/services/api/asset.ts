import { getApiClient } from './client';
import type {
  Asset,
  AssetUploadResponse,
  MaterialSearchRequest,
  MaterialSearchResult,
} from '@/types/api';

/** Transform backend asset shape (asset_id/media_type/file_path) to frontend Asset type */
function mapAsset(raw: Record<string, unknown>): Asset {
  return {
    id: (raw.asset_id as string) || (raw.id as string) || '',
    filename: (raw.filename as string) || '',
    path: (raw.file_path as string) || (raw.path as string) || '',
    kind: (raw.media_type as Asset['kind']) || (raw.kind as Asset['kind']) || 'image',
    duration_sec: raw.duration_sec as number | undefined,
    width: raw.width as number | undefined,
    height: raw.height as number | undefined,
    thumbnail_url: (raw.thumbnail_path as string) || (raw.thumbnail_url as string) || undefined,
    tags: (Array.isArray(raw.tags) ? raw.tags : []) as string[],
    created_at: (raw.created_at as string) || new Date().toISOString(),
  };
}

export const assetApi = {
  /** List all assets */
  async list(): Promise<Asset[]> {
    const { data } = await getApiClient().get('/api/asset/list');
    if (!Array.isArray(data)) return [];
    return data.map(mapAsset);
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
