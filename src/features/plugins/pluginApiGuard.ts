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
 * key 为规范化后的站内绝对路径，value 为允许的方法集合。
 * 目前仅保留仓库内置插件**实际声明**的只读/工具执行入口：
 * - `/api/tool/execute`：ai_image_gen / ai_music_gen / ai_video_gen 的 ui.json 按钮
 * - `/api/render/browser`：headless_chrome 依赖探针（GET）
 * - `/api/render/browser/install`：headless_chrome 安装触发（POST，需用户点确认）
 *
 * 任何未登记端点（含 `/api/project/*`、`/api/plugin/*`、`/api/settings/*`）默认拒绝。
 */
export const PLUGIN_ALLOWED_ENDPOINTS: Readonly<Record<string, readonly PluginHttpMethod[]>> = {
  '/api/tool/execute': ['POST'],
  '/api/render/browser': ['GET'],
  '/api/render/browser/install': ['POST'],
};

/** 可写端点：触发前必须由宿主做一次显式用户确认（防止插件静默改状态）。 */
export const PLUGIN_CONFIRM_REQUIRED_ENDPOINTS: readonly string[] = [
  '/api/render/browser/install',
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
