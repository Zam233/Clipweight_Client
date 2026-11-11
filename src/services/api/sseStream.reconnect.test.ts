// @vitest-environment jsdom
/**
 * E-06 线索 5（复核确认，PRD §5A）：`sseStream.reconnect()` 不清理旧连接
 * 与重连定时器 → 双连接（onMessage 收两份）。
 *
 * 修复：reconnect 先 clearTimeout + es.close() 再 open。
 * 这里用「重连后 onMessage 只被调用一次/事件」验证。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type FakeES = {
  onmessage: ((e: { data: string }) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
};

class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;
  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }
  close() { this.closed = true; }
  emit(data: string) { this.onmessage?.({ data }); }
  fail() { this.onerror?.(); }
}

vi.stubGlobal('EventSource', MockEventSource as unknown as typeof EventSource);

// fetchSseToken 内部可能发请求拿 token；测试里直接给固定值
vi.mock('./sse', () => ({
  fetchSseToken: vi.fn(async () => 'tok'),
  withSseToken: (url: string, tok: string) => `${url}?t=${tok}`,
}));

import { connectSseStream } from './sseStream';

beforeEach(() => {
  MockEventSource.instances = [];
  vi.useFakeTimers();
});

describe('E-06 线索 5：reconnect 不产生双连接', () => {
  /** open() 是 async（先取 token），EventSource 在微任务后才实例化。 */
  const flush = () => Promise.resolve().then(() => {}).then(() => {});

  it('reconnect 后只有一条活跃连接，事件只收到一份', async () => {
    const onMessage = vi.fn();
    const handle = connectSseStream({ url: 'http://x/stream', onMessage, retryDelayMs: 10 });
    await flush(); // 第一条连接建立

    // 模拟断线 → 自动重连定时器排队
    MockEventSource.instances[0].fail();
    vi.advanceTimersByTime(10);
    await flush();
    // 此时已有第二条连接；再手动 reconnect（旧实现会建第三条）
    handle.reconnect();
    await flush();

    const es2 = MockEventSource.instances[1];
    const es3 = MockEventSource.instances[2];
    // 旧连接必须已被关闭，只剩最新一条
    expect(es2.closed).toBe(true);
    expect(es3.closed).toBe(false);
    expect(MockEventSource.instances.filter((e) => !e.closed)).toHaveLength(1);

    es3.emit(JSON.stringify({ seq: 1 }));
    expect(onMessage).toHaveBeenCalledTimes(1);
    handle.close();
  });

  it('reconnect 会取消挂起的自动重连定时器', async () => {
    const onMessage = vi.fn();
    const handle = connectSseStream({ url: 'http://x/stream', onMessage, retryDelayMs: 10 });
    await flush();
    MockEventSource.instances[0].fail(); // 定时器挂起
    handle.reconnect();                  // 立即手动重连并清掉定时器
    await flush();
    const before = MockEventSource.instances.length;
    vi.advanceTimersByTime(1000);        // 若定时器未清，这里会再开一条
    await flush();
    expect(MockEventSource.instances.length).toBe(before);
    handle.close();
  });
});
