/**
 * WebSocket client for real-time communication with the backend.
 * Supports topic-based pub/sub with auto-reconnect (exponential backoff).
 */
export class WsClient {
  private ws: WebSocket | null = null;
  private subs = new Map<string, Set<(data: unknown) => void>>();
  private url: string;
  private baseDelay = 3000;
  private maxDelay = 60000;
  private currentDelay = 3000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private shouldReconnect = true;

  constructor(url?: string) {
    this.url = url ?? import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000/ws';
  }

  connect() {
    // 防止重复连接：OPEN 或 CONNECTING 状态下不再创建新实例
    const state = this.ws?.readyState;
    if (state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('[WS] Connected');
      this.currentDelay = this.baseDelay;
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        const topic = msg.topic as string;
        if (topic && this.subs.has(topic)) {
          this.subs.get(topic)!.forEach((cb) => cb(msg.data));
        }
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      console.log('[WS] Disconnected');
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };
  }

  private scheduleReconnect() {
    if (!this.shouldReconnect || this.reconnectTimer !== null) return;
    const delay = this.currentDelay;
    // 指数退避：3s → 6s → 12s … 上限 60s
    this.currentDelay = Math.min(this.currentDelay * 2, this.maxDelay);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.ws?.close();
    this.ws = null;
  }

  subscribe(topic: string, cb: (data: unknown) => void): () => void {
    if (!this.subs.has(topic)) {
      this.subs.set(topic, new Set());
    }
    this.subs.get(topic)!.add(cb);
    return () => {
      this.subs.get(topic)?.delete(cb);
    };
  }

  send(topic: string, data: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ topic, data }));
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

/** Singleton WebSocket client */
export const wsClient = new WsClient();
