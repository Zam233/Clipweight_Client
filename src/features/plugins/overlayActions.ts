/**
 * 插件浮层的通用后端动作通道。
 *
 * 定位：`app.overlay` 的贡献是**声明式**的（probe 端点 + install 端点 + 文案），
 * 插件不提供任何前端代码。这里只做两件最普通的事——按端点 GET 探状态、
 * 按端点 POST 触发安装——渲染层据此决定弹不弹框。
 *
 * 单独成模块是为了让测试只 mock 这两个函数，而不是整条 axios 客户端。
 */
import { getApiClient } from '@/services/api/client';

export type Json = Record<string, unknown>;

/** 按路径逐层取值（`headless_shell.version` 这种），取不到返回 undefined。 */
export function pickPath(obj: unknown, path: string | undefined): unknown {
  if (!path) return obj;
  return path
    .split('.')
    .filter(Boolean)
    .reduce<unknown>(
      (acc, key) => (acc && typeof acc === 'object' ? (acc as Json)[key] : undefined),
      obj,
    );
}

export function asRecord(value: unknown): Json {
  return value && typeof value === 'object' ? (value as Json) : {};
}

/** GET probe 端点，返回原始 JSON（失败抛错，由调用方静默处理）。 */
export async function probeEndpoint(endpoint: string): Promise<Json> {
  const { data } = await getApiClient().get(endpoint);
  return asRecord(data);
}

/** 触发安装：默认 POST，可声明 PUT/DELETE。 */
export async function triggerEndpoint(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST',
): Promise<Json> {
  const client = getApiClient();
  const { data } =
    method === 'GET'
      ? await client.get(endpoint)
      : method === 'PUT'
        ? await client.put(endpoint)
        : method === 'DELETE'
          ? await client.delete(endpoint)
          : await client.post(endpoint);
  return asRecord(data);
}
