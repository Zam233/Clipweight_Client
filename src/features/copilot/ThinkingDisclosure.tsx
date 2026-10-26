/**
 * 「正在思考」折叠条（PRD §19.4 / 需求 10）
 *
 * - 有 `thinking` 事件时才出现；展开后显示模型推理内容（目前是整段 done 帧，
 *   provider 支持 token 流时同一控件继续按 delta 追加，接口不变）；
 * - provider 不返回 reasoning → 不撒谎：显示"该模型未提供思考内容"。
 */
import React from 'react';
import { ChevronDown, ChevronRight, Sparkles } from 'lucide-react';
import type { TaskEvent } from '@/types/task';

export function ThinkingDisclosure({ events }: { events: TaskEvent[] }) {
  const [open, setOpen] = React.useState(false);
  const thoughts = React.useMemo(
    () => events
      .filter((e) => e.type === 'thinking')
      .map((e) => String((e.detail as Record<string, unknown>)?.delta || e.message || '')),
    [events],
  );
  const latest = thoughts.length ? thoughts[thoughts.length - 1] : '';

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
        <span>{thoughts.length ? `思考了 ${thoughts.length} 段 · 展开` : '该模型未提供思考内容'}</span>
      </button>
      {open && latest && (
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-cw-sm bg-surface-container p-2 text-caption text-on-surface-variant">
          {latest}
        </pre>
      )}
    </div>
  );
}
