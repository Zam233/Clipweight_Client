/**
 * 前端崩溃上报（诊断用，2026-10-31）。
 *
 * 背景：用户连报两次 `Objects are not valid as a React child (found: object with keys
 * {name})`，但只贴得出那一行 message —— 没有组件栈就没法定位，而"请把控制台复制给我"
 * 既不可靠也不该是排障的前提。
 *
 * 做法：崩溃发生时由浏览器自己 POST 到 `/api/diagnostics/client-error`，后端落到
 * `logs/client-errors.jsonl`。开发与生产都能用；上报失败一律静默（上报本身绝不能
 * 引发新的崩溃或阻塞渲染）。
 *
 * 三处入口都在这里：ErrorBoundary（渲染崩溃）、window.onerror（其他同步异常）、
 * unhandledrejection（未处理的 Promise）。
 */

import { useSettingsStore } from '@/stores/settingsStore';

export interface CrashPayload {
  route?: string;
  name?: string;
  message?: string;
  stack?: string;
  componentStack?: string;
  source?: 'boundary' | 'window' | 'unhandledrejection' | 'stuck';
  extra?: unknown;
}

const PATH = '/api/diagnostics/client-error';

/** 与 API 客户端同源策略：配置了后端地址就跟它走，否则同源（开发走 vite proxy）。 */
function endpoint(): string {
  try {
    const base = useSettingsStore.getState().apiBaseUrl || '';
    return `${base}${PATH}`;
  } catch {
    return PATH;
  }
}
/** 同一条崩溃（message 相同）在 10s 内只报一次，防止渲染循环把日志刷爆。 */
const DEDUPE_MS = 10_000;
const _recent = new Map<string, number>();

function shouldSend(key: string): boolean {
  const now = Date.now();
  const last = _recent.get(key) ?? 0;
  if (now - last < DEDUPE_MS) return false;
  _recent.set(key, now);
  // 键表本身防膨胀
  if (_recent.size > 50) {
    const cutoff = now - DEDUPE_MS;
    for (const [k, t] of _recent) if (t < cutoff) _recent.delete(k);
  }
  return true;
}

export function reportCrash(payload: CrashPayload): void {
  try {
    const route = payload.route ?? `${window.location.pathname}${window.location.search}`;
    const message = payload.message ?? '';
    if (!shouldSend(`${payload.source ?? 'boundary'}:${message}`)) return;

    let extra = '';
    if (payload.extra !== undefined) {
      try {
        extra = typeof payload.extra === 'string' ? payload.extra : JSON.stringify(payload.extra);
      } catch {
        extra = '';
      }
    }

    const body = JSON.stringify({
      route,
      name: payload.name ?? '',
      message,
      stack: payload.stack ?? '',
      componentStack: payload.componentStack ?? '',
      source: payload.source ?? 'boundary',
      ua: navigator.userAgent,
      extra,
    });

    // sendBeacon 在页面即将卸载/白屏时也能发出去；不支持时退回 fetch(keepalive)。
    const url = endpoint();
    const blob = new Blob([body], { type: 'application/json' });
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, blob)) return;
    void fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => { /* 上报失败静默 */ });
  } catch { /* 上报永远不许抛出 */ }
}

/** 装上 window 级兜底（root 之外的异常也要留痕）。只装一次。 */
export function installGlobalCrashReporter(): void {
  if ((window as { __cwCrashReporter?: boolean }).__cwCrashReporter) return;
  (window as { __cwCrashReporter?: boolean }).__cwCrashReporter = true;

  window.addEventListener('error', (ev) => {
    const err = ev.error instanceof Error ? ev.error : null;
    reportCrash({
      source: 'window',
      name: err?.name ?? 'Error',
      message: err?.message || String(ev.message || ''),
      stack: err?.stack ?? '',
      extra: typeof ev.filename === 'string' && ev.filename
        ? `${ev.filename}:${ev.lineno}:${ev.colno}`
        : '',
    });
  });

  window.addEventListener('unhandledrejection', (ev) => {
    const reason = ev.reason;
    const err = reason instanceof Error ? reason : null;
    reportCrash({
      source: 'unhandledrejection',
      name: err?.name ?? 'UnhandledRejection',
      message: err?.message || (typeof reason === 'string' ? reason : safeJson(reason)),
      stack: err?.stack ?? '',
    });
  });
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}
