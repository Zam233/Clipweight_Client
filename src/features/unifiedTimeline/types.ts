/**
 * 统一时间线条目（unified-stream PRD §4.1）。
 *
 * 设计纪律：
 * - `kind` 是 **UI 语义**，`source` 是数据来源，两者不正交混用；
 * - 后端新增事件类型时只加 normalizer 分支，不改组件；
 * - 排序键是 `order.ordinal`（到达/派发序号）与 `seq`（同任务内单调），
 *   **禁止**用 `ts` 排序（客户端与服务端时钟不同源，SSE 到达顺序 ≠ 事件发生顺序）。
 */

export type TimelineSource = 'requirements' | 'task' | 'local';

export interface TimelineOrder {
  /** 派生序号：需求消息用消息下标，任务事件用 seq，回填事件按插入位 */
  ordinal: number;
  /** 任务事件的服务端 seq（仅 source=task 有意义） */
  seq?: number;
}

interface Base {
  /** 全局稳定键（= dedupeKey），用于 React key 与去重 */
  key: string;
  dedupeKey: string;
  source: TimelineSource;
  order: TimelineOrder;
  /** 原始时间戳，**只用于展示**，不参与排序 */
  ts?: string;
  /** 到达时刻，同源兜底 tie-breaker */
  receivedAt: number;
  sessionId?: string;
  taskId?: string;
  /** 归属父条目（例如 tool_result → tool_call） */
  parentKey?: string;
}

export type TimelineItem =
  | (Base & {
      kind: 'message';
      role: 'user' | 'assistant' | 'system';
      content: string;
      streaming?: boolean;
    })
  | (Base & {
      kind: 'reasoning';
      phase: 'requirements' | 'task';
      text: string;
      done: boolean;
      availability: 'available' | 'unsupported' | 'unavailable';
      round?: number;
    })
  | (Base & {
      kind: 'tool';
      tool: string;
      origin: 'main' | 'subagent' | 'skill' | 'internal';
      status: string;
      ms?: number;
      error?: string;
      agent?: string;
      stage?: string;
      sourceTag?: string;
      deduped?: boolean;
      remainingTurns?: number;
    })
  | (Base & {
      kind: 'stage';
      stage: string;
      status: string;
      summary?: string;
      completed?: number;
      total?: number;
      trigger?: string;
    })
  | (Base & {
      kind: 'question';
      questionId: string;
      question: string;
      options?: { id: string; label: string; detail?: string }[];
      allowFreeText?: boolean;
      deadlineAt?: number;
      status: 'pending' | 'answered' | 'expired' | 'cancelled';
    })
  | (Base & {
      kind: 'answer';
      questionId: string;
      optionId?: string | null;
      text?: string | null;
      source?: string;
    })
  | (Base & {
      kind: 'approval';
      approvalId?: string;
      risk?: string;
      tool?: string;
      status: string;
    })
  | (Base & {
      /** 产物/文档落地（artifact / doc_write / report）：点开能拿到路径 */
      kind: 'artifact';
      label: string;
      path?: string;
      chars?: number;
      files?: string[];
    })
  | (Base & {
      kind: 'degradation';
      scope: string;
      impact?: string;
      detail?: string;
    })
  | (Base & {
      kind: 'task-end';
      status: string;
      reason?: string;
      conclusion?: string;
      completed: string[];
      unfinished: string[];
    })
  | (Base & {
      /** 未归类事件：仍然可见，不丢（宁可平铺也不要"事件消失"） */
      kind: 'log';
      eventType: string;
      message: string;
      detail: Record<string, unknown>;
    })
  | (Base & {
      /** 历史缺口：显式条目，不静默拼接 */
      kind: 'gap';
      from: number;
      to: number;
    });

export type TimelineKind = TimelineItem['kind'];

export function isTimelineItem(v: unknown): v is TimelineItem {
  return !!v && typeof v === 'object' && 'kind' in (v as Record<string, unknown>)
    && 'dedupeKey' in (v as Record<string, unknown>);
}
