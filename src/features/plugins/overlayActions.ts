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
import { authorizePluginCall } from './pluginApiGuard';

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

/** GET probe 端点，返回原始 JSON（失败抛错，由调用方静默处理）。
 *  PL-01：插件声明的 probe 端点同样先过宿主白名单，非法即抛错不发请求。 */
export async function probeEndpoint(endpoint: string): Promise<Json> {
  const decision = authorizePluginCall({ endpoint, method: 'GET' });
  if (!decision.ok) throw new Error(decision.message);
  const { data } = await getApiClient().get(decision.call.endpoint);
  return asRecord(data);
}

/** 触发安装：默认 POST，可声明 PUT/DELETE（破坏性方法一律被门禁拒绝）。 */
export async function triggerEndpoint(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST',
): Promise<Json> {
  const decision = authorizePluginCall({ endpoint, method });
  if (!decision.ok) throw new Error(decision.message);
  const safe = decision.call;
  const client = getApiClient();
  const { data } = safe.method === 'GET'
    ? await client.get(safe.endpoint)
    : await client.post(safe.endpoint, safe.body);
  return asRecord(data);
}
