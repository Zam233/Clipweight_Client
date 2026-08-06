import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { useSettingsStore } from '@/stores/settingsStore';

let client: AxiosInstance | null = null;

export function getApiClient(): AxiosInstance {
  if (!client) {
    const baseURL = useSettingsStore.getState().apiBaseUrl || 'http://localhost:8000';
    client = axios.create({
      baseURL,
      // 普通请求 60s 上限：后端一旦 hang 住能尽快失败，避免挂起连接越堆越多。
      // 真正的长任务（渲染/管线/聊天流）走 SSE(EventSource)，不受 axios timeout 约束；
      // 个别确需更久的 axios 调用可在该请求上单独传 { timeout: ... } 覆盖。
      timeout: 60_000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Request interceptor: attach auth token
    client.interceptors.request.use((config) => {
      const token = useSettingsStore.getState().authToken;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Response interceptor: handle common errors
    client.interceptors.response.use(
      (res) => res,
      (err) => {
        if (err.response?.status === 401) {
          console.warn('[API] Unauthorized (401) — 登录已失效，请重新登录');
          if (typeof window !== 'undefined') {
            window.dispatchEvent(
              new CustomEvent('cw:unauthorized', {
                detail: { status: 401, url: err.config?.url },
              }),
            );
          }
        }
        if (err.response?.status === 503) {
          console.warn('[API] Service busy, retry later');
        }
        return Promise.reject(err);
      },
    );
  }
  return client;
}

/** Reset client (e.g., when API base URL changes) */
export function resetApiClient() {
  client = null;
}
