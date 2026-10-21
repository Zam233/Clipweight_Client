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

export function TaskArtifacts({ taskId, enabled = true }: Props) {
  const navigate = useNavigate();
  const [snap, setSnap] = useState<ResultSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await taskApi.result(taskId);
        if (!cancelled) setSnap(res);
      } catch {
        if (!cancelled) setSnap(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId, enabled]);

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
        </p>
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
