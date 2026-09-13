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
 * 返回 403，iframe 仅显示空白（宿主不额外放行）。
 */
import { useEffect, useRef } from 'react';
import { getApiClient } from '@/services/api';
import { apiBase } from '@/services/api/sse';

interface BundleMessage {
  type?: string;
  height?: number;
  api?: { endpoint?: string; method?: string; body?: unknown };
}

export function PluginBundleFrame({ pluginId, title }: { pluginId: string; title: string }) {
  const ref = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      // 只接受该 iframe 的消息（防其它窗口伪造）
      if (!ref.current || e.source !== ref.current.contentWindow) return;
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
        req
          .then((res) => ref.current?.contentWindow?.postMessage(
            { type: 'result', ok: true, data: res.data }, '*'))
          .catch((err: unknown) => ref.current?.contentWindow?.postMessage(
            { type: 'result', ok: false, error: String((err as Error)?.message ?? err) }, '*'));
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
      src={`${apiBase()}/api/plugin/${encodeURIComponent(pluginId)}/bundle`}
      className="w-full border border-outline-variant/30 rounded-cw-sm bg-transparent"
      style={{ height: 180 }}
    />
  );
}
