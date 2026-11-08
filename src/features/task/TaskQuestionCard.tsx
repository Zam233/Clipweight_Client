/**
 * 问题卡：主 agent 主动提问 → 用户回答（PRD §15.7）。
 *
 * 为什么需要它：`ask_user` 让任务进入 `waiting_user`，此时**唯一出路**是回答或取消。
 * 没有这张卡，用户只会看到「等待你的回答」和一条 `question` 事件，无从下手。
 *
 * 纪律：
 * - 问题来源两处：历史 `question` 事件（刷新后可重建）+ `GET /questions?status=pending`（校准）；
 * - 已回答的从待答列表里剔除（`answer` 事件为准），不重复显示；
 * - `deadline_at` 只做**展示**倒计时，超时裁定在后端；到点后禁用输入并提示已失效；
 * - 错误按码分流（409 已回答 / 410 失效 / 400 选项非法），重试沿用同一 `question_id`。
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { HelpCircle } from 'lucide-react';

import { cn } from '@/lib/utils';
import { asText } from '@/lib/render';
import { taskApi } from '@/services/api';
import type { TaskEvent, TaskQuestionItem } from '@/types/task';

import { parseTaskEvent } from './eventSchema';
import { describeApiError } from './taskApiError';

interface Props {
  /** 任务侧：直接调 `/api/task/{id}/answer` */
  taskId?: string;
  /** 需求会话侧：由调用方提供提交实现（M5c 接入） */
  onSubmit?: (ans: { questionId: string; optionId?: string | null; text?: string | null }) => Promise<void>;
  /** 事件流；用于从历史重建问题与已答状态 */
  events?: TaskEvent[];
  /** 直接给待答问题（例如从 /questions 拉回来的），与 events 合并去重 */
  questions?: TaskQuestionItem[];
  /** 标题里"谁在问"：任务侧=主 agent，需求会话=需求 agent（M5c） */
  askerLabel?: string;
  className?: string;
}

