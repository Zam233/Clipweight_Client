/**
 * 统一时间线 normalizer（unified-stream PRD §4.4 第 1 层）。
 *
 * 纯函数：**只做字段映射**，不碰状态、不排序、不去重（去重与合并交给 store）。
 *
 * 覆盖要求：`EVENT_TYPE_KEYS` 里 29 种事件都要有归属——要么映射成具体 kind，
 * 要么落到 `log` 兜底。测试用跨仓契约里的类型清单逐个跑一遍，
 * 任何"事件看不见"都会直接红（这比"看起来像有日志"更可靠）。
 */

import { parseTaskEvent } from '@/features/task/eventSchema';
import type { TaskEvent } from '@/types/task';
import type { TimelineItem } from './types';

export const REQ_PREFIX = 'req';
export const TASK_PREFIX = 'task';

function _base(
  source: TimelineItem['source'],
  dedupeKey: string,
  ordinal: number,
  extra: Partial<TimelineItem> = {},
): Pick<TimelineItem, 'key' | 'dedupeKey' | 'source' | 'order' | 'receivedAt'> & Record<string, unknown> {
  return {
    key: dedupeKey,
    dedupeKey,
    source,
    order: { ordinal, ...(extra.order ?? {}) },
    receivedAt: Date.now(),
    ...extra,
  } as never;
}

function _log(taskId: string, e: TaskEvent): TimelineItem {
  return {
    ..._base('task', `${TASK_PREFIX}:evt:${taskId}:${e.seq}`, e.seq, {
      order: { ordinal: e.seq, seq: e.seq }, ts: e.ts, taskId,
    } as never),
    kind: 'log',
    eventType: e.type,
    message: e.message,
    detail: e.detail ?? {},
  } as TimelineItem;
}

/** 工具调用与结果共用同一个 dedupeKey → store 合并成一行（不新增重复行）。 */
function _toolKey(taskId: string, callSeq: number): string {
  return `${TASK_PREFIX}:tool:${taskId}:${callSeq}`;
}

/**
 * 任务事件 → 时间线条目。
 *
 * `tool_result` 通过 `causation_id="seq:<n>"` 找到对应调用；老数据没有该字段时
 * 按工具名 FIFO 兜底（与 `pairToolCalls` 同策略），并在 `sourceTag` 里标明
 * `pair=name`，让"猜的"看得见。
 */
