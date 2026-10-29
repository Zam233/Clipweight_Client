/**
 * `app.overlay` 的「可安装依赖」通用钩子。
 *
 * 插件在贡献里声明（后端 `ui_slot` 贡献的 payload）：
 * ```json
 * {
 *   "kind": "installable-dependency",
 *   "probe":   {"endpoint": "/api/x", "path": "dep", "installedField": "installed"},
 *   "install": {"endpoint": "/api/x/install", "method": "POST", "pollMs": 2000},
 *   "copy":    {"title": "...", "why": "...", "benefit": "...", ...}
 * }
 * ```
 * 宿主只按这份声明行事：探状态 → 缺就弹框 → 点安装 → 轮询到装好。
 * **不认识任何具体依赖**（chrome / ffmpeg / 模型权重都一样能跑）。
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { asRecord, pickPath, probeEndpoint, triggerEndpoint } from './overlayActions';
import type { SlotContribution } from './slots';

export interface InstallableDependencyPayload {
  kind: 'installable-dependency';
  /**
   * 一次性提示（用户 2026-10-29：「不要任何界面都弹，启动一次后端只弹一次」）。
   * - `scope: 'backend-boot'`：以 probe 响应里的 `bootIdField` 为去重键，
   *   同一后端进程只自动弹一次（localStorage 记已提示），刷新页面不重弹，
   *   后端重启后 boot_id 变化才重新提示一次；
   * - 不声明 = 每次挂载都按缺失状态决定（插件自己负责收敛频率）。
   */
  once?: { scope?: 'backend-boot'; bootIdField?: string };
  probe: {
    endpoint: string;
    path?: string;
    installedField?: string;
    installingField?: string;
    versionField?: string;
    resultField?: string;
  };
  install: { endpoint: string; method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; pollMs?: number };
  copy?: {
    title?: string;
    why?: string;
    benefit?: string;
    installLabel?: string;
    retryLabel?: string;
    laterLabel?: string;
    installingLabel?: string;
    successTitle?: string;
    successBody?: string;
  };
}

export interface DependencyState {
  loaded: boolean;
  installed: boolean;
  installing: boolean;
  version: string;
  message: string;
  failed: boolean;
  waitedSec: number;
}

const EMPTY: DependencyState = {
  loaded: false,
  installed: true, // 拿到状态前不弹，避免闪一下
  installing: false,
  version: '',
  message: '',
  failed: false,
  waitedSec: 0,
};

/** 从贡献里取出「可安装依赖」payload；不是这类贡献返回 null。 */
export function readInstallableDependency(
  contribution: SlotContribution,
): InstallableDependencyPayload | null {
  const payload = asRecord(contribution.payload ?? contribution.layout ?? {});
  if (payload.kind !== 'installable-dependency') return null;
  const probe = asRecord(payload.probe);
  const install = asRecord(payload.install);
  const endpoint = typeof probe.endpoint === 'string' ? probe.endpoint : '';
  const installEndpoint = typeof install.endpoint === 'string' ? install.endpoint : '';
  if (!endpoint || !installEndpoint) return null;
  return {
    kind: 'installable-dependency',
    once: payload.once as InstallableDependencyPayload['once'],
    probe: { ...(probe as InstallableDependencyPayload['probe']), endpoint },
    install: { ...(install as InstallableDependencyPayload['install']), endpoint: installEndpoint },
    copy: (payload.copy as InstallableDependencyPayload['copy']) ?? undefined,
  };
}

/** localStorage（跨刷新持久）——一次性提示要去重到「后端进程」级别，不能用 sessionStorage。 */
function onceKey(contributionId: string, bootId: string): string {
  return `cw:overlay-shown:${contributionId}:${bootId}`;
}

function readOnce(contributionId: string, bootId: string): boolean {
  if (!bootId) return false;
  try {
    return localStorage.getItem(onceKey(contributionId, bootId)) === '1';
  } catch {
    return false;
  }
}

function markOnce(contributionId: string, bootId: string): void {
  if (!bootId) return;
  try {
    // 顺手清掉更早启动的键，避免 localStorage 无限增长
    const prefix = `cw:overlay-shown:${contributionId}:`;
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(prefix) && key !== onceKey(contributionId, bootId)) {
        localStorage.removeItem(key);
      }
    }
    localStorage.setItem(onceKey(contributionId, bootId), '1');
  } catch {
    // 隐私模式禁写：退化成「本次渲染提示一次」
  }
}

function snoozeKey(contributionId: string): string {
  return `cw:overlay-snooze:${contributionId}`;
}

