/**
 * WebSocket client for real-time communication with the backend.
 * Supports topic-based pub/sub with auto-reconnect.
 */
export class WsClient {
  private ws: WebSocket | null = null;
  private subs = new Map<string, Set<(data: unknown) => void>>();
  private url: string;
  private reconnectDelay = 3000;
  private shouldReconnect = true;

  constructor(url = 'ws://localhost:8000/ws') {
    this.url = url;
  }

  connect() {
    if (this.ws?.readyState === WebSocket.OPEN) return;

    this.ws = new WebSocket(this.url);

    this.ws.onopen = () => {
      console.log('[WS] Connected');
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
      if (this.shouldReconnect) {
        setTimeout(() => this.connect(), this.reconnectDelay);
      }
    };

    this.ws.onerror = (err) => {
      console.error('[WS] Error:', err);
    };
  }

  disconnect() {
    this.shouldReconnect = false;
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
