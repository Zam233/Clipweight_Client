/**
 * C4：编辑器插件动作的**统一执行器**。
 *
 * 收敛此前散落在 toolbar / timeline / layout / overlay / shortcut / iframe 的调用：
 * 所有插件自报的 endpoint/method/body 一律先过 `authorizePluginCall` 白名单门禁，
 * 再经 `toPluginProxyRequest` 改写成后端受限代理 `/api/plugin/proxy/{owner}/{get|post}`
 * （proxy.body 顶层带 action / payload / 可选 contribution_id），由服务端按 owner
 * 启停状态、贡献归属与工具权限做最终裁定。
 *
 * 与「直连宿主业务 API」的边界：
 * - owner（贡献归属）缺失即拒绝，绝不发请求（不能从标题/id 猜）；
 * - 非法端点 / 破坏性方法 / 编码穿越由门禁拒绝，绝不发请求；
 * - 写操作（需要确认的端点或非 GET）在发请求前逐次 `window.confirm`，取消即不发请求；
 * - 返回结构化结果（拒绝/取消/成功/失败），调用方据此 toast / 回执，不把 403 当成功。
 */
import { getApiClient } from '@/services/api';
import {
  authorizePluginCall,
  pluginCallNeedsConfirm,
  toPluginProxyRequest,
} from './pluginApiGuard';

export interface PluginActionSpec {
  endpoint?: unknown;
  method?: unknown;
  body?: unknown;
}

export interface ExecutePluginActionOptions {
  /** 贡献 id：写入 proxy.body.contribution_id，供后端核对 (ui_slot, id) 归属。 */
  contributionId?: string;
  /** 强制要求用户确认（用于宿主判定的安装等动作；不会关闭写操作的默认确认）。 */
  requireConfirm?: boolean;
  /** 确认框里展示的可读动作名（缺省用端点）。 */
  label?: string;
}

export type PluginActionResultReason =
  | 'missing_owner'
  | 'invalid_endpoint'
  | 'invalid_method'
  | 'not_allowed'
  | 'unsafe_path'
  | 'cancelled'
  | 'request_failed';

export interface PluginActionResult {
  ok: boolean;
  reason?: PluginActionResultReason;
  message?: string;
  data?: unknown;
}

/** 从后端错误里取一条可读信息，不把整个响应对象塞给界面。 */
function readableError(err: unknown): string {
  const e = err as {
    response?: { data?: { detail?: unknown } };
    userMessage?: string;
    message?: string;
  } | null;
  const detail = e?.response?.data?.detail;
  if (typeof detail === 'string' && detail.trim()) return detail;
  if (typeof e?.userMessage === 'string' && e.userMessage.trim()) return e.userMessage;
  if (typeof e?.message === 'string' && e.message.trim()) return e.message;
  return '插件动作执行失败（后端不可达或被拒绝）';
}

/**
 * 执行一条插件动作。任何被拒绝的路径都返回 `ok:false` 且**不发起网络请求**。
 */
export async function executePluginAction(
  owner: string,
  spec: PluginActionSpec,
  options: ExecutePluginActionOptions = {},
): Promise<PluginActionResult> {
  // C4 / B6：owner 是后端 contributions 里的插件归属，缺它就无法做服务端授权裁定。
  const ownerId = typeof owner === 'string' ? owner.trim() : '';
  if (!ownerId) {
    return {
      ok: false,
      reason: 'missing_owner',
      message: '插件动作缺少贡献归属（owner），已拒绝执行',
    };
  }

  // 门禁：端点形状 / 方法 / 白名单一次性校验（含编码穿越、DELETE/PUT 拒绝）。
  const decision = authorizePluginCall(spec);
  if (!decision.ok) {
    return { ok: false, reason: decision.reason, message: decision.message };
  }
  const { endpoint, method } = decision.call;

  // 写操作在真正发请求前逐次确认；`requireConfirm` 只可加强，不可关闭默认确认。
  const mustConfirm =
    options.requireConfirm === true ||
    pluginCallNeedsConfirm(endpoint) ||
    method !== 'GET';
  if (mustConfirm) {
    const label = options.label || endpoint;
    const confirmed =
      typeof window !== 'undefined' && typeof window.confirm === 'function'
        ? window.confirm(`插件「${label}」请求执行操作：${endpoint}\n是否继续？`)
        : false;
    if (!confirmed) {
      return { ok: false, reason: 'cancelled', message: '用户取消，未发起请求' };
    }
  }

  // 统一走后端受限代理：URL 尾段 get/post 表达语义，HTTP 一律 POST（见 W01 契约）。
  const proxy = toPluginProxyRequest(ownerId, decision.call, options.contributionId);
  try {
    const res = await getApiClient().post(proxy.url, proxy.body);
    return { ok: true, data: res?.data };
  } catch (err) {
    return { ok: false, reason: 'request_failed', message: readableError(err) };
  }
}

/**
 * 编辑器工具栏 / 时间轴 / 浮层共用的「触发 + 失败回执」薄封装。
 * 取消（用户主动）不算失败，不弹错误 toast。
 */
export function runPluginSlotAction(
  owner: string,
  label: string,
  contributionId: string,
  spec: PluginActionSpec,
  onError?: (message: string) => void,
): void {
  void executePluginAction(owner, spec, { contributionId, label }).then((result) => {
    if (!result.ok && result.reason !== 'cancelled') {
      onError?.(result.message ?? '插件动作执行失败');
    }
  });
}
