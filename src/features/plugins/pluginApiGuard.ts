/**
 * PL-01/PL-02：插件声明式 API 调用的**统一授权门禁**。
 *
 * 背景（2026-11-09 代码审计）：`PluginBundleFrame` 的 postMessage `call` 与
 * `usePluginShortcuts` 的 `action` 都把插件提供的 endpoint/method/body 原样交给
 * 带宿主令牌的 `getApiClient()`。iframe 的 `e.source`/origin 校验只防"别的窗口
 * 伪造消息"，并不能限制**沙箱内脚本自己**调用什么——于是插件可以用宿主的
 * `CLIPWRIGHT_API_TOKEN` POST/DELETE 任意 `/api/...`（删项目、改配置等）。
 *
 * 本模块是前端侧的第一道闸（fail-closed）：
 * - 只接受 `/api/` 前缀的**站内绝对路径**；拒绝协议、协议相对 URL、反斜杠、
 *   `..` 穿越、编码绕过、query/fragment、`//` 重复斜杠；
 * - 方法只允许 GET / POST 两种**声明式**动作（UIAction/SlotAction 契约本身
 *   就只有这两种；PUT/DELETE 属于破坏性方法，一律拒绝）；
 * - 端点只在显式白名单内放行；白名单按"具体路径 + 方法"枚举，不支持通配，
 *   新端点必须由宿主版本显式登记（新增插件不能自己扩权）。
 *
 * 注意：**前端白名单不是授权边界**——服务端仍须按插件 manifest 的声明权限、
 * 启停状态与资源归属做最终裁定（后端仓库待配套实现，见实施台账 W01）。
 * 在后端受限代理端点落地之前，这里默认拒绝一切"可写/破坏性"调用。
 */

/** 允许的 HTTP 方法（破坏性方法一律不进这张表）。 */
export type PluginHttpMethod = 'GET' | 'POST';

export interface PluginCallSpec {
  endpoint?: unknown;
  method?: unknown;
  body?: unknown;
}

export interface AuthorizedPluginCall {
  endpoint: string;
  method: PluginHttpMethod;
  body: Record<string, unknown>;
}

export type PluginCallRejection =
  | { ok: false; reason: 'invalid_endpoint' | 'invalid_method' | 'not_allowed' | 'unsafe_path'; message: string };

export type PluginCallDecision =
  | { ok: true; call: AuthorizedPluginCall }
  | PluginCallRejection;

/**
 * 宿主显式登记的"插件可调用端点"白名单。
 *
 * W01 跨仓契约：插件调用统一走**后端受限代理** `/api/plugin/proxy/{pluginId}/{method}`
 * ——服务端按 pluginId 启停状态与允许清单做最终裁定（前端白名单只是防误用）。
 * proxy body 里带 `{ action, payload }`，目标端点由服务端映射，插件不能自报路径。
 *
 * 目前仅保留仓库内置插件实际声明的动作：
 * - `POST /api/tool/execute` → 代理 `POST /api/plugin/proxy/{id}/post` + action=tool
 * - `GET  /api/render/browser` → 代理 `POST /api/plugin/proxy/{id}/get` + action=probe
 *   （代理端点统一 POST；探针 GET 语义由 action=probe 表达）
 *
 * 任何未登记端点（含 `/api/project/*`、`/api/settings/*`）默认拒绝。
 */
export const PLUGIN_ALLOWED_ENDPOINTS: Readonly<Record<string, readonly PluginHttpMethod[]>> = {
  '/api/tool/execute': ['POST'],
  '/api/render/browser': ['GET'],
  '/api/render/browser/install': ['POST'],
};

/** 原始（未代理）目标端点 → 代理 action 映射。 */
export const PLUGIN_PROXY_ACTIONS: Readonly<Record<string, string>> = {
  '/api/tool/execute': 'tool',
  '/api/render/browser': 'probe',
  '/api/render/browser/install': 'install',
};

/**
 * C4：旧版 `ui.json` 的按钮 body 用 `{tool: "..."}`，而 `/api/tool/execute`
 * 契约是 `{name, params}`。只在这里做一次性兼容映射（并告警），不把 `tool`
 * 写回代理 payload，也不静默接受其它任意字段。
 */
let toolDeprecationWarned = false;
function resolveToolName(body: Record<string, unknown>): unknown {
  const name = body.name;
  if (name !== undefined && name !== null && name !== '') return name;
  const tool = body.tool;
  if (tool === undefined || tool === null || tool === '') return name ?? '';
  if (!toolDeprecationWarned) {
    toolDeprecationWarned = true;
    // eslint-disable-next-line no-console
    console.warn('[plugin] 旧版 ui.json 使用 body.tool（已废弃），请改用 body.name；本次已兼容映射为 name。');
  }
  return tool;
}

