/**
 * 「正在思考」折叠条（PRD §19.4 / 需求 10）
 *
 * - 有 `thinking` 事件时才出现；展开后显示模型推理内容（整段 done 帧，provider 支持
 *   token 流时同一控件按 delta 追加，接口不变）；
 * - provider 不返回 reasoning → 不撒谎：显示"该模型未提供思考内容"；
 * - 增量累积：thinking 事件每秒可能追加几十条，旧实现每次渲染都把**全部**片段重新
 *   join 一遍（O(n²)，长任务直接把主线程拖住）。现在按 seq 记住已累积的尾部，只拼接
 *   新增片段；事件被重置（seq 变小 / 数量归零）时整体重建。
 */
import React from 'react';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import type { TaskEvent } from '@/types/task';
import { parseTaskEvent } from '@/features/task/eventSchema';

/** 保留上限：思考流"全部可见"，但也不把浏览器内存吃穿（到顶后如实说明，不静默丢） */
const MAX_CHARS = 400_000;

interface Acc {
  count: number;
  text: string;
  lastSeq: number;
  truncated: boolean;
  /** 首帧指纹（seq + 文本）：任务切换后 seq 会从头开始，靠它识别"不是同一条流" */
  head: string;
}

function _deltaOf(e: TaskEvent): string {
  const raw = (e.detail ?? {}) as Record<string, unknown>;
  const direct = raw.delta ?? raw.text;
  if (typeof direct === 'string' && direct) return direct;
  const parsed = parseTaskEvent(e);
  if (parsed.kind === 'thinking') return String(parsed.turn.text || '') || String(e.message || '');
  return String(e.message || '');
}

function _accumulate(prev: Acc | null, events: TaskEvent[]): Acc {
  const thoughts = events.filter((e) => e.type === 'thinking');
  if (!thoughts.length) return { count: 0, text: '', lastSeq: -1, truncated: false, head: '' };

  const lastSeq = thoughts[thoughts.length - 1].seq;
  const head = `${thoughts[0].seq}:${thoughts[0].message ?? ''}`;
  // 事件流重置（新任务 / 重新 hydrate）：首帧指纹或 seq 后退 → 整体重建
  if (!prev || prev.count === 0 || lastSeq < prev.lastSeq || head !== prev.head) {
    const fresh: Acc = { count: thoughts.length, text: '', lastSeq, truncated: false, head };
    for (const e of thoughts) {
      const d = _deltaOf(e);
      if (!d) continue;
      if (fresh.text.length + d.length > MAX_CHARS) { fresh.truncated = true; continue; }
      fresh.text += d;
    }
    return fresh;
  }
  if (prev.count === thoughts.length && lastSeq === prev.lastSeq) return prev;

  // 只拼接新增片段（正常追加）；乱序补齐时按 seq 判重
  let text = prev.text;
  let truncated = prev.truncated;
  for (const e of thoughts) {
    if (e.seq <= prev.lastSeq) continue;
    const d = _deltaOf(e);
    if (!d) continue;
    if (text.length + d.length > MAX_CHARS) { truncated = true; continue; }
    text += d;
  }
  return { count: thoughts.length, text, lastSeq, truncated, head };
}

export function ThinkingDisclosure({ events }: { events: TaskEvent[] }) {
  const [open, setOpen] = React.useState(false);
  const accRef = React.useRef<Acc | null>(null);
  const acc = React.useMemo(() => {
    const next = _accumulate(accRef.current, events);
    accRef.current = next;
    return next;
  }, [events]);

  return (
    <div className="border-b border-outline-variant/20 px-3 py-1.5" data-testid="thinking-disclosure">
      <button
        type="button"
        className="flex w-full items-center gap-1 text-caption text-on-surface-variant hover:text-on-surface"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <Sparkles className="h-3 w-3" />
        <span>
          {acc.count
            ? `思考了 ${acc.count} 段 · ${acc.text.length.toLocaleString()} 字 · ${open ? '收起' : '展开'}`
            : '该模型未提供思考内容'}
        </span>
      </button>
      {open && acc.text && (
        <pre
          className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-cw-sm bg-surface-container p-2 text-caption text-on-surface-variant"
          data-testid="thinking-body"
        >
          {acc.text}
          {acc.truncated && (
            <span className="block pt-1 text-on-surface-variant/60">
              （已到 {MAX_CHARS.toLocaleString()} 字上限，后续片段未继续追加）
            </span>
          )}
        </pre>
      )}
    </div>
  );
}
