/**
 * 会话时间线条目（session-timeline PRD §3.1，2026-10-31）。
 *
 * 与 `features/unifiedTimeline/types.ts` 的根本区别：那边是**客户端拼装**出来的投影
 * （靠消息下标 + 事件 seq + 派发序号三源合并，位置是推断的）；这边是**服务端给的
 * 一份有序日志**——`seq` 单调唯一，前端只按 seq 渲染，不排序、不推断、不合并。
 */

export type SessionItemType =
  | 'thinking'
  | 'content'
  | 'tool'
  | 'skill'
  | 'subagent'
  | 'report'
  | 'plan'
  | 'question'
  | 'answer'
  | 'approval'
  | 'degradation'
  | 'stage'
  | 'artifact';

export type SessionItemState = 'streaming' | 'done' | 'failed' | 'interrupted';

export type SessionItemRole = 'user' | 'assistant' | 'system';

export interface SessionItemMeta {
  /** `content` 条目是谁说的（用户气泡只给 user） */
  role?: SessionItemRole;
  /** 服务端原始事件类型（`tool`/`stage` 等由事件投影而来时保留，便于专业排查） */
  event_type?: string;
  chars?: number;
  /** 单条被截断时必须标注（服务端写 `truncated`，不静默丢） */
  truncated?: boolean;
  chars_full?: number;
  interrupted?: boolean;
  title?: string;
  brief_hash?: string;
  scene_count?: number;
  duration_sec?: number;
  legacy?: boolean;
  tool?: string;
  skill?: string;
  agent?: string;
  run_id?: string;
  stage?: string;
  phase?: string;
  status?: string;
  duration_ms?: number;
  error?: string;
  done?: boolean;
  artifact?: string;
  path?: string;
  task_id?: string;
  question_id?: string;
  question?: string;
  kind?: string;
  [key: string]: unknown;
}

export interface SessionTimelineItem {
  seq: number;
  type: SessionItemType;
  /** ISO8601（带时区）；**只用于展示**，绝不参与排序 */
  time: string;
  turn: number | null;
  state: SessionItemState;
  source: string;
  ref: string | null;
  content_ref: string | null;
  content_inline: unknown;
  meta: SessionItemMeta;
  /** 由服务端解析好的内容（大 payload 已从 items/<seq>.json 读回） */
  content?: unknown;
}

export type SessionTimelineFrame =
  | {
      op: 'snapshot';
      items: SessionTimelineItem[];
      has_more: boolean;
      latest_seq: number;
      archived_until_seq: number;
    }
  | { op: 'append'; item: SessionTimelineItem }
  | { op: 'chunk'; seq: number; delta: string }
  | { op: 'patch'; seq: number; item: SessionTimelineItem }
  | { op: 'finish'; seq: number; item: SessionTimelineItem }
  | { op: 'ping'; t: number }
  | { op: 'error'; detail?: string };

/** 条目文本（`content` 可能是字符串/dict；思考与正文只认字符串）。 */
export function itemText(item: SessionTimelineItem | undefined): string {
  if (!item) return '';
  const raw = item.content;
  if (typeof raw === 'string') return raw;
  if (raw && typeof raw === 'object') {
    const rec = raw as Record<string, unknown>;
    for (const key of ['delta', 'text', 'content', 'markdown', 'summary']) {
      if (typeof rec[key] === 'string') return rec[key] as string;
    }
  }
  return '';
}

/** 条目结构化内容（report/plan/tool 用）。 */
export function itemObject(item: SessionTimelineItem | undefined): Record<string, unknown> {
  const raw = item?.content;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

export function isStreaming(item: SessionTimelineItem): boolean {
  return item.state === 'streaming';
}

export function itemRole(item: SessionTimelineItem): SessionItemRole {
  const role = item.meta?.role;
  if (role === 'user' || role === 'system' || role === 'assistant') return role;
  return item.source === 'requirements' ? 'assistant' : 'system';
}
