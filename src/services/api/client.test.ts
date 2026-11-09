// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AxiosError, type AxiosAdapter, type AxiosResponse } from 'axios';
import { getApiClient, resetApiClient } from './client';

const unauthorizedAdapter: AxiosAdapter = (config) => {
  const response: AxiosResponse = {
    data: { detail: '登录已失效，请重新登录' },
    status: 401,
    statusText: 'Unauthorized',
    headers: {},
    config,
  };
  const err = new AxiosError(
    'Request failed with status code 401',
    AxiosError.ERR_BAD_REQUEST,
    config,
    null,
    response,
  );
  return Promise.reject(err);
};

describe('getApiClient 401 interceptor', () => {
  beforeEach(() => {
    resetApiClient();
  });

  afterEach(() => {
    resetApiClient();
    vi.restoreAllMocks();
  });

  it('401 → 警告并 reject（账号续期已随账号系统移除）', async () => {
    const client = getApiClient();
    client.defaults.adapter = unauthorizedAdapter;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    await expect(client.get('/api/x')).rejects.toThrow();

    expect(warnSpy).toHaveBeenCalledWith('[API] Unauthorized (401) — 请检查设置中的 API 令牌');
  });
});

function errorAdapter(status: number, data: unknown): AxiosAdapter {
  return (config) => {
    const response: AxiosResponse = {
      data,
      status,
      statusText: String(status),
      headers: {},
      config,
    };
    const err = new AxiosError(
      `Request failed with status code ${status}`,
      AxiosError.ERR_BAD_REQUEST,
      config,
      null,
      response,
    );
    return Promise.reject(err);
  };
}

describe('getApiClient error normalization (userMessage)', () => {
  beforeEach(() => {
    resetApiClient();
  });

  afterEach(() => {
    resetApiClient();
  });

  it('422 with FastAPI-style detail array → userMessage = first msg', async () => {
    const client = getApiClient();
    client.defaults.adapter = errorAdapter(422, {
      detail: [{ loc: ['body', 'x'], msg: 'value is not a valid integer', type: 'int_parsing' }],
    });

    const err = await client.get('/api/x').catch((e) => e);
    expect((err as { userMessage?: string }).userMessage).toBe('value is not a valid integer');
  });

  it('422 with string detail → userMessage = detail', async () => {
    const client = getApiClient();
    client.defaults.adapter = errorAdapter(422, { detail: '无法处理该请求' });

    const err = await client.get('/api/x').catch((e) => e);
    expect((err as { userMessage?: string }).userMessage).toBe('无法处理该请求');
  });

  it('400 with string detail → userMessage = detail', async () => {
    const client = getApiClient();
    client.defaults.adapter = errorAdapter(400, { detail: '格式错误：无法解析文件' });

    const err = await client.get('/api/x').catch((e) => e);
    expect((err as { userMessage?: string }).userMessage).toBe('格式错误：无法解析文件');
  });

  it('500 → no userMessage attached', async () => {
    const client = getApiClient();
    client.defaults.adapter = errorAdapter(500, { detail: 'internal' });

    const err = await client.get('/api/x').catch((e) => e);
    expect((err as { userMessage?: string }).userMessage).toBeUndefined();
  });
});
