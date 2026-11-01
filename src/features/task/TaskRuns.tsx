/**
 * 子会话列表（PRD modern-agent-review M2）。
 *
 * 主 Agent 派出去的每个阶段子 agent 都是**可寻址的子会话**：能看见它当时的状态、
 * 降级条数、工具轨迹，也能对它「追问」（要求排队到下一次同阶段派发）和「重放」
 * （同样的阶段与 brief 真重跑，不是回放缓存）。旧实现只有一句 summary，
 * 用户想"让那个子 agent 改一下"时无处落脚。
 */

import { useCallback, useEffect, useState } from 'react';
import { MessageSquarePlus, RefreshCw } from 'lucide-react';

import { cn } from '@/lib/utils';
import { asText } from '@/lib/render';
import { taskApi } from '@/services/api';
import type { TaskRunSummary } from '@/types/task';

import { TaskRunDetail } from './TaskRunDetail';
import { describeRunActionError } from './taskApiError';

interface Props {
  taskId: string;
  /** 任务在跑时才允许追问/重放（结束后 run 已不在内存里） */
  active?: boolean;
  className?: string;
}

function statusTone(status: string): string {
  if (status === 'ok') return 'text-primary';
  if (status === 'degraded' || status === 'needs') return 'text-warning';
  if (status === 'failed' || status === 'refused') return 'text-error';
  return 'text-on-surface-variant';
}

export function TaskRuns({ taskId, active = false, className }: Props) {
  const [runs, setRuns] = useState<TaskRunSummary[]>([]);
  /** 逐 run 逐动作的忙碌态：{run_id: 'message' | 'replay'}，不互相阻塞 */
  const [busy, setBusy] = useState<Record<string, 'message' | 'replay'>>({});
  /** 展开详情的 run（同一时刻只展开一个） */
  const [openRun, setOpenRun] = useState('');
  const [note, setNote] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!taskId) return;
    try {
      const res = await taskApi.runs(taskId);
      setRuns(res.items ?? []);
      setError('');
    } catch (e) {
      setError((e as Error)?.message || '子会话读取失败');
    }
  }, [taskId]);

  useEffect(() => { void load(); }, [load]);

  const message = async (run: TaskRunSummary) => {
    const text = (draft[run.run_id] || '').trim();
    if (!text) return;
    setBusy((b) => ({ ...b, [run.run_id]: 'message' }));
    setNote('');
    try {
      const res = await taskApi.runMessage(taskId, run.run_id, text);
      setNote(`已排队 ${res.pending} 条给 ${res.stage}，下次派发时生效`);
      setDraft((d) => ({ ...d, [run.run_id]: '' }));
    } catch (e) {
      setNote(`追问失败：${describeRunActionError(e, 'message').message}`);
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[run.run_id]; return n; });
    }
  };

  const replay = async (run: TaskRunSummary) => {
    setBusy((b) => ({ ...b, [run.run_id]: 'replay' }));
    setNote('');
    try {
      const res = await taskApi.runReplay(taskId, run.run_id);
      // 后端带回本次 run：先就地显示结果，再刷新列表；replayed=true 必须照实说
      setNote(res.replayed
        ? `${res.stage}：服务端返回了回放结果，**未确认发生真实重跑**`
        : `已重跑 ${res.stage}：${res.status}`);
      await load();
    } catch (e) {
      setNote(`重放失败：${describeRunActionError(e, 'replay').message}`);
    } finally {
      setBusy((b) => { const n = { ...b }; delete n[run.run_id]; return n; });
    }
  };

  if (!runs.length && !error) return null;

  return (
    <section className={cn('border-b border-outline-variant/20 px-3 py-2', className)}
      data-testid="task-runs" aria-label="子会话">
      <p className="mb-1 text-label-sm text-on-surface-variant">
        子会话（{runs.length}）
        <span className="ml-2 text-caption text-on-surface-variant/60">
          每次派发都可追问 / 重放
        </span>
      </p>
      {error && <p className="text-caption text-error" data-testid="task-runs-error">{error}</p>}
      <ul className="space-y-1">
        {runs.map((run) => (
          <li key={run.run_id} className="rounded-cw-sm bg-surface-container px-2 py-1.5"
            data-run-id={run.run_id}>
            <div className="flex flex-wrap items-baseline gap-2 text-caption">
              <span className="font-mono text-on-surface">{run.stage || run.role}</span>
              <span className="text-on-surface-variant/60">#{run.attempt}</span>
              <span className={statusTone(run.status)}>{run.status}</span>
              {run.degradations > 0 && (
                <span className="text-warning">降级 {run.degradations}</span>
              )}
              <span className="text-on-surface-variant/60">工具 {run.tool_calls}</span>
              {run.duration_ms > 0 && (
                <span className="text-on-surface-variant/60">
                  {Math.round(run.duration_ms / 100) / 10}s
                </span>
              )}
              {run.replayed && <span className="text-warning/80">回放</span>}
              <span className="ml-auto flex shrink-0 items-center gap-1">
                <input
                  value={draft[run.run_id] ?? ''}
                  onChange={(e) => setDraft((d) => ({ ...d, [run.run_id]: e.target.value }))}
                  placeholder="对它补一句要求…"
                  data-run-message={run.run_id}
                  className="w-44 rounded-cw-xs bg-surface-container-high px-1.5 py-0.5 text-caption text-on-surface"
                />
                <button
                  type="button"
                  data-run-send={run.run_id}
                  disabled={!active || Boolean(busy[run.run_id])}
                  title={active ? '排队到下一次同阶段派发' : '任务已结束，无法追问'}
                  className="rounded-cw-xs border border-outline-variant/40 px-1.5 py-0.5 text-caption text-primary hover:border-primary disabled:opacity-40"
                  onClick={() => void message(run)}
                >
                  <MessageSquarePlus className="inline w-3 h-3" />
                  {busy[run.run_id] === 'message' ? '排队中…' : '追问'}
                </button>
                <button
                  type="button"
                  data-run-replay={run.run_id}
                  disabled={!active || Boolean(busy[run.run_id])}
                  title={active ? '同样的阶段与 brief 真重跑' : '任务已结束，无法重放'}
                  className="rounded-cw-xs border border-outline-variant/40 px-1.5 py-0.5 text-caption text-on-surface-variant hover:border-primary disabled:opacity-40"
                  onClick={() => void replay(run)}
                >
                  <RefreshCw className={cn('inline w-3 h-3',
                    busy[run.run_id] === 'replay' && 'animate-spin')} />
                  {busy[run.run_id] === 'replay' ? '重跑中…' : '重放'}
                </button>
              </span>
            </div>
            {run.summary && (
              <p className="mt-0.5 truncate text-caption text-on-surface-variant/70"
                title={run.summary}>
                {asText(run.summary)}
              </p>
            )}
            <button
              type="button"
              className="mt-0.5 text-caption text-on-surface-variant/70 underline decoration-dotted hover:text-on-surface"
              aria-expanded={openRun === run.run_id}
              data-run-expand={run.run_id}
              onClick={() => setOpenRun((cur) => (cur === run.run_id ? '' : run.run_id))}
            >
              {openRun === run.run_id ? '收起详情' : '查看详情'}
            </button>
            {openRun === run.run_id && (
              <TaskRunDetail taskId={taskId} runId={run.run_id} />
            )}
          </li>
        ))}
      </ul>
      {note && (
        <p className="mt-1 text-caption text-on-surface-variant" data-testid="task-runs-note">
          {note}
        </p>
      )}
    </section>
  );
}
