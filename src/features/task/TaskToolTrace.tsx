/**
 * 全量工具轨迹（PRD modern-agent-review M3）。
 *
 * 为什么要有这一块：主 agent 的工具结果里只带 12 条采样 + 一个落盘路径，
 * 「它到底调了什么」在界面上就一直说不清。这里按阶段读
 * `GET /api/task/{id}/tool-calls`（后端读任务工作区里的
 * `reports/tool_calls/<stage>-<n>.json`），分页把整份轨迹摊开：
 *
 * - 失败先看得到：头部给总数 / 失败数 / 内部操作数；
 * - `source=internal` 是后端内部动作（MG 生成、素材检索、技能调用），以前是黑区，
 *   现在照样列出来并打「内部」标；
 * - 可以切阶段、切第几次尝试，也能「加载更多」往下翻。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ListTree } from 'lucide-react';

import { cn } from '@/lib/utils';
import { asText } from '@/lib/render';
import { taskApi } from '@/services/api';
import type { TaskToolCall, TaskToolCalls } from '@/types/task';

interface Props {
  taskId: string;
  /** 任务终态后不再自动刷新（省请求） */
  active?: boolean;
  /** 初始阶段；留空 = 取最近一次落盘的轨迹 */
  stage?: string;
  /** 每页条数 */
  pageSize?: number;
  className?: string;
}

const PAGE = 200;

function _ok(status?: string): boolean {
  const s = (status || '').toLowerCase();
  return s === 'success' || s === 'ok' || s === '';
}

/** `edit-2` → `edit` / `2`；普通文件名原样返回。 */
function _splitAttempt(key: string): { stage: string; attempt: string } {
  const idx = key.lastIndexOf('-');
  if (idx <= 0) return { stage: key, attempt: '' };
  const tail = key.slice(idx + 1);
  return /^\d+$/.test(tail)
    ? { stage: key.slice(0, idx), attempt: tail }
    : { stage: key, attempt: '' };
}

function TraceRow({ call }: { call: TaskToolCall }) {
  const ok = _ok(call.status);
  const internal = call.source === 'internal';
  return (
    <li
      className="flex items-baseline gap-2 text-caption"
      data-tool-call={call.tool}
      data-status={call.status ?? ''}
      data-internal={internal ? '1' : '0'}
    >
      <span className={cn('w-1.5 shrink-0 self-center h-1.5 rounded-full',
        ok ? 'bg-primary' : 'bg-error')} />
      <span className="w-40 shrink-0 truncate font-mono text-on-surface" title={call.tool}>
        {asText(call.tool)}
      </span>
      <span className={cn('w-16 shrink-0', ok ? 'text-on-surface-variant/70' : 'text-error')}>
        {call.status || 'ok'}
      </span>
      {typeof call.duration_ms === 'number' && call.duration_ms > 0 && (
        <span className="w-16 shrink-0 text-right text-on-surface-variant/50">
          {call.duration_ms}ms
        </span>
      )}
      {internal && (
        <span
          className="shrink-0 rounded-cw-xs bg-surface-container-high px-1 text-on-surface-variant/70"
          title="后端内部动作（非 LLM 主动发起）"
        >
          内部
        </span>
      )}
      {call.args_brief && (
        <span className="min-w-0 truncate text-on-surface-variant/70" title={call.args_brief}>
          {asText(call.args_brief)}
        </span>
      )}
      {call.error && (
        <span className="min-w-0 truncate text-error/80" title={call.error}>
          {asText(call.error)}
        </span>
      )}
    </li>
  );
}