function _fmtLeft(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

/** 从事件流重建：所有 question，去掉已经有 answer 的。 */
function fromEvents(events: TaskEvent[]): TaskQuestionItem[] {
  const out: TaskQuestionItem[] = [];
  const answered = new Set<string>();
  for (const e of events) {
    const p = parseTaskEvent(e);
    if (p.kind === 'answer') {
      const qid = String((p.answer?.question_id) || '');
      if (qid) answered.add(qid);
      continue;
    }
    if (p.kind !== 'question') continue;
    const q = p.question || {};
    const qid = String(q.question_id || '');
    if (!qid) continue;
    out.push({
      question_id: qid,
      question: String(q.question || e.message || ''),
      options: q.options,
      allow_free_text: q.allow_free_text,
      default_option_id: q.default_option_id ?? null,
      timeout_sec: q.timeout_sec,
      deadline_at: q.deadline_at,
      context_refs: q.context_refs,
      status: q.status || 'pending',
    });
  }
  return out.filter((q) => !answered.has(q.question_id));
}

export function TaskQuestionCard({ taskId, onSubmit, events = [], questions = [], askerLabel = '主 agent', className }: Props) {
  const [remote, setRemote] = useState<TaskQuestionItem[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState('');
  const [error, setError] = useState<Record<string, string>>({});
  const [answered, setAnswered] = useState<Record<string, string>>({});
  const [now, setNow] = useState(() => Date.now());

  // 刷新后校准：任务侧拉一次 pending（需求会话由 onSubmit 方自己处理）
  const loadRemote = useCallback(async () => {
    if (!taskId) return;
    try {
      const res = await taskApi.questions(taskId, 'pending');
      setRemote(res.items ?? []);
    } catch {
      /* 拉不到就只用事件重建，不打扰 */
    }
  }, [taskId]);

  useEffect(() => { void loadRemote(); }, [loadRemote]);

  // 倒计时：只在有待答问题时走心跳
  const shown = useMemo(() => {
    const byId = new Map<string, TaskQuestionItem>();
    for (const q of fromEvents(events)) byId.set(q.question_id, q);
    for (const q of [...questions, ...remote]) byId.set(q.question_id, { ...byId.get(q.question_id), ...q });
    // 已回答的**保留在列表里**（要显示"已提交"回执）；只是交互被禁用。
    // 从 `answer` 事件重建出来的问题已经在 fromEvents 里被剔除，这里不需要再去一遍。
    return [...byId.values()];
  }, [events, questions, remote, answered]);

  useEffect(() => {
    if (!shown.length) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [shown.length]);

  const submit = async (q: TaskQuestionItem, optionId?: string | null, text?: string | null) => {
    const qid = q.question_id;
    const body = {
      questionId: qid,
      optionId: optionId ?? null,
      text: (text ?? '').trim() || null,
    };
    if (!body.optionId && !body.text) {
      setError((e) => ({ ...e, [qid]: '请选择一项，或填写自由文本' }));
      return;
    }
    setBusy(qid);
    setError((e) => { const n = { ...e }; delete n[qid]; return n; });
    try {
      if (onSubmit) {
        await onSubmit(body);
      } else if (taskId) {
        await taskApi.answer(taskId, body);
      }
      setAnswered((a) => ({ ...a, [qid]: body.optionId || body.text || '已提交' }));
      setDraft((d) => ({ ...d, [qid]: '' }));
    } catch (e) {
      const f = describeApiError(e);
      if (f.reason === 'already_answered') {
        setAnswered((a) => ({ ...a, [qid]: '已回答' }));
      } else if (f.reason === 'question_expired' || f.status === 410) {
        setError((x) => ({ ...x, [qid]: '该问题已失效（超时或服务重启），请让主 agent 重新提问' }));
      } else {
        setError((x) => ({ ...x, [qid]: f.message }));
      }
    } finally {
      setBusy('');
    }
  };

  if (!shown.length) return null;

  return (
    <section
      className={cn('border-b border-outline-variant/20 px-3 py-2', className)}
      data-testid="task-question-card"
      aria-label="待回答的问题"
    >
      <p className="mb-1 flex items-center gap-1 text-label-sm text-warning">
        <HelpCircle className="w-3.5 h-3.5" /> {askerLabel} 在等你回答（{shown.length}）
      </p>
      <ul className="space-y-1.5">
        {shown.map((q) => {
          const qid = q.question_id;
          const leftMs = q.deadline_at ? q.deadline_at * 1000 - now : 0;
          const expired = Boolean(q.deadline_at) && leftMs <= 0;
          const done = Boolean(answered[qid]);
          const b = busy === qid;
          const locked = b || expired || done;
          return (
            <li
              key={qid}
              className="rounded-cw-sm bg-surface-container px-2 py-1.5"
              role="group"
              aria-labelledby={`q-${qid}`}
              data-question-id={qid}
              data-question-status={done ? 'answered' : expired ? 'expired' : 'pending'}
              onKeyDown={(e) => {
                const idx = Number(e.key) - 1;
                const opt = q.options?.[idx];
                if (opt && !locked) {
                  e.preventDefault();
                  void submit(q, opt.id, null);
                }
              }}
            >
              <p id={`q-${qid}`} className="text-caption text-on-surface"
                data-testid="task-question-prompt">
                {q.question}
              </p>

              <div className="mt-1 flex flex-wrap items-center gap-1">
                {(q.options ?? []).map((o) => (
                  <button
                    key={o.id}
                    type="button"
                    data-question-option={o.id}
                    disabled={locked}
                    title={o.detail || ''}
                    className="rounded-cw-xs border border-outline-variant/40 px-1.5 py-0.5 text-caption text-primary hover:border-primary disabled:opacity-40"
                    onClick={() => void submit(q, o.id, null)}
                  >
                    {asText(o.label)}
                    {q.default_option_id === o.id && (
                      <span className="ml-1 text-on-surface-variant/60">（超时默认）</span>
                    )}
                  </button>
                ))}
              </div>

              {q.allow_free_text && (
                <div className="mt-1 flex items-center gap-1">
                  <input
                    value={draft[qid] ?? ''}
                    onChange={(e) => setDraft((d) => ({ ...d, [qid]: e.target.value }))}
                    placeholder="或者直接写你的想法…"
                    data-question-free-text={qid}
                    disabled={locked}
                    className="w-full rounded-cw-xs bg-surface-container-high px-1.5 py-0.5 text-caption text-on-surface"
                  />
                  <button
                    type="button"
                    data-question-submit={qid}
                    disabled={locked}
                    className="shrink-0 rounded-cw-xs border border-outline-variant/40 px-1.5 py-0.5 text-caption text-on-surface-variant hover:border-primary disabled:opacity-40"
                    onClick={() => void submit(q, null, draft[qid] ?? '')}
                  >
                    提交
                  </button>
                </div>
              )}

              <p className="mt-1 flex flex-wrap gap-2 text-caption text-on-surface-variant/60">
                {q.deadline_at ? (
                  <span data-question-countdown={qid} aria-live="polite">
                    {expired ? '已超时，等主 agent 重新提问' : `剩余 ${_fmtLeft(leftMs)}`}
                  </span>
                ) : null}
                {q.context_refs && q.context_refs.length > 0 ? (
                  <span title={q.context_refs.join('\n')}>
                    依据 {q.context_refs.length} 项
                  </span>
                ) : null}
              </p>

              {error[qid] && (
                <p className="mt-1 text-caption text-error" role="alert"
                  data-testid="task-question-error" data-question-error={qid}>
                  {error[qid]}
                </p>
              )}
              {answered[qid] && (
                <p className="mt-1 text-caption text-primary" aria-live="polite"
                  data-testid="task-question-receipt" data-question-receipt={qid}>
                  已提交：{answered[qid]}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
