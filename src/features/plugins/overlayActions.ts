/**
 * 插件浮层的通用后端动作通道。
 *
 * 定位：`app.overlay` 的贡献是**声明式**的（probe 端点 + install 端点 + 文案），
 * 插件不提供任何前端代码。这里只做两件最普通的事——按端点 GET 探状态、
 * 按端点 POST 触发安装——渲染层据此决定弹不弹框。
 *
 * C4：不再直连宿主业务 API。probe/trigger 统一走 `executePluginAction`
 * 的受限代理（服务端按 owner 启停 + 贡献归属 + 工具权限最终裁定），
 * 但仍保留 `authorizePluginCall` 的前置白名单校验（fail-closed）。
 * `owner` 由调用方从贡献里给出；缺失即拒绝且零请求。
 *
 * 单独成模块是为了让测试只 mock 这两个函数，而不是整条 axios 客户端。
 */
import { authorizePluginCall } from './pluginApiGuard';
import { executePluginAction } from './executePluginAction';

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

/**
 * GET probe 端点，返回原始 JSON（失败抛错，由调用方静默处理）。
 * PL-01：插件声明的 probe 端点先过宿主白名单，非法即抛错不发请求。
 * C4：owner 缺失 / 代理失败均为可读错误，绝不回退到直连。
 */
export async function probeEndpoint(endpoint: string, owner = '', contributionId = ''): Promise<Json> {
  const decision = authorizePluginCall({ endpoint, method: 'GET' });
  if (!decision.ok) throw new Error(decision.message);
  const result = await executePluginAction(owner, { endpoint, method: 'GET' }, {
    contributionId,
  });
  if (!result.ok) throw new Error(result.message ?? '探针请求失败');
  return asRecord(result.data);
}

/**
 * 触发安装：默认 POST（破坏性方法一律被门禁拒绝）。
 * C4：安装是写操作；用户点“立即安装”本身已是确认，`confirmHandled` 避免二次原生框。
 * 取消返回 `cancelled` 结果，调用方据此显示“已取消”而不是“安装失败”。
 */
export async function triggerEndpoint(
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'POST',
  owner = '',
  contributionId = '',
): Promise<Json> {
  const decision = authorizePluginCall({ endpoint, method });
  if (!decision.ok) throw new Error(decision.message);
  const result = await executePluginAction(owner, { endpoint, method }, {
    contributionId,
    label: '安装依赖',
    confirmHandled: true,
  });
  if (!result.ok) {
    return {
      ok: false,
      cancelled: result.reason === 'cancelled',
      message: result.message ?? '安装请求失败',
    };
  }
  return asRecord(result.data);
}