function readSnooze(contributionId: string): boolean {
  try {
    return sessionStorage.getItem(snoozeKey(contributionId)) === '1';
  } catch {
    return false;
  }
}

export interface DependencyGate {
  payload: InstallableDependencyPayload;
  state: DependencyState;
  visible: boolean;
  showSuccess: boolean;
  snooze: () => void;
  install: () => Promise<void>;
  dismissSuccess: () => void;
}

export function useInstallableDependency(
  contribution: SlotContribution,
  payload: InstallableDependencyPayload,
): DependencyGate {
  const pollMs = Math.max(500, Number(payload.install.pollMs) || 2000);
  const [state, setState] = useState<DependencyState>(EMPTY);
  const [snoozed, setSnoozed] = useState<boolean>(() => readSnooze(contribution.id));
  const [showSuccess, setShowSuccess] = useState(false);
  // 一次性提示：本次后端启动是否已经自动提示过（跨刷新持久，后端重启才复位）
  const [bootId, setBootId] = useState('');
  const [onceBlocked, setOnceBlocked] = useState(false);
  const alive = useRef(true);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (timer.current) {
      clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const refresh = useCallback(async () => {
    try {
      const raw = await probeEndpoint(payload.probe.endpoint);
      if (!alive.current) return;
      const node = asRecord(pickPath(raw, payload.probe.path));
      const installed = Boolean(node[payload.probe.installedField ?? 'installed']);
      const result = asRecord(node[payload.probe.resultField ?? 'last_result']);
      // 一次性提示去重：boot_id 由 probe 响应顶层给出（声明式，不认具体依赖）
      if (payload.once) {
        const bootField = payload.once.bootIdField ?? 'boot_id';
        const id = String(raw[bootField] ?? '');
        setBootId(id);
        setOnceBlocked(readOnce(contribution.id, id));
      }
      setState((prev) => {
        if (installed && prev.installing) setShowSuccess(true);
        return {
          loaded: true,
          installed,
          installing: Boolean(node[payload.probe.installingField ?? 'installing']),
          version: String(node[payload.probe.versionField ?? 'version'] ?? ''),
          message: String(result.message ?? ''),
          failed: result.ok === false,
          waitedSec: installed ? 0 : prev.waitedSec,
        };
      });
      if (installed) stopPolling();
    } catch {
      // 端点不可达（后端未启动 / 老版本没有该能力）：静默，绝不弹框打断
      if (alive.current) setState((prev) => (prev.loaded ? prev : { ...EMPTY, loaded: true }));
    }
  }, [contribution.id, payload.once, payload.probe, stopPolling]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const visible =
    state.loaded && !state.installed && !snoozed && !onceBlocked;

  // 一旦真的弹出，立刻记「本次后端启动已提示」——刷新/切页都不再自动弹
  useEffect(() => {
    if (!visible || !payload.once || !bootId) return;
    markOnce(contribution.id, bootId);
  }, [visible, payload.once, bootId, contribution.id]);

  // 安装中：轮询 + 计时
  useEffect(() => {
    if (!state.installing || state.installed) {
      stopPolling();
      return;
    }
    if (timer.current) return;
    timer.current = setInterval(() => {
      setState((prev) =>
        prev.installing
          ? { ...prev, waitedSec: prev.waitedSec + Math.max(1, Math.round(pollMs / 1000)) }
          : prev,
      );
      void refresh();
    }, pollMs);
  }, [state.installing, state.installed, pollMs, refresh, stopPolling]);

  const install = useCallback(async () => {
    setState((prev) => ({ ...prev, installing: true, failed: false, message: '', waitedSec: 0 }));
    try {
      const res = await triggerEndpoint(
        payload.install.endpoint,
        payload.install.method ?? 'POST',
      );
      if (res.ok === false) {
        setState((prev) => ({
          ...prev,
          installing: false,
          failed: true,
          message: String(res.message ?? '安装未启动'),
        }));
        return;
      }
    } catch (e) {
      setState((prev) => ({
        ...prev,
        installing: false,
        failed: true,
        message: e instanceof Error ? e.message : '安装请求失败',
      }));
      return;
    }
    await refresh();
  }, [payload.install, refresh]);

  const snooze = useCallback(() => {
    try {
      sessionStorage.setItem(snoozeKey(contribution.id), '1');
    } catch {
      // 隐私模式禁写：仅本次渲染生效
    }
    setSnoozed(true);
  }, [contribution.id]);

  const dismissSuccess = useCallback(() => setShowSuccess(false), []);

  return {
    payload,
    state,
    visible,
    showSuccess,
    snooze,
    install,
    dismissSuccess,
  };
}