export function normalizeTaskEvent(
  e: TaskEvent,
  taskId: string,
  ctx: { pendingByName?: Map<string, number[]> } = {},
): TimelineItem | null {
  const parsed = parseTaskEvent(e);
  const pending = ctx.pendingByName;

  switch (e.type) {
    case 'tool_call': {
      if (parsed.kind !== 'tool_call') return _log(taskId, e);
      const tool = parsed.tool.tool || e.message || '';
      pending?.set(tool, [...(pending.get(tool) ?? []), e.seq]);
      return {
        ..._base('task', _toolKey(taskId, e.seq), e.seq, {
          order: { ordinal: e.seq, seq: e.seq }, ts: e.ts, taskId,
        } as never),
        kind: 'tool',
        tool,
        origin: parsed.tool.kind === 'skill' ? 'skill' : 'main',
        status: 'running',
        sourceTag: parsed.tool.source,
        deduped: parsed.tool.deduped,
        remainingTurns: parsed.tool.remaining_turns,
      } as TimelineItem;
    }
    case 'tool_result': {
      if (parsed.kind !== 'tool_result') return _log(taskId, e);
      const tool = parsed.tool.tool || e.message || '';
      const causation = String(e.causation_id || '');
      let callSeq: number | undefined;
      let paired = 'causation';
      if (causation.startsWith('seq:')) {
        const n = Number(causation.slice(4));
        if (Number.isFinite(n)) callSeq = n;
      }
      if (callSeq === undefined) {
        const queue = pending?.get(tool) ?? [];
        callSeq = queue.shift();
        paired = 'name';
      }
      if (callSeq === undefined) {
        // 找不到对应调用（极端老数据）：自己成一条，仍然可见
        return {
          ..._base('task', `${TASK_PREFIX}:tool-result:${taskId}:${e.seq}`, e.seq, {
            order: { ordinal: e.seq, seq: e.seq }, ts: e.ts, taskId,
          } as never),
          kind: 'tool',
          tool,
          origin: 'main',
          status: parsed.tool.status ?? 'ok',
          ms: parsed.tool.duration_ms,
          error: parsed.tool.error,
        } as TimelineItem;
      }
      return {
        ..._base('task', _toolKey(taskId, callSeq), callSeq, {
          order: { ordinal: callSeq, seq: callSeq }, ts: e.ts, taskId,
        } as never),
        kind: 'tool',
        tool,
        origin: 'main',
        status: parsed.tool.status ?? 'ok',
        ms: parsed.tool.duration_ms,
        error: parsed.tool.error,
        sourceTag: paired === 'name' ? 'pair=name' : undefined,
      } as TimelineItem;
    }
    case 'subagent_tool': {
      if (parsed.kind !== 'subagent_tool') return _log(taskId, e);
      const origin = parsed.tool.kind === 'skill' ? 'skill' : 'subagent';
      return {
        ..._base('task', `${TASK_PREFIX}:sub:${taskId}:${parsed.tool.run_id || 'run'}:${e.seq}`, e.seq, {
          order: { ordinal: e.seq, seq: e.seq }, ts: e.ts, taskId,
        } as never),
        kind: 'tool',
        tool: parsed.tool.tool || e.message,
        origin,
        status: parsed.tool.status ?? 'ok',
        ms: parsed.tool.duration_ms,
        error: parsed.tool.error,
        agent: parsed.tool.agent,
        stage: parsed.tool.stage,
      } as TimelineItem;
    }
    case 'thinking': {
      if (parsed.kind !== 'thinking') return _log(taskId, e);
      const round = Number((e.detail as Record<string, unknown>)?.round ?? 0);
      // 同一轮思考合并成一条（按轮聚合），text 由 store 追加
      return {
        ..._base('task', `${TASK_PREFIX}:think:${taskId}:${round || e.seq}`, e.seq, {
          order: { ordinal: e.seq, seq: e.seq }, ts: e.ts, taskId,
        } as never),
        kind: 'reasoning',
        phase: 'task',
        text: String(parsed.turn.delta || parsed.turn.text || e.message || ''),
        done: Boolean(parsed.turn.done),
        availability: 'available',
        round: round || undefined,
      } as TimelineItem;
    }
    case 'narration':
    case 'intent': {
      if (parsed.kind !== 'narration' && parsed.kind !== 'intent') return _log(taskId, e);
      return {
        ..._base('task', `${TASK_PREFIX}:say:${taskId}:${e.seq}`, e.seq, {
          order: { ordinal: e.seq, seq: e.seq }, ts: e.ts, taskId,
        } as never),
        kind: 'message',
        role: 'assistant',
        content: e.message,
      } as TimelineItem;
    }
    case 'step_start':
    case 'step_end': {
      if (parsed.kind !== 'step_start' && parsed.kind !== 'step_end') return _log(taskId, e);
      const stage = String((e.detail as Record<string, unknown>)?.stage ?? '');
      return {
        ..._base('task', `${TASK_PREFIX}:stage:${taskId}:${stage || e.seq}`, e.seq, {
          order: { ordinal: e.seq, seq: e.seq }, ts: e.ts, taskId,
        } as never),
        kind: 'stage',
        stage,
        status: e.type === 'step_start' ? 'running' : (parsed.stage.status ?? 'ok'),
        summary: parsed.stage.summary,
      } as TimelineItem;
    }
    case 'progress': {
      if (parsed.kind !== 'progress') return _log(taskId, e);
      const p = parsed.stageProgress;
      return {
        ..._base('task', `${TASK_PREFIX}:progress:${taskId}:${e.seq}`, e.seq, {
          order: { ordinal: e.seq, seq: e.seq }, ts: e.ts, taskId,
        } as never),
        kind: 'stage',
        stage: String(p.stage || ''),
        status: 'progress',
        completed: p.completed,
        total: p.total,
        trigger: p.trigger,
        summary: [p.action, p.conclusion].filter(Boolean).join(' · ') || undefined,
      } as TimelineItem;
    }
    case 'question': {
      if (parsed.kind !== 'question') return _log(taskId, e);
      const q = parsed.question || {};
      const qid = String(q.question_id || '');
      if (!qid) return _log(taskId, e);
      return {
        ..._base('task', `${TASK_PREFIX}:q:${taskId}:${qid}`, e.seq, {
          order: { ordinal: e.seq, seq: e.seq }, ts: e.ts, taskId,
        } as never),
        kind: 'question',
        questionId: qid,
        question: String(q.question || e.message || ''),
        options: q.options,
        allowFreeText: q.allow_free_text,
        deadlineAt: q.deadline_at,
        status: 'pending',
      } as TimelineItem;
    }
    case 'answer': {
      if (parsed.kind !== 'answer') return _log(taskId, e);
      const qid = String(parsed.answer?.question_id || '');
      if (!qid) return _log(taskId, e);
      return {
        ..._base('task', `${TASK_PREFIX}:q:${taskId}:${qid}`, e.seq, {
          order: { ordinal: e.seq, seq: e.seq }, ts: e.ts, taskId,
        } as never),
        kind: 'answer',
        questionId: qid,
        optionId: parsed.answer?.option_id ?? null,
        text: parsed.answer?.text ?? null,
        source: parsed.answer?.source,
      } as TimelineItem;
    }
    case 'approval_request':
    case 'approval_result': {
      if (parsed.kind !== 'approval_request' && parsed.kind !== 'approval_result') {
        return _log(taskId, e);
      }
      return {
        ..._base('task', `${TASK_PREFIX}:appr:${taskId}:${parsed.approval.approval_id || e.seq}`, e.seq, {
          order: { ordinal: e.seq, seq: e.seq }, ts: e.ts, taskId,
        } as never),
        kind: 'approval',
        approvalId: parsed.approval.approval_id,
        risk: parsed.approval.risk,
        tool: parsed.approval.tool,
        status: parsed.approval.status ?? (e.type === 'approval_request' ? 'pending' : 'ok'),
      } as TimelineItem;
    }
    case 'degradation': {
      const d = (e.detail ?? {}) as Record<string, unknown>;
      return {
        ..._base('task', `${TASK_PREFIX}:degr:${taskId}:${e.seq}`, e.seq, {
          order: { ordinal: e.seq, seq: e.seq }, ts: e.ts, taskId,
        } as never),
        kind: 'degradation',
        scope: String(d.scope || e.message || ''),
        impact: d.impact ? String(d.impact) : undefined,
        detail: d.detail ? String(d.detail) : undefined,
      } as TimelineItem;
    }
    case 'artifact':
    case 'doc_write':
    case 'report': {
      const d = (e.detail ?? {}) as Record<string, unknown>;
      const path = d.path ? String(d.path) : undefined;
      const label = String(d.label || d.name || path?.split(/[\\/]/).pop() || e.message || '产物');
      return {
        ..._base('task', `${TASK_PREFIX}:art:${taskId}:${path || e.seq}`, e.seq, {
          order: { ordinal: e.seq, seq: e.seq }, ts: e.ts, taskId,
        } as never),
        kind: 'artifact',
        label,
        path,
        chars: typeof d.chars === 'number' ? d.chars : undefined,
        files: Array.isArray(d.files) ? (d.files as string[]).map(String) : undefined,
      } as TimelineItem;
    }
    case 'task_end': {
      const d = (e.detail ?? {}) as Record<string, unknown>;
      return {
        ..._base('task', `${TASK_PREFIX}:end:${taskId}`, e.seq, {
          order: { ordinal: e.seq, seq: e.seq }, ts: e.ts, taskId,
        } as never),
        kind: 'task-end',
        status: String(d.status || 'done'),
        reason: d.reason ? String(d.reason) : undefined,
        conclusion: d.conclusion ? String(d.conclusion) : e.message,
        completed: Array.isArray(d.completed) ? (d.completed as string[]) : [],
        unfinished: Array.isArray(d.unfinished) ? (d.unfinished as string[]) : [],
      } as TimelineItem;
    }
    default:
      // 其余事件（plan/replan/artifact/gate_hit/checkpoint/inject/report/doc_write/
      // context_loaded/agent_run_*/subagent_progress/task_start…）一律 log 兜底：
      // 分门别类展示可以后续再加，但**绝不丢**。
      return _log(taskId, e);
  }
}

