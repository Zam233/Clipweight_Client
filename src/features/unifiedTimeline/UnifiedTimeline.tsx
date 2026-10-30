/**
 * 统一时间线视图（unified-stream PRD §4.6 / §M2）。
 *
 * 一条流承载：消息、思考、工具、阶段、提问/回答、授权、降级、结论、缺口。
 * 渲染侧只做两件事：**窗口化**（首屏最近 N 条 + 「加载更早」）与**条目级折叠**。
 * 排序/去重/合并全在 `unifiedTimelineStore`，这里不碰。
 */

import React from 'react';
import { ChevronDown, ChevronRight, CircleAlert, Wrench } from 'lucide-react';

import { cn } from '@/lib/utils';
import { selectOrderedItems, useUnifiedTimelineStore } from '@/stores/unifiedTimelineStore';
import { finishReasonLabel } from '@/features/task/labels';
import { supervisorApi } from '@/services/api';
import type { TimelineItem } from '@/features/unifiedTimeline/types';

const WINDOW = 100;

const ORIGIN_CN: Record<string, string> = {
  main: '主 agent', subagent: '子 agent', skill: '技能', internal: '内部',
};

function ReasoningRow({ item }: { item: Extract<TimelineItem, { kind: 'reasoning' }> }) {
  const [open, setOpen] = React.useState(false);
  const n = item.text.length;
  return (
    <div className="px-2 py-1" data-testid="unified-item-reasoning">
      <button
        type="button"
        className="flex items-center gap-1 text-caption text-on-surface-variant hover:text-on-surface"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        思考（{n.toLocaleString()} 字）{item.done ? '' : ' · 进行中'}
      </button>
      {open && (
        <pre className="mt-1 max-h-52 overflow-auto whitespace-pre-wrap rounded-cw-sm bg-surface-container p-2 text-caption text-on-surface-variant">
          {item.text}
        </pre>
      )}
    </div>
  );
}

