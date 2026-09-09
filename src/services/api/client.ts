import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { useSettingsStore } from '@/stores/settingsStore';
import { session } from './session';

let client: AxiosInstance | null = null;

export function getApiClient(): AxiosInstance {
  if (!client) {
    // P0-11: 未配置 API 地址时同源（开发走 vite proxy，生产由后端挂载静态/反代）——
    // 原 8000 fallback 与后端实际 8080 漂移导致「无 .env 的生产构建直连错误端口」
    const baseURL = useSettingsStore.getState().apiBaseUrl || '';
    const instance: AxiosInstance = axios.create({
      baseURL,
      // 普通请求 60s 上限：后端一旦 hang 住能尽快失败，避免挂起连接越堆越多。
      // 真正的长任务（渲染/管线/聊天流）走 SSE(EventSource)，不受 axios timeout 约束；
      // 个别确需更久的 axios 调用可在该请求上单独传 { timeout: ... } 覆盖。
      timeout: 60_000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Request interceptor: attach auth token（P3-3B: 本地令牌优先，其次账号会话令牌）
    instance.interceptors.request.use((config) => {
      const token = useSettingsStore.getState().authToken || session.token;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Response interceptor: handle common errors
    instance.interceptors.response.use(
      (res) => res,
      (err) => {
        // P2-23: 401 后先静默续期，成功则重放原请求（仅一次，__retried401 防循环）；
        // 续期失败才广播 cw:unauthorized。返回 promise 保持原调用链的 resolve/reject。
        if (err.response?.status === 401 && !err.config?.__retried401) {
          return (async () => {
            const { useAuthStore } = await import('@/stores/authStore');
            let refreshed = false;
            try {
              refreshed = await useAuthStore.getState().refresh();
            } catch {
              refreshed = false; // 续期请求自身失败（网络/离线）视作未续期
            }
            if (refreshed && err.config) {
              err.config.__retried401 = true;
              return instance.request(err.config);
            }
            console.warn('[API] Unauthorized (401) — 登录已失效，请重新登录');
            if (typeof window !== 'undefined') {
              window.dispatchEvent(
                new CustomEvent('cw:unauthorized', {
                  detail: { status: 401, url: err.config?.url },
                }),
              );
            }
            throw err;
          })();
        }
        if (err.response?.status === 503) {
          console.warn('[API] Service busy, retry later');
        }
        // 422：FastAPI 校验错误，detail 可能是字符串或 [{loc, msg, type}] 数组——归一化为 userMessage
        if (err.response?.status === 422) {
          const detail = (err.response.data as { detail?: unknown } | undefined)?.detail;
          let friendly: string | null = null;
          if (typeof detail === 'string') {
            friendly = detail;
          } else if (Array.isArray(detail) && detail.length > 0) {
            const first = detail[0] as { msg?: unknown } | undefined;
            if (typeof first?.msg === 'string') friendly = first.msg;
          }
          if (friendly) (err as { userMessage?: string }).userMessage = friendly;
        }
        // 400：detail 为字符串时透传为 userMessage
        if (err.response?.status === 400) {
          const detail = (err.response.data as { detail?: unknown } | undefined)?.detail;
          if (typeof detail === 'string') {
            (err as { userMessage?: string }).userMessage = detail;
          }
        }
        return Promise.reject(err);
      },
    );
    client = instance;
  }
  return client;
}

/** Reset client (e.g., when API base URL changes) */
export function resetApiClient() {
  client = null;
}
