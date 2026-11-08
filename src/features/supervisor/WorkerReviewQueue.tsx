/**
 * 待审 worker 队列（F8）。
 *
 * 两级门的第二级：展示**独立 LLM** 给出的风险等级与理由 + 完整 prompt / 工具集，
 * 由人工批准。`risk=high` 时批准需勾选二次确认（禁止一键通过）。
 */

import { useState } from 'react';

import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { PendingWorkerReview } from '@/types/supervisor';

import { riskLabel } from './labels';

interface Props {
  items: PendingWorkerReview[];
  onReview?: (workerId: string, approve: boolean, confirmHighRisk: boolean) => void;
  busyId?: string;
  className?: string;
}

export function WorkerReviewQueue({ items, onReview, busyId, className }: Props) {
  if (items.length === 0) {
    return (
      <p className={cn('text-caption text-on-surface-variant py-4', className)}>
        没有待审核的子代理。
      </p>
    );
  }
  return (
    <ul className={cn('space-y-2', className)} aria-label="待审核子代理">
      {items.map((item) => (
        <WorkerReviewCard
          key={item.id}
          item={item}
          busy={busyId === item.id}
          onReview={onReview}
        />
      ))}
    </ul>
  );
}

export function WorkerReviewCard({
  item,
  busy,
  onReview,
}: {
  item: PendingWorkerReview;
  busy?: boolean;
  onReview?: (workerId: string, approve: boolean, confirmHighRisk: boolean) => void;
}) {
  const [confirmed, setConfirmed] = useState(false);
  const [showPrompt, setShowPrompt] = useState(false);
  const needsConfirm = item.risk.level === 'high';

  return (
    <li className="rounded-cw-sm border border-outline-variant/30 bg-surface-container/40 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-body-sm text-on-surface">{item.role}</span>
        <Badge variant={item.risk.level === 'high' ? 'error' : item.risk.level === 'med' ? 'warning' : 'success'}>
          风险：{riskLabel(item.risk.level)}
        </Badge>
        {item.hasExecPermission && <Badge variant="info">含执行权限</Badge>}
      </div>

      <p className="text-caption text-on-surface-variant">
        独立判定：{item.risk.reasons.join('；') || '（无理由）'}
      </p>
      <p className="text-caption text-on-surface-variant/80">
        该判定来自独立模型，未参考秘书的说法。
      </p>

      <div className="text-caption text-on-surface-variant">
        工具：{item.toolAllowlist.length ? item.toolAllowlist.join('、') : '（无）'}
      </div>

      <button
        type="button"
        className="text-caption text-primary underline"
        onClick={() => setShowPrompt((v) => !v)}
        aria-expanded={showPrompt}
      >
        {showPrompt ? '收起任务说明' : '查看完整任务说明'}
      </button>
      {showPrompt && (
        <pre className="text-caption text-on-surface-variant whitespace-pre-wrap break-all bg-surface-container-low rounded-cw-sm p-2 max-h-40 overflow-auto">
          {item.systemPrompt || '（未提供）'}
        </pre>
      )}

      {needsConfirm && (
        <label className="flex items-center gap-2 text-caption text-warning">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
          />
          我已了解风险，仍要批准
        </label>
      )}

      <div className="flex justify-end gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onReview?.(item.id, false, false)}>
          拒绝
        </Button>
        <Button
          size="sm"
          disabled={busy || (needsConfirm && !confirmed)}
          onClick={() => onReview?.(item.id, true, needsConfirm && confirmed)}
        >
          批准
        </Button>
      </div>
    </li>
  );
}
