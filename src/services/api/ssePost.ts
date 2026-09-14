import { getApiClient } from './client';
import { useSettingsStore } from '@/stores/settingsStore';
import { session } from './session';

/**
 * POST 版 SSE 读取器。
 *
 * 项目既有的 SSE 都是 **GET + EventSource**（进度流、trace 流）——EventSource 不能发 POST
 * 体、也不能带自定义头。但对话消息必须 POST（正文可能很长、还可能带图片附件），
 * 因此这里用 `fetch` + `ReadableStream` 手工按 SSE 帧解析：
 * - `data: <json>` 行逐条解析并回调；
 * - 空行分隔帧；`:` 开头的注释行（心跳）忽略；
 * - 通过 `AbortSignal` 支持取消（组件卸载 / 用户点"停止"）；
 * - 非 2xx 直接把响应体文本当错误抛出（SSE 还没开始，错误是普通 HTTP 错误）。
 */
export interface PostSseOptions {
  /** 每收到一个事件调用（已 JSON.parse；解析失败回退原始字符串） */
  onEvent: (event: unknown) => void;
  /** 取消信号 */
  signal?: AbortSignal;
  /** 请求超时（毫秒，默认 300000 = 5 分钟；流式请求不能用 axios 的 60s 默认值） */
  timeoutMs?: number;
}

export async function streamPostSse(
  url: string,
  body: unknown,
  options: PostSseOptions,
): Promise<void> {
  const base = getApiClient().defaults.baseURL || '';
  const token = useSettingsStore.getState().authToken || session.token;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 300_000);
  const onAbort = () => controller.abort();
  options.signal?.addEventListener('abort', onAbort);

  try {
    const resp = await fetch(`${base}${url}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body ?? {}),
      signal: controller.signal,
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(text || `HTTP ${resp.status}`);
    }
    if (!resp.body) throw new Error('响应没有可读流（浏览器不支持流式读取？）');

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let index = buffer.indexOf('\n\n');
      while (index >= 0) {
        const frame = buffer.slice(0, index);
        buffer = buffer.slice(index + 2);
        for (const line of frame.split('\n')) {
          if (!line.startsWith('data:')) continue;   // 注释/心跳行忽略
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            options.onEvent(JSON.parse(payload));
          } catch {
            options.onEvent(payload);
          }
        }
        index = buffer.indexOf('\n\n');
      }
    }
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener('abort', onAbort);
  }
}
