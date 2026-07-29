import { getApiClient } from './client';

export const proxyApi = {
  async generate(assetPath: string, resolution?: string): Promise<{ proxy_path: string; status: string }> {
    const { data } = await getApiClient().post('/api/proxy/generate', {
      asset_path: assetPath,
      resolution: resolution ?? '720p',
    });
    return data;
  },

  async switchToFull(assetPath: string): Promise<{ status: string }> {
    const { data } = await getApiClient().post('/api/proxy/switch', {
      asset_path: assetPath,
      use_proxy: false,
    });
    return data;
  },

  async switchToProxy(assetPath: string): Promise<{ status: string }> {
    const { data } = await getApiClient().post('/api/proxy/switch', {
      asset_path: assetPath,
      use_proxy: true,
    });
    return data;
  },
};
