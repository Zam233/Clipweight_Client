import { fetchSseToken, withSseToken } from './sse';

/**
 * E3: 共享 SSE 连接工具 — 一次性 token + 自动重连 + 手动重连。
 *
 * EventSource 原生 onerror 语义是「出错即终止」，网络一次抖动就会丢掉
 * 整条进度流（此前 ExportPage 直接把任务标为失败）。本工具统一实现
 * AgentPanel 已验证的重连策略：连续失败退避重试（默认 3s 线性退避、
 * 5 次上限），上限后回调调用方降级 UI（手动重试按钮）。
 */

export interface SseStreamOptions {
  /** EventSource 目标 URL（不带 token；token 由本工具获取并拼接） */
  url: string;
  /** 收到消息（已尝试 JSON.parse，失败时透传原始字符串） */
  onMessage: (data: unknown) => void;
  /** 单次重连尝试开始（用于显示"重连中"状态） */
  onRetry?: (attempt: number) => void;
  /** 连续重连失败达上限（调用方负责降级 UI / 手动重试） */
  onGiveUp?: () => void;
  /** 连续失败重试上限，默认 5；收到任何消息即重置 */
  maxRetries?: number;
  /** 基础退避毫秒数（实际 = base × 第几次），默认 3000 */
  retryDelayMs?: number;
}

export interface SseStreamHandle {
  close: () => void;
  /** 手动立即重连（重置失败计数） */
  reconnect: () => void;
}

export function connectSseStream(opts: SseStreamOptions): SseStreamHandle {
  const maxRetries = opts.maxRetries ?? 5;
  const retryDelay = opts.retryDelayMs ?? 3000;
  let es: EventSource | null = null;
  let closed = false;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const open = async () => {
    if (closed) return;
    const tok = await fetchSseToken();
    if (closed) return;
    es = new EventSource(withSseToken(opts.url, tok));
    es.onmessage = (e) => {
      retries = 0; // 收到消息说明链路健康，重置连续失败计数
      let data: unknown = (e as MessageEvent).data;
      try {
        data = JSON.parse((e as MessageEvent).data);
      } catch {
        /* 保留原始字符串 */
      }
      opts.onMessage(data);
    };
    es.onerror = () => {
      es?.close();
      es = null;
      if (closed) return;
      if (retries >= maxRetries) {
        opts.onGiveUp?.();
        return;
      }
      retries += 1;
      opts.onRetry?.(retries);
      timer = setTimeout(() => {
        void open();
      }, retryDelay * retries);
    };
  };

  void open();
  return {
    close: () => {
      closed = true;
      if (timer) clearTimeout(timer);
      es?.close();
      es = null;
    },
    reconnect: () => {
      retries = 0;
      closed = false;
      void open();
    },
  };
}