/** 授权条目：等授权不是失败，必须能当场提交（与 ApprovalRows 同一套接口/二次确认）。 */
function ApprovalRow({
  item, taskId,
}: {
  item: Extract<TimelineItem, { kind: 'approval' }>;
  taskId?: string;
}) {
  const [busy, setBusy] = React.useState(false);
  const [note, setNote] = React.useState('');
  const settled = item.status !== 'pending' && item.status !== 'requested';

  const submit = async (approve: boolean) => {
    if (!item.approvalId || !taskId || busy) return;
    const highRisk = item.risk === 'high' || item.risk === 'critical';
    if (approve && highRisk
        && !window.confirm(`这条操作被判定为 ${item.risk} 风险，确认授权？`)) return;
    setBusy(true);
    try {
      if (approve) {
        await supervisorApi.approveExec(taskId, item.approvalId, highRisk, item.risk === 'critical');
        setNote('已授权');
      } else {
        await supervisorApi.rejectExec(taskId, item.approvalId);
        setNote('已拒绝');
      }
    } catch (e) {
      setNote(`提交失败：${(e as Error)?.message || '未知错误'}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-wrap items-baseline gap-2 px-2 py-0.5 text-caption"
      data-testid="unified-item-approval">
      <span className="text-warning">授权</span>
      <span className="text-on-surface-variant">{item.tool || ''}</span>
      <span className="text-on-surface-variant/80">{item.status}</span>
      {item.risk && <span className="text-on-surface-variant/60">risk={item.risk}</span>}
      {!settled && taskId && (
        <>
          <button
            type="button"
            data-approval-approve={item.approvalId}
            disabled={busy}
            className="rounded-cw-xs border border-primary/40 px-1.5 text-primary hover:bg-primary/10 disabled:opacity-50"
            onClick={() => void submit(true)}
          >
            授权
          </button>
          <button
            type="button"
            data-approval-reject={item.approvalId}
            disabled={busy}
            className="rounded-cw-xs border border-error/40 px-1.5 text-error hover:bg-error/10 disabled:opacity-50"
            onClick={() => void submit(false)}
          >
            拒绝
          </button>
        </>
      )}
      {note && <span className="text-on-surface-variant/80" data-testid="unified-approval-note">{note}</span>}
    </div>
  );
}

function TimelineRow({ item, taskId }: { item: TimelineItem; taskId?: string }) {
  switch (item.kind) {
    case 'message': {
      const mine = item.role === 'user';
      return (
        <div className="px-2 py-1" data-testid="unified-item-message" data-role={item.role}>
          <div className={cn(
            'rounded-cw-sm px-2 py-1 text-body-sm',
            mine ? 'bg-primary/10 text-on-surface' : 'bg-surface-container text-on-surface',
          )}>
            <span className="mr-1 text-caption text-on-surface-variant/70">
              {item.role === 'user' ? '你' : item.role === 'system' ? '系统' : '助手'}
            </span>
            <span className="whitespace-pre-wrap">{item.content}</span>
            {item.streaming && <span className="ml-1 animate-pulse text-caption">▍</span>}
          </div>
        </div>
      );
    }
    case 'reasoning':
      return <ReasoningRow item={item} />;
    case 'tool':
      return (
        <div
          className="flex items-baseline gap-2 px-2 py-0.5 text-caption"
          data-testid="unified-item-tool"
          data-origin={item.origin}
        >
          <Wrench className="h-3 w-3 shrink-0 text-on-surface-variant/60" />
          <span className="w-10 shrink-0 text-on-surface-variant/60">
            {ORIGIN_CN[item.origin] ?? item.origin}
          </span>
          <span className="w-40 shrink-0 truncate font-mono text-on-surface-variant">{item.tool}</span>
          <span className={item.status === 'ok' ? 'text-primary' : 'text-error'}>{item.status}</span>
          {typeof item.ms === 'number' && (
            <span className="text-on-surface-variant/60">{item.ms}ms</span>
          )}
          {item.agent && <span className="text-on-surface-variant/60">@{item.agent}</span>}
          {item.error && <span className="truncate text-error/80">{item.error}</span>}
        </div>
      );
    case 'stage':
      return (
        <div className="flex items-baseline gap-2 px-2 py-0.5 text-caption" data-testid="unified-item-stage">
          <span className="rounded-cw-xs bg-surface-container px-1 text-on-surface-variant">
            {item.stage || '阶段'}
          </span>
          <span className="text-on-surface-variant/80">{item.status}</span>
          {typeof item.completed === 'number' && (
            <span className="text-on-surface-variant/60">
              {item.completed}{typeof item.total === 'number' ? `/${item.total}` : ''}
            </span>
          )}
          {item.summary && <span className="truncate text-on-surface-variant/70">{item.summary}</span>}
        </div>
      );
    case 'question':
      return (
        <div className="px-2 py-0.5 text-caption" data-testid="unified-item-question">
          <span className="mr-1 text-warning">待答</span>
          <span className="text-on-surface">{item.question}</span>
          {item.status === 'answered' && <span className="ml-1 text-primary">已答</span>}
          {(item as unknown as { answeredWith?: { optionId?: string | null; text?: string | null } })
            .answeredWith && (
            <span className="ml-1 text-on-surface-variant/70">
              → {(item as unknown as { answeredWith: { optionId?: string | null; text?: string | null } })
                .answeredWith.optionId
                ?? (item as unknown as { answeredWith: { text?: string | null } }).answeredWith.text}
            </span>
          )}
        </div>
      );
    case 'answer':
      return (
        <div className="px-2 py-0.5 text-caption" data-testid="unified-item-answer">
          <span className="mr-1 text-primary">已答</span>
          <span className="text-on-surface-variant/80">
            {item.optionId || item.text || ''}
            {item.source ? `（${item.source}）` : ''}
          </span>
        </div>
      );
    case 'approval':
      return <ApprovalRow item={item} taskId={taskId} />;
    case 'degradation':
      return (
        <div className="px-2 py-0.5 text-caption text-warning/90" data-testid="unified-item-degradation">
          降级：{item.scope}{item.impact ? ` · ${item.impact}` : ''}
        </div>
      );
    case 'task-end':
      return (
        <div className="px-2 py-1 text-caption" data-testid="unified-item-task-end">
          <span className="font-medium text-on-surface">
            任务结束：{item.reason ? finishReasonLabel(item.reason) : item.status}
          </span>
          {item.conclusion && <div className="text-on-surface-variant/80">{item.conclusion}</div>}
          {item.unfinished.length > 0 && (
            <div className="text-error/80">未完成：{item.unfinished.join('；')}</div>
          )}
        </div>
      );
    case 'artifact':
      return (
        <div className="flex items-baseline gap-2 px-2 py-0.5 text-caption"
          data-testid="unified-item-artifact">
          <span className="rounded-cw-xs bg-surface-container px-1 text-on-surface-variant">产物</span>
          <span className="text-on-surface">{item.label}</span>
          {typeof item.chars === 'number' && (
            <span className="text-on-surface-variant/60">{item.chars} 字</span>
          )}
          {item.path && (
            <button
              type="button"
              title="复制路径"
              className="max-w-full truncate font-mono text-on-surface-variant/50 underline decoration-dotted hover:text-on-surface"
              onClick={() => { void navigator.clipboard?.writeText(item.path!); }}
            >
              {item.path}
            </button>
          )}
          {item.files && item.files.length > 0 && (
            <span className="text-on-surface-variant/60">+{item.files.length} 个文件</span>
          )}
        </div>
      );
    case 'gap':
      return (
        <div className="flex items-center gap-1 px-2 py-0.5 text-caption text-on-surface-variant/60"
          data-testid="unified-item-gap">
          <CircleAlert className="h-3 w-3" /> 历史缺口 seq {item.from}–{item.to}
        </div>
      );
    case 'log':
      return (
        <div className="px-2 py-0.5 text-caption text-on-surface-variant/70"
          data-testid="unified-item-log" data-event-type={item.eventType}>
          <span className="mr-1 font-mono">{item.eventType}</span>
          {item.message}
        </div>
      );
    default: {
      // 穷尽检查：新增 kind 必须在这里补 renderer，否则类型不过
      const never: never = item;
      return <div className="px-2 py-0.5 text-caption text-error">{String(never)}</div>;
    }
  }
}

export function UnifiedTimeline({
  taskId,
  sessionId,
  className,
}: {
  taskId?: string;
  sessionId?: string;
  className?: string;
}) {
  const itemsByKey = useUnifiedTimelineStore((s) => s.itemsByKey);
  const items = React.useMemo(
    () => selectOrderedItems({ itemsByKey }, { taskId, sessionId }),
    [itemsByKey, taskId, sessionId],
  );
  const [visible, setVisible] = React.useState(WINDOW);
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);

  /**
   * 滚动到顶部附近 → 自动多渲染一页（M4）。
   *
   * 为什么不是绝对定位的"真虚拟滚动"：条目高度不是定值（思考可展开、消息长短不一、
   * 工具行有错误文本换行），绝对定位虚拟化一旦估高就会抖动/跳位。这里用
   * "滚动触发式分页 + DOM 有界"：一次最多渲染 `visible` 条，滚到顶再加一页，
   * 内存与 DOM 都受控，且不会跳。
   */
  const onScroll = React.useCallback((e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop > 24) return;
    setVisible((v) => (v < 4000 ? v + WINDOW : v));
  }, []);

  if (!items.length) {
    return (
      <div className={cn('px-3 py-6 text-center text-caption text-on-surface-variant/60', className)}
        data-testid="unified-timeline-empty">
        还没有可显示的时间线内容。
      </div>
    );
  }

  // 最新在下：窗口只截断顶部（更早的），用「加载更早」逐段展开
  const shown = items.slice(Math.max(0, items.length - visible));
  const rest = items.length - shown.length;

  return (
    <div
      ref={scrollerRef}
      onScroll={onScroll}
      className={cn('max-h-[60vh] overflow-y-auto text-body-sm', className)}
      data-testid="unified-timeline"
      data-total={items.length}
      data-rendered={shown.length}
    >
      {rest > 0 && (
        <button
          type="button"
          data-testid="unified-load-earlier"
          className="mb-1 px-2 text-caption text-primary hover:underline"
          onClick={() => setVisible((v) => v + WINDOW)}
        >
          加载更早的 {Math.min(rest, WINDOW)} 条（还有 {rest} 条）
        </button>
      )}
      {shown.map((it) => <TimelineRow key={it.key} item={it} taskId={taskId} />)}
    </div>
  );
}