/** 需求会话消息 → 时间线条目（`ordinal` 用消息下标，稳定且不受时钟影响）。 */
export function normalizeRequirementMessage(
  m: { id: string; role: string; content: string; timestamp?: string; streaming?: boolean },
  sessionId: string,
  index: number,
): TimelineItem {
  const dedupeKey = `${REQ_PREFIX}:msg:${sessionId}:${m.id}`;
  // 位置 = 发生时间（ms）；没有 timestamp 才退回数组下标。同一轮里消息与思考
  // 都用时间刻度，晚到的事件因此不会插错位置。
  const at = Date.parse(m.timestamp || '');
  return {
    ..._base('requirements', dedupeKey, Number.isFinite(at) ? at : index, {
      order: { ordinal: Number.isFinite(at) ? at : index }, ts: m.timestamp, sessionId,
    } as never),
    kind: 'message',
    role: (['user', 'assistant', 'system'].includes(m.role) ? m.role : 'assistant') as
      'user' | 'assistant' | 'system',
    content: m.content,
    streaming: Boolean(m.streaming),
  } as TimelineItem;
}

/** 需求会话事件（`thinking`）→ 时间线条目：刷新/重连后思考仍可回放。 */
export function normalizeRequirementEvent(e: TaskEvent, sessionId: string): TimelineItem | null {
  const parsed = parseTaskEvent(e);
  if (e.type === 'thinking' && parsed.kind === 'thinking') {
    const text = String(parsed.turn.delta || parsed.turn.text || '');
    if (!text) return null;
    const dedupeKey = `${REQ_PREFIX}:think:${sessionId}:${e.seq}`;
    // 用后端记的"本轮开始时刻"（turn_ts, ms）定位；没有就退回事件时间。
    const turnTs = Number((e.detail as Record<string, unknown>)?.turn_ts);
    const at = Number.isFinite(turnTs) && turnTs > 0
      ? turnTs
      : (Date.parse(e.ts || '') || e.seq);
    return {
      ..._base('requirements', dedupeKey, at, {
        order: { ordinal: at }, ts: e.ts, sessionId,
      } as never),
      kind: 'reasoning',
      phase: 'requirements',
      text,
      done: Boolean(parsed.turn.done ?? true),
      availability: 'available',
    } as TimelineItem;
  }
  if (e.type === 'question' || e.type === 'answer') {
    const t = normalizeTaskEvent(e, sessionId);
    if (!t) return null;
    return { ...t, source: 'requirements', sessionId, taskId: undefined } as TimelineItem;
  }
  return null;
}

/**
 * 排序比较器（PRD §4.2）。
 *
 * 规则：同任务按 seq；其余按派发序号（到达顺序）；最后用 key 兜底保证稳定。
 * **绝不**用 `ts`。
 */
export function compareTimeline(a: TimelineItem, b: TimelineItem): number {
  if (a.source === 'task' && b.source === 'task' && a.taskId === b.taskId
      && a.order.seq !== undefined && b.order.seq !== undefined) {
    return a.order.seq - b.order.seq || a.key.localeCompare(b.key);
  }
  return a.order.ordinal - b.order.ordinal || a.key.localeCompare(b.key);
}
