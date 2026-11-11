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

  it('422 with FastAPI-style detail array → userMessage 含字段路径（PL-08）', async () => {
    const client = getApiClient();
    client.defaults.adapter = errorAdapter(422, {
      detail: [{ loc: ['body', 'x'], msg: 'value is not a valid integer', type: 'int_parsing' }],
    });

    const err = await client.get('/api/x').catch((e) => e);
    expect((err as { userMessage?: string }).userMessage).toBe('body.x: value is not a valid integer');
    expect((err as { errorDetails?: unknown[] }).errorDetails).toHaveLength(1);
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

/**
 * PL-07/PL-08：401/503 不能只在 console.warn，用户要能看到可读提示；
 * 422 归一化不能只取第一条 msg（丢字段路径），要保留全部字段级 detail 供页面拼接。
 */
describe('PL-07/08 用户可见错误与字段级 422', () => {
  beforeEach(() => resetApiClient());
  afterEach(() => resetApiClient());

  it('401 → userMessage 提示检查 API 令牌（不泄漏令牌值）', async () => {
    const client = getApiClient();
    client.defaults.adapter = unauthorizedAdapter;
    const err = await client.get('/api/x').catch((e) => e) as { userMessage?: string };
    expect(err.userMessage).toMatch(/API 令牌/);
    expect(err.userMessage).not.toMatch(/Bearer|token=/i);
  });

  it('503 → userMessage 提示稍后重试', async () => {
    const client = getApiClient();
    client.defaults.adapter = errorAdapter(503, { detail: 'busy' });
    const err = await client.get('/api/x').catch((e) => e) as { userMessage?: string };
    expect(err.userMessage).toMatch(/稍后重试|繁忙|不可用/);
  });

  it('422 多条校验错误 → userMessage 含字段路径，且 errorDetails 保留全部条目', async () => {
    const client = getApiClient();
    client.defaults.adapter = errorAdapter(422, {
      detail: [
        { loc: ['body', 'width'], msg: '必须大于 0', type: 'greater_than' },
        { loc: ['body', 'height'], msg: '必须是整数', type: 'int_parsing' },
        { loc: ['body', 'fps'], msg: '超出范围', type: 'less_than_equal' },
      ],
    });
    const err = await client.get('/api/x').catch((e) => e) as {
      userMessage?: string;
      errorDetails?: Array<{ loc: string[]; msg: string }>;
    };
    expect(err.userMessage).toContain('width');
    expect(err.userMessage).toContain('height');
    expect(err.errorDetails).toHaveLength(3);
    expect(err.errorDetails?.[2]).toMatchObject({ msg: '超出范围' });
  });

  it('422 detail 为对象数组且 msg 非字符串时不抛异常，回落可读文本', async () => {
    const client = getApiClient();
    client.defaults.adapter = errorAdapter(422, {
      detail: [{ loc: ['body'], msg: { nested: 'x' } }],
    });
    const err = await client.get('/api/x').catch((e) => e) as { userMessage?: string };
    expect(typeof err.userMessage).toBe('string');
    expect(err.userMessage?.length).toBeGreaterThan(0);
  });
});
