import axios from 'axios';
import type { AxiosInstance } from 'axios';
import { useSettingsStore } from '@/stores/settingsStore';

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

    // Request interceptor: attach 本地 API 令牌（设置页配置；账号系统已剥离）
    instance.interceptors.request.use((config) => {
      const token = useSettingsStore.getState().authToken;
      if (token) {
        config.headers.Authorization = `Bearer ${token}`;
      }
      return config;
    });

    // Response interceptor: handle common errors
    instance.interceptors.response.use(
      (res) => res,
      (err) => {
        // 401/503：以前只在 console.warn，用户完全看不到。统一挂 userMessage，
        // 由调用方 toast/错误区显示；保留 console.warn 供排障，不泄漏令牌值。
        if (err.response?.status === 401) {
          console.warn('[API] Unauthorized (401) — 请检查设置中的 API 令牌');
          (err as { userMessage?: string }).userMessage =
            '未授权（401）：请检查「设置 → 后端连接」中的 API 令牌是否与后端一致';
        }
        if (err.response?.status === 503) {
          console.warn('[API] Service busy, retry later');
          (err as { userMessage?: string }).userMessage =
            '服务暂时不可用（503），请稍后重试';
        }
        // 422：FastAPI 校验错误，detail 可能是字符串或 [{loc, msg, type}] 数组。
        // PL-08：旧实现只取 detail[0].msg，丢掉字段路径与其它错误。现在逐条拼
        // `loc.msg`（最多 3 条），并把完整结构化条目挂到 errorDetails 供页面展开。
        if (err.response?.status === 422) {
          const detail = (err.response.data as { detail?: unknown } | undefined)?.detail;
          let friendly: string | null = null;
          if (typeof detail === 'string') {
            friendly = detail;
          } else if (Array.isArray(detail) && detail.length > 0) {
            const entries = detail.map((raw) => {
              const item = (raw && typeof raw === 'object' ? raw : {}) as {
                loc?: unknown; msg?: unknown; type?: unknown;
              };
              const loc = Array.isArray(item.loc)
                ? item.loc.filter((p): p is string => typeof p === 'string')
                : [];
              return {
                loc,
                msg: typeof item.msg === 'string' ? item.msg : String(item.msg ?? '校验失败'),
              };
            });
            (err as { errorDetails?: unknown }).errorDetails = entries;
            friendly = entries.slice(0, 3)
              .map((e) => (e.loc.length ? `${e.loc.join('.')}: ${e.msg}` : e.msg))
              .join('；') || '请求参数校验失败（422）';
          } else if (detail !== undefined && detail !== null) {
            friendly = '请求参数校验失败（422）';
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
