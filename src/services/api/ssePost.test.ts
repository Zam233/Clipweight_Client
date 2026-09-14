// @vitest-environment jsdom
/**
 * POST + fetch 流式 SSE 读取器（`streamPostSse`）。
 *
 * 项目既有 SSE 都是 GET + EventSource；对话消息必须 POST（正文长、带附件），
 * 所以这里手工按帧解析。测试用一个假的 fetch + ReadableStream 喂分片数据。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { streamPostSse } from './ssePost';

function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let i = 0;
  return new ReadableStream({
    pull(controller) {
      if (i >= chunks.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(chunks[i]));
      i += 1;
    },
  });
}

function mockFetch(init: { ok?: boolean; status?: number; chunks?: string[]; body?: string }) {
  return vi.fn(async () => ({
    ok: init.ok ?? true,
    status: init.status ?? 200,
    body: init.chunks ? streamOf(init.chunks) : null,
    text: async () => init.body ?? '',
  })) as unknown as typeof fetch;
}

describe('streamPostSse', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', mockFetch({ chunks: [] }));
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('逐帧解析 data: JSON 行', async () => {
    vi.stubGlobal('fetch', mockFetch({
      chunks: [
        'data: {"type":"delta","text":"你"}\n\n',
        'data: {"type":"delta","text":"好"}\n\ndata: {"type":"done","reply":"你好"}\n\n',
      ],
    }));
    const events: unknown[] = [];
    await streamPostSse('/api/x', { a: 1 }, { onEvent: (e) => events.push(e) });
    expect(events).toEqual([
      { type: 'delta', text: '你' },
      { type: 'delta', text: '好' },
      { type: 'done', reply: '你好' },
    ]);
  });

  it('跨分片拆开的帧也能拼回来', async () => {
    vi.stubGlobal('fetch', mockFetch({
      chunks: ['data: {"type":"del', 'ta","text":"半"}\n', '\ndata: {"type":"done"}\n\n'],
    }));
    const events: { type?: string; text?: string }[] = [];
    await streamPostSse('/api/x', {}, { onEvent: (e) => events.push(e as never) });
    expect(events.map((e) => e.type)).toEqual(['delta', 'done']);
    expect(events[0].text).toBe('半');
  });

  it('忽略心跳/注释行与非 data 行', async () => {
    vi.stubGlobal('fetch', mockFetch({
      chunks: [': keep-alive\n\n', 'event: ping\n\n', 'data: {"type":"done"}\n\n'],
    }));
    const events: unknown[] = [];
    await streamPostSse('/api/x', {}, { onEvent: (e) => events.push(e) });
    expect(events).toEqual([{ type: 'done' }]);
  });

  it('非 JSON 载荷原样透传（不吞掉未知事件）', async () => {
    vi.stubGlobal('fetch', mockFetch({ chunks: ['data: plain-text\n\n'] }));
    const events: unknown[] = [];
    await streamPostSse('/api/x', {}, { onEvent: (e) => events.push(e) });
    expect(events).toEqual(['plain-text']);
  });

  it('非 2xx 抛出响应体文本（SSE 尚未开始时的普通 HTTP 错误）', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: false, status: 400, body: '附件过大' }));
    await expect(streamPostSse('/api/x', {}, { onEvent: () => {} })).rejects.toThrow('附件过大');
  });

  it('没有响应体时抛出明确错误', async () => {
    vi.stubGlobal('fetch', mockFetch({ ok: true }));
    await expect(streamPostSse('/api/x', {}, { onEvent: () => {} })).rejects.toThrow(/可读流|流式读取/);
  });

  it('带上 Authorization 头与 JSON 正文', async () => {
    const spy = mockFetch({ chunks: ['data: {"type":"done"}\n\n'] });
    vi.stubGlobal('fetch', spy);
    const { useSettingsStore } = await import('@/stores/settingsStore');
    useSettingsStore.setState({ authToken: 'tok-123' });
    await streamPostSse('/api/x', { message: 'hi' }, { onEvent: () => {} });
    const [url, init] = (spy as unknown as { mock: { calls: [string, RequestInit][] } }).mock.calls[0];
    // URL 由 API client 的 baseURL 拼接（测试环境 .env / 默认值可能带 host）
    expect(String(url).endsWith('/api/x')).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok-123');
    expect(init.body).toBe(JSON.stringify({ message: 'hi' }));
    useSettingsStore.setState({ authToken: null });
  });

  it('AbortSignal 取消后抛出中止错误', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      const signal = init.signal as AbortSignal;
      signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })) as unknown as typeof fetch);
    const controller = new AbortController();
    const promise = streamPostSse('/api/x', {}, { onEvent: () => {}, signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
