/**
 * 单个 run 的详情（PRD §5 P1-1）。
 *
 * 后端 `GET /api/task/{id}/runs/{run_id}` 返回的是一整份 `AgentResult`：
 * brief / outputs / needs / failure / degradations / tool_calls_path。旧界面上
 * 这些字段**一个都看不到**——用户只知道"animation 跑了两次、有一次 degraded"，
 * 不知道它被要求做什么、产出了什么、缺了什么。这一块就是把那次派发摊开。
 *
 * 纪律：
 * - 按「输入要求 → 产出 → 待补 → 失败 → 降级 → 轨迹文件」顺序，空字段显式说"没有记录"；
 * - 不伪造 `agent` 名字（后端 `AgentResult` 没有该字段，就只显示 stage/role）；
 * - 404 给"记录不可用 + 重试"，不把已加载内容清空。
 */

import { useCallback, useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Copy } from 'lucide-react';

import { cn } from '@/lib/utils';
import { taskApi } from '@/services/api';
import type { TaskRunDegradation, TaskRunDetail as RunDetail } from '@/types/task';

import { describeRunActionError } from './taskApiError';

interface Props {
  taskId: string;
  runId: string;
  className?: string;
}

function _str(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 1);
  } catch {
    return String(value);
  }
}

function Section({ title, children, empty }: {
  title: string;
  children?: React.ReactNode;
  empty?: string;
}) {
  return (
    <div className="mt-1.5">
      <p className="text-caption font-medium text-on-surface-variant">{title}</p>
      {children ? (
        <div className="mt-0.5 space-y-0.5 text-caption text-on-surface">{children}</div>
      ) : (
        <p className="mt-0.5 text-caption text-on-surface-variant/60">{empty || '没有记录'}</p>
      )}
    </div>
  );
}

function CopyPath({ path }: { path: string }) {
  if (!path) return null;
  return (
    <button
      type="button"
      title="复制路径"
      data-run-path={path}
      className="mt-0.5 inline-flex items-center gap-1 font-mono text-caption text-on-surface-variant/70 underline decoration-dotted hover:text-on-surface"
      onClick={() => { void navigator.clipboard?.writeText(path); }}
    >
      <Copy className="w-3 h-3" />
      {path.split(/[\\/]/).slice(-2).join('/')}
    </button>
  );
}

function DegradationList({ items }: { items: TaskRunDegradation[] }) {
  if (!items.length) return null;
  return (
    <ul className="space-y-0.5" data-testid="run-detail-degradations">
      {items.map((d, i) => (
        <li key={`${d.kind || 'k'}-${i}`} className="text-caption">
          <span className="mr-1 font-mono text-warning">{d.kind || '未知降级'}</span>
          {d.scope && <span className="text-on-surface-variant/60">{d.scope} </span>}
          {d.detail && <span className="text-on-surface-variant">{d.detail}</span>}
        </li>
      ))}
    </ul>
  );
}

export function TaskRunDetail({ taskId, runId, className }: Props) {
  const [run, setRun] = useState<RunDetail | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(true);

  const load = useCallback(async () => {
    if (!taskId || !runId) return;
    setLoading(true);
    setError('');
    try {
      const res = await taskApi.runDetail(taskId, runId);
      setRun((res.run ?? null) as RunDetail | null);
    } catch (e) {
      const f = describeRunActionError(e, 'detail');
      setError(f.message);
    } finally {
      setLoading(false);
    }
  }, [taskId, runId]);

  useEffect(() => { void load(); }, [load]);

  const brief = String(run?.brief || '');
  const outputs = (run?.outputs || {}) as Record<string, unknown>;
  const needs = (run?.needs || []) as Array<Record<string, unknown>>;
  const failure = (run?.failure || null) as Record<string, unknown> | null;
  const degradations = (run?.degradations || []) as TaskRunDegradation[];
  const callsPath = String(run?.tool_calls_path || '');

  return (
    <div
      className={cn('mt-1 border-t border-outline-variant/20 pt-1', className)}
      data-testid="task-run-detail"
      data-run-id={runId}
    >
      <button
        type="button"
        className="flex w-full items-center gap-1 text-left"
        aria-expanded={open}
        data-testid="run-detail-toggle"
        onClick={() => setOpen((v) => !v)}
      >
        {open ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
        <span className="text-caption text-on-surface">运行详情</span>
        {loading && <span className="text-caption text-on-surface-variant/50">读取中…</span>}
        {run?.status && (
          <span className="text-caption text-on-surface-variant/70">{String(run.status)}</span>
        )}
      </button>

      {error && (
        <p className="mt-1 text-caption text-error" data-testid="run-detail-error">
          {error}
          <button
            type="button"
            className="ml-2 underline decoration-dotted hover:text-on-surface"
            data-testid="run-detail-retry"
            onClick={() => void load()}
          >
            重试加载
          </button>
        </p>
      )}

      {open && run && (
        <div className="rounded-cw-sm bg-surface-container/60 px-2 py-1.5">
          <Section title="输入要求" empty="这次派发没有记录 brief">
            {brief ? <p className="whitespace-pre-wrap break-words">{brief}</p> : undefined}
          </Section>

          <Section title="产出" empty="此运行没有记录产出">
            {Object.keys(outputs).length > 0
              ? Object.entries(outputs).slice(0, 8).map(([k, v]) => (
                <p key={k} className="truncate" title={`${k}: ${_str(v)}`}>
                  <span className="font-mono text-on-surface-variant/70">{k}</span>
                  {' = '}
                  {_str(v).slice(0, 200)}
                </p>
              ))
              : undefined}
          </Section>

          <Section title="待补信息" empty="此运行没有记录待补信息">
            {needs.length > 0
              ? needs.slice(0, 6).map((n, i) => (
                <p key={i} className="truncate" title={_str(n)}>
                  {String(n.key || n.kind || '需要')}
                  {n.reason ? `：${String(n.reason)}` : ''}
                </p>
              ))
              : undefined}
          </Section>

          <Section title="失败原因" empty="这次没有失败">
            {failure ? (
              <>
                <p>{String(failure.category || failure.blocking_point || '失败')}</p>
                {failure.retryable ? (
                  <p className="text-on-surface-variant/70">可重试性：{String(failure.retryable)}</p>
                ) : null}
                {Array.isArray(failure.evidence) && failure.evidence.length > 0 ? (
                  <p className="text-on-surface-variant/70">
                    证据：{(failure.evidence as unknown[]).slice(0, 3).map(_str).join('；')}
                  </p>
                ) : null}
              </>
            ) : undefined}
          </Section>

          <Section title={`降级与处置（${degradations.length}）`} empty="这次没有降级">
            {degradations.length > 0 ? <DegradationList items={degradations} /> : undefined}
          </Section>

          <Section title="完整轨迹文件" empty="这次运行没有落盘轨迹">
            {callsPath ? <CopyPath path={callsPath} /> : undefined}
          </Section>
        </div>
      )}
    </div>
  );
}