export function TaskToolTrace({
  taskId,
  active = false,
  stage: initialStage = '',
  pageSize = PAGE,
  className,
}: Props) {
  const [stage, setStage] = useState(initialStage);
  const [attempt, setAttempt] = useState(0);
  const [data, setData] = useState<TaskToolCalls | null>(null);
  const [items, setItems] = useState<TaskToolCall[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  /** 请求序号：慢响应回来时若已切阶段/任务，不能再覆盖当前列表 */
  const reqSeq = useRef(0);
  /** 已额外加载的条数：翻了历史页后，后台刷新第一页不能把窗口缩回去 */
  const pagedRef = useRef(0);

  const load = useCallback(
    async (nextStage: string, nextAttempt: number, offset: number) => {
      if (!taskId) return;
      const requestId = ++reqSeq.current;
      setLoading(true);
      setError('');
      try {
        const res = await taskApi.toolCalls(taskId, {
          stage: nextStage || undefined,
          attempt: nextAttempt || undefined,
          limit: pageSize,
          offset,
        });
        if (requestId !== reqSeq.current) return;
        setData(res);
        if (offset > 0) pagedRef.current += res.items.length;
        setItems((prev) => (offset > 0 ? [...prev, ...res.items] : res.items));
      } catch (e) {
        if (requestId !== reqSeq.current) return;
        setError((e as Error)?.message || '轨迹读取失败');
        if (offset === 0) {
          setData(null);
          setItems([]);
        }
      } finally {
        if (requestId === reqSeq.current) setLoading(false);
      }
    },
    [taskId, pageSize],
  );

  useEffect(() => {
    reqSeq.current += 1;
    pagedRef.current = 0;
    setItems([]);
    setData(null);
    if (!taskId) return;
    void load(stage, attempt, 0);
    // stage / attempt 变化由下面两个 handler 触发，这里只跟 taskId 走
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, load]);

  // 任务在跑时每 10s 刷新第一页（轨迹文件是每次尝试写一次，不需要更密）
  useEffect(() => {
    if (!active || !taskId) return;
    const timer = setInterval(() => {
      if (pagedRef.current > 0) return;   // 用户已经往后翻，不打断当前窗口
      void load(stage, attempt, 0);
    }, 10_000);
    return () => clearInterval(timer);
  }, [active, taskId, stage, attempt, load]);

  const stages = useMemo(() => {
    const seen = new Map<string, number[]>();
    for (const key of data?.available ?? []) {
      const { stage: s, attempt: a } = _splitAttempt(key);
      const list = seen.get(s) ?? [];
      if (a) list.push(Number(a));
      seen.set(s, list);
    }
    return [...seen.entries()].map(([s, nums]) => ({
      stage: s,
      attempts: nums.sort((x, y) => x - y),
    }));
  }, [data?.available]);

  const pick = (nextStage: string, nextAttempt: number) => {
    reqSeq.current += 1;   // 作废仍在飞的旧阶段请求
    pagedRef.current = 0;
    setStage(nextStage);
    setAttempt(nextAttempt);
    setItems([]);
    void load(nextStage, nextAttempt, 0);
  };

  // 没有轨迹文件时整块不占版面（单个阶段没跑、或老任务没有落盘 transcript）
  if (!error && (data?.total ?? 0) === 0) return null;

  const total = data?.total ?? 0;
  const head = (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 text-left"
      aria-expanded={open}
      data-testid="tool-trace-toggle"
      onClick={() => setOpen((v) => !v)}
    >
      <ChevronRight
        className={cn('w-3.5 h-3.5 text-on-surface-variant transition-transform',
          open && 'rotate-90')}
      />
      <ListTree className="w-3.5 h-3.5 text-on-surface-variant" />
      <span className="text-label-sm text-on-surface">全量工具轨迹</span>
      {data && (
        <span className="text-caption text-on-surface-variant/70" data-testid="tool-trace-stats">
          共 {total} 次
          {data.failed > 0 && <span className="text-error">（失败 {data.failed}）</span>}
          {data.internal > 0 && <span>（内部 {data.internal}）</span>}
          {data.attempt > 0 && <span>· 第 {data.attempt} 次尝试</span>}
        </span>
      )}
      {loading && <span className="text-caption text-on-surface-variant/50">读取中…</span>}
    </button>
  );

  return (
    <div
      className={cn('border-b border-outline-variant/20 px-3 py-2', className)}
      data-testid="tool-trace"
      data-stage={data?.stage ?? stage}
      data-path={data?.path ?? ''}
    >
      {head}
      {error && (
        <p className="mt-1 text-caption text-error" data-testid="tool-trace-error">
          {error}
        </p>
      )}
      {open && data && (
        <>
          {stages.length > 1 && (
            <div className="mt-1 flex flex-wrap gap-1" data-testid="tool-trace-stages">
              {stages.map((s) =>
                s.attempts.map((a) => (
                  <button
                    key={`${s.stage}-${a}`}
                    type="button"
                    data-stage-pick={`${s.stage}-${a}`}
                    onClick={() => pick(s.stage, a)}
                    className={cn(
                      'rounded-cw-xs px-1.5 py-0.5 text-caption',
                      s.stage === data.stage && a === data.attempt
                        ? 'bg-primary/15 text-primary'
                        : 'bg-surface-container text-on-surface-variant hover:text-on-surface',
                    )}
                  >
                    {s.stage}·{a}
                  </button>
                )),
              )}
            </div>
          )}
          {data.path && (
            <button
              type="button"
              title="复制轨迹文件路径"
              className="mt-1 block max-w-full truncate font-mono text-caption text-on-surface-variant/50 underline decoration-dotted hover:text-on-surface"
              onClick={() => { void navigator.clipboard?.writeText(data.path); }}
            >
              {data.path}
            </button>
          )}
          {items.length === 0 ? (
            <p className="mt-1 text-caption text-on-surface-variant/70">这份轨迹是空的。</p>
          ) : (
            <ul className="mt-1 space-y-0.5" aria-label="全量工具调用">
              {items.map((call, i) => (
                <TraceRow key={`${i}-${call.tool}`} call={call} />
              ))}
            </ul>
          )}
          {items.length < total && (
            <button
              type="button"
              data-testid="tool-trace-more"
              disabled={loading}
              className="mt-1 rounded-cw-xs border border-outline-variant/40 px-2 py-0.5 text-caption text-primary hover:border-primary disabled:opacity-50"
              onClick={() => void load(data.stage, data.attempt, items.length)}
            >
              加载更多（还有 {total - items.length} 次）
            </button>
          )}
        </>
      )}
    </div>
  );
}