/** 把授权后的调用改写为受限代理请求（服务端最终裁定）。
 *  `contributionId`（可选）写入 proxy.body 顶层，供后端核对 (ui_slot,id) 归属。 */
export function toPluginProxyRequest(
  pluginId: string, call: AuthorizedPluginCall, contributionId?: string,
): { url: string; body: Record<string, unknown> } {
  const action = PLUGIN_PROXY_ACTIONS[call.endpoint] ?? '';
  const methodPart = call.method === 'GET' ? 'get' : 'post';
  // 工具执行：显式 params 优先；旧 ui.json 把字段平铺在 body 顶层（如 tone/speed），
  // 除 name 外一律收进 params，保持旧按钮可用且不改变代理契约。
  let payload: Record<string, unknown> = call.body;
  if (call.endpoint === '/api/tool/execute') {
    const raw = (call.body ?? {}) as Record<string, unknown>;
    const explicit = raw.params;
    const rest = Object.fromEntries(
      Object.entries(raw).filter(([k]) => k !== 'name' && k !== 'params' && k !== 'tool'),
    );
    payload = {
      name: resolveToolName(call.body),
      params: explicit && typeof explicit === 'object' && !Array.isArray(explicit)
        ? { ...rest, ...(explicit as Record<string, unknown>) }
        : rest,
    };
  }
  const body: Record<string, unknown> = { action, payload };
  if (contributionId) body.contribution_id = contributionId;
  return {
    url: `/api/plugin/proxy/${encodeURIComponent(pluginId)}/${methodPart}`,
    body,
  };
}

/** 可写端点：触发前必须由宿主做一次显式用户确认（防止插件静默改状态）。 */
export const PLUGIN_CONFIRM_REQUIRED_ENDPOINTS: readonly string[] = [
  '/api/tool/execute',
];

/** 判定一条端点是否需要用户二次确认；未登记端点返回 false（反正会被拒绝）。 */
export function pluginCallNeedsConfirm(endpoint: string): boolean {
  return PLUGIN_CONFIRM_REQUIRED_ENDPOINTS.includes(normalizePluginEndpoint(endpoint) ?? '');
}

/**
 * 规范化插件提供的端点：只接受 `/api/` 开头的站内绝对路径。
 * 返回 null 表示非法（外链、协议相对、穿越、编码绕过、query/fragment 等）。
 *
 * 用 WHATWG URL 解析兜底（`new URL(x, location.origin)`），再逐段检查：
 * 这样 `%2e%2e`、`/api/a/../b`、`//api/x`、`\\` 都会被识别并拒绝。
 */
export function normalizePluginEndpoint(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > 512) return null;
  // 先挡明显的跨源与协议相对形式（不依赖 URL 解析差异）
  if (!s.startsWith('/') || s.startsWith('//')) return null;
  if (/[\\?#]/.test(s)) return null;
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return null;
  // 逐段拒绝空段（//）、. 与 ..（含百分号编码形式）
  const segments = s.split('/');
  for (let i = 1; i < segments.length; i += 1) {
    const seg = segments[i];
    if (seg === '') return null;
    let decoded = seg;
    try {
      decoded = decodeURIComponent(seg);
    } catch {
      return null;
    }
    if (decoded === '.' || decoded === '..' || decoded.includes('/') || decoded.includes('\\')) return null;
  }
  if (!s.startsWith('/api/')) return null;
  // 二次解码后仍不得出现穿越或协议
  try {
    const twice = decodeURIComponent(s);
    if (twice !== s && (/[\\?#]/.test(twice) || twice.includes('..'))) return null;
  } catch {
    return null;
  }
  return s;
}

/** 校验一条插件 API 调用；失败时返回稳定错误码与可读原因，绝不发起请求。 */
export function authorizePluginCall(spec: PluginCallSpec): PluginCallDecision {
  const endpoint = normalizePluginEndpoint(spec.endpoint);
  if (!endpoint) {
    return {
      ok: false,
      reason: 'invalid_endpoint',
      message: '插件 API 调用被拒绝：端点必须是 /api/ 开头的站内绝对路径',
    };
  }

  const method = String(spec.method ?? 'POST').toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    return {
      ok: false,
      reason: 'invalid_method',
      message: `插件 API 调用被拒绝：不允许方法 ${method}（仅 GET/POST）`,
    };
  }

  const allowed = PLUGIN_ALLOWED_ENDPOINTS[endpoint];
  if (!allowed || !allowed.includes(method as PluginHttpMethod)) {
    return {
      ok: false,
      reason: 'not_allowed',
      message: `插件 API 调用被拒绝：端点 ${endpoint} 的 ${method} 未在宿主白名单中登记`,
    };
  }

  const body = spec.body;
  const safeBody: Record<string, unknown> =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  return { ok: true, call: { endpoint, method: method as PluginHttpMethod, body: safeBody } };
}
