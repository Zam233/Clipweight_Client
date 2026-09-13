/**
 * M8：受信任 UI bundle 宿主（iframe 沙箱档，默认关闭）。
 *
 * 安全基线（方案 §6 D-4）：
 * - **禁止**直接 `import()` 插件 JS 到宿主上下文（那等于把 XSS 面开在编辑器里）；
 * - 插件界面在 `<iframe sandbox="allow-scripts">` 里运行（无 same-origin，拿不到宿主 DOM/存储）；
 * - 与宿主只通过 postMessage 通信：`ready` / `resize` / `call`（宿主代发 API 请求）/
 *   `result`（宿主回传结果）——插件因此无需也无法持有凭据。
 *
 * 可用性由后端门禁决定：`GET /api/plugin/{id}/bundle` 在未开启该档或缺签名时
 * 返回 403。取档方式（B7）：
 * 1. **带凭据取档**：宿主用自己的 API 客户端拉 HTML（自动附 Authorization），
 *    再以 `srcDoc` 注入沙箱 iframe —— 令牌模式下 iframe 不再必然 403；
 * 2. 回退：`src` 直连端点（开放模式/无令牌时可用）。
 */
import { useEffect, useRef, useState } from 'react';
import { getApiClient } from '@/services/api';
import { apiBase } from '@/services/api/sse';

/** B16：sandbox iframe 的 origin 恒为字符串 'null'（无 same-origin）。 */
const SANDBOX_ORIGIN = 'null';

/**
 * B7：`srcDoc` 注入时响应头 CSP 不再生效，必须在文档内重申同等策略
 * （与后端 `/bundle` 端点一致：只允许内联脚本/样式，禁止外部加载）。
 */
function withCsp(html: string): string {
  const csp = [
    "default-src 'none'",
    "script-src 'unsafe-inline'",
    "style-src 'unsafe-inline'",
    "img-src data: blob:",
    "connect-src 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head([^>]*)>/i, `<head$1>${meta}`);
  return meta + html;
}

interface BundleMessage {
  type?: string;
  height?: number;
  api?: { endpoint?: string; method?: string; body?: unknown };
}

export function PluginBundleFrame({ pluginId, title }: { pluginId: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  const [html, setHtml] = useState<string | null>(null);
  const [denied, setDenied] = useState(false);

  // B7：带 Authorization 取档；失败/空响应 → 回落 src 直连（开放模式可用）
  useEffect(() => {
    let cancelled = false;
    setHtml(null);
    setDenied(false);
    getApiClient()
      .get(`/api/plugin/${encodeURIComponent(pluginId)}/bundle`, { responseType: 'text' })
      .then((res) => {
        if (cancelled) return;
        const body = typeof res.data === 'string' ? res.data : '';
        if (body.trim()) setHtml(withCsp(body));
        else setDenied(true);
      })
      .catch(() => {
        if (!cancelled) setDenied(true);
      });
    return () => { cancelled = true; };
  }, [pluginId]);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // 只接受该 iframe 的消息（防其它窗口伪造）；srcDoc 沙箱的 origin 为 'null'
      if (!ref.current || e.source !== ref.current.contentWindow) return;
      if (e.origin !== SANDBOX_ORIGIN && e.origin !== window.location.origin) return;
      const data = e.data as BundleMessage;
      if (!data || typeof data !== 'object') return;

      if (data.type === 'resize' && typeof data.height === 'number') {
        ref.current.style.height = `${Math.min(720, Math.max(80, Math.floor(data.height)))}px`;
        return;
      }
      if (data.type === 'call' && data.api?.endpoint) {
        const method = String(data.api.method ?? 'POST').toUpperCase();
        const client = getApiClient();
        const req = method === 'GET'
          ? client.get(data.api.endpoint)
          : client.request({ url: data.api.endpoint, method, data: data.api.body ?? {} });
        // B16：目标 origin 只能是沙箱的 'null'——iframe 无 same-origin，'*' 在
        // 此处是唯一可行值；接收侧已按 e.source 严格校验，不引入伪造面。
        const reply = (payload: unknown) =>
          ref.current?.contentWindow?.postMessage(payload, SANDBOX_ORIGIN);
        req
          .then((res) => reply({ type: 'result', ok: true, data: res.data }))
          .catch((err: unknown) => reply({
            type: 'result', ok: false, error: String((err as Error)?.message ?? err),
          }));
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <iframe
      ref={ref}
      title={title}
      data-testid="plugin-bundle-frame"
      sandbox="allow-scripts"
      {...(html
        ? { srcDoc: html }
        : { src: `${apiBase()}/api/plugin/${encodeURIComponent(pluginId)}/bundle` })}
      data-denied={denied ? 'true' : 'false'}
      className="w-full border border-outline-variant/30 rounded-cw-sm bg-transparent"
      style={{ height: 180 }}
    />
  );
}
