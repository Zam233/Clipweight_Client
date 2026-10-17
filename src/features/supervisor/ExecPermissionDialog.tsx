/**
 * 授权弹窗（F7）。
 *
 * 三条硬要求（PRD §7.6 / 计划 §13.4）：
 * 1. 说清危险程度：等级 + 会动到什么 + 可能后果；
 * 2. **默认焦点在「拒绝」**（手滑不该等于放行）；
 * 3. `high/critical` 必须勾选「我已了解风险」后才能批准。
 */

import { useId, useState } from 'react';

import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { PendingExecApproval } from '@/types/supervisor';

import { ExecLevelBadge } from './ExecLevelBadge';

interface Props {
  approval: PendingExecApproval | null;
  onApprove?: (confirmHighRisk: boolean) => void;
  onReject?: () => void;
  busy?: boolean;
  className?: string;
}

export function ExecPermissionDialog({ approval, onApprove, onReject, busy, className }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const checkId = useId();
  if (!approval) return null;

  const needsConfirm = approval.riskLevel === 'high' || approval.riskLevel === 'critical';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="命令授权"
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/50',
        className,
      )}
    >
      <div className="w-[520px] max-w-[92vw] rounded-cw-md bg-surface-container border border-outline-variant/40 p-4 space-y-3">
        <header className="flex items-center gap-2">
          <ExecLevelBadge level={approval.riskLevel} />
          <h3 className="text-body-sm font-semibold text-on-surface">需要你确认执行</h3>
        </header>

        <p className="text-caption text-on-surface">
          {approval.dangerExplanation || approval.riskReasons.join('；') || '该命令被判定为有风险'}
        </p>

        {approval.riskReasons.length > 0 && (
          <ul className="text-caption text-on-surface-variant space-y-0.5">
            {approval.riskReasons.map((r, i) => (
              <li key={`${r}-${i}`}>· {r}</li>
            ))}
          </ul>
        )}

        <pre className="text-caption text-on-surface whitespace-pre-wrap break-all bg-surface-container-low rounded-cw-sm p-2">
          {approval.command}
        </pre>

        {needsConfirm && (
          <label htmlFor={checkId} className="flex items-center gap-2 text-caption text-warning">
            <input
              id={checkId}
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
            />
            我已了解风险，仍要执行
          </label>
        )}

        <footer className="flex justify-end gap-2">
          <Button size="sm" variant="outline" onClick={onReject} disabled={busy} autoFocus>
            拒绝
          </Button>
          <Button
            size="sm"
            onClick={() => onApprove?.(needsConfirm && confirmed)}
            disabled={busy || (needsConfirm && !confirmed)}
          >
            允许执行
          </Button>
        </footer>
      </div>
    </div>
  );
}
