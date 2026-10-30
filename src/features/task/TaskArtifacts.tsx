/**
 * 任务产物 / 落成项目（收口批次）。
 *
 * 解决的是产品闭环：任务是「出片」，编辑器是「继续剪」。中间必须有一步显式的
 * 「落成项目」，否则用户拿到 timeline 却没地方打开。
 *
 * 诚实的三种状态：
 * - 还没产物（未跑/未到出片步）→ 明说没有可编辑时间线，不给假按钮；
 * - 有产物 → 显示轨道/片段/时长，并可「在编辑器中打开」；
 * - 落项目失败 → 把后端原因（409 等）原样显示，不吞。
 */

import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { FolderOpen, Film } from 'lucide-react';

import { Button } from '@/components/ui';
import { taskApi } from '@/services/api/task';

import { durationText } from './labels';

interface Props {
  taskId: string;
  /** 只在任务结束后拉一次，避免无谓请求 */
  enabled?: boolean;
}

interface ResultSnapshot {
  has_timeline: boolean;
  tracks: number;
  clips: number;
  duration_sec: number;
  output_path: string;
}

/**
 * 终态后的结果查询要做**有限退避重试**（PRD §5 P1-9 / §7.4）。
 *
 * 现场：后端是「先结束任务、再在 finally 里把时间线同步回项目」，两步之间有个窗口。
 * 旧实现终态后只请求一次 `/result`，恰好落进那个窗口就永久显示"没有可编辑时间线"，
 * 用户只能刷新页面。现在按 1/2/4/8 秒退避重试（最多 5 次），并留一个手动「重新检查」。
 */
const _RETRY_DELAYS = [1000, 2000, 4000, 8000];

export function TaskArtifacts({ taskId, enabled = true }: Props) {
  const navigate = useNavigate();
  const [snap, setSnap] = useState<ResultSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [checking, setChecking] = useState(0);
  const [manualTick, setManualTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const fetchOnce = async (): Promise<ResultSnapshot | null> => {
      try {
        const res = await taskApi.result(taskId);
        if (!cancelled) setSnap(res);
        return res;
      } catch {
        if (!cancelled) setSnap(null);
        return null;
      }
    };

    void (async () => {
      let attempt = 0;
      while (!cancelled) {
        const res = await fetchOnce();
        // 有时间线 → 直接收工；第 5 次仍没有 → 认命（不再无限重试）
        if (res?.has_timeline || attempt >= _RETRY_DELAYS.length) {
          if (!cancelled) setChecking(0);
          return;
        }
        if (!cancelled) setChecking(attempt + 1);
        await new Promise<void>((resolve) => {
          timer = setTimeout(resolve, _RETRY_DELAYS[attempt]);
        });
        attempt += 1;
      }
    })();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [taskId, enabled, manualTick]);

  if (!enabled || !snap) return null;

  const openInEditor = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await taskApi.toProject(taskId);
      navigate({ to: '/editor/$projectId', params: { projectId: res.project_id } });
    } catch (e) {
      const detail = (e as { response?: { data?: { detail?: string } } })?.response?.data?.detail;
      setError(detail || (e instanceof Error ? e.message : String(e)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="space-y-1.5" aria-label="任务产物">
      <h2 className="text-body-sm font-semibold text-on-surface flex items-center gap-1.5">
        <Film className="w-4 h-4" /> 产物
      </h2>
      {snap.has_timeline ? (
        <p className="text-caption text-on-surface-variant">
          {snap.tracks} 条轨道 · {snap.clips} 个片段 · {durationText(snap.duration_sec)}
          {snap.output_path ? ` · ${snap.output_path}` : ''}
        </p>
      ) : (
        <p className="text-caption text-on-surface-variant">
          这条任务还没有可编辑的时间线（管线未产出，或还没执行到出片那一步）。
          <button
            type="button"
            data-testid="artifacts-recheck"
            className="ml-2 underline decoration-dotted hover:text-on-surface"
            onClick={() => setManualTick((n) => n + 1)}
          >
            重新检查
          </button>
        </p>
      )}
      {snap.output_path && (
        // PRD B9：产物路径要能直接复制（后端返回什么就显示什么，不拼接本地路径）
        <div className="flex items-center gap-2 text-caption text-on-surface-variant">
          <span className="font-mono text-caption text-on-surface-variant/70">产物路径</span>
          <code className="min-w-0 flex-1 truncate font-mono text-caption text-on-surface" data-testid="artifact-path">
            {snap.output_path}
          </code>
          <button
            type="button"
            data-testid="artifact-path-copy"
            className="shrink-0 rounded-cw-xs border border-outline-variant/40 px-2 py-0.5 text-caption hover:border-outline cursor-pointer"
            onClick={() => { void navigator.clipboard?.writeText(snap.output_path); }}
          >
            复制
          </button>
        </div>
      )}
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => void openInEditor()} disabled={busy || !snap.has_timeline}>
          <FolderOpen className="w-3.5 h-3.5 mr-1" /> 在编辑器中打开
        </Button>
        <span className="text-caption text-on-surface-variant">
          会新建一个项目，不影响本次任务记录
        </span>
      </div>
      {error && <p className="text-caption text-error">{error}</p>}
    </section>
  );
}
