/**
 * 授权弹窗（F7 / v1.5 两级确认）。
 *
 * 三条硬要求（PRD §7.6 / 计划 §13.4）：
 * 1. 说清危险程度：等级 + 会动到什么 + 可能后果；
 * 2. **默认焦点在「拒绝」**（手滑不该等于放行）；
 * 3. `high` 需勾选「我已了解风险」；`critical`（含命中硬底线）**再过一道再次确认窗口**。
 *
 * 为什么两级：一级确认挡不住「连点两下」——第二道窗口要把命令重新摆一遍，
 * 并让用户再勾一次，中间没有任何「默认继续」的路径。
 */

import { useEffect, useId, useState } from 'react';

import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { PendingExecApproval } from '@/types/supervisor';

import { ExecLevelBadge } from './ExecLevelBadge';

interface Props {
  approval: PendingExecApproval | null;
  onApprove?: (confirmHighRisk: boolean, secondConfirm: boolean) => void;
  onReject?: () => void;
  busy?: boolean;
  className?: string;
}

export function ExecPermissionDialog({ approval, onApprove, onReject, busy, className }: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [stage, setStage] = useState<1 | 2>(1);
  const [finalConfirmed, setFinalConfirmed] = useState(false);
  const checkId = useId();
  const finalId = useId();

  // 换一条待授权命令就回到第一级（否则上一轮的勾选会污染这一轮）
  useEffect(() => {
    setStage(1);
    setConfirmed(false);
    setFinalConfirmed(false);
  }, [approval?.id]);

  if (!approval) return null;

  const needsConfirm = approval.riskLevel === 'high' || approval.riskLevel === 'critical';
  const needsDouble = Boolean(approval.needsDoubleConfirm);

  const firstStep = () => {
    if (needsDouble) {
      setStage(2);
      return;
    }
    onApprove?.(needsConfirm && confirmed, false);
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={stage === 2 ? '再次确认执行' : '命令授权'}
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center bg-black/50',
        className,
      )}
    >
      <div className="w-[520px] max-w-[92vw] rounded-cw-md bg-surface-container border border-outline-variant/40 p-4 space-y-3">
        <header className="flex items-center gap-2">
          <ExecLevelBadge level={approval.riskLevel} />
          <h3 className="text-body-sm font-semibold text-on-surface">
            {stage === 2 ? '再次确认：这一步会真的执行' : '需要你确认执行'}
          </h3>
          {stage === 2 && (
            <span className="text-caption text-warning">第 2 / 2 步</span>
          )}
        </header>

        {approval.hardFloor && (
          <p className="text-caption text-error">
            这条命令命中了安全底线（读凭据 / 不可逆破坏）。它仍然可以执行，但需要你连过两道确认。
          </p>
        )}

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

        {stage === 1 && needsConfirm && (
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

        {stage === 2 && (
          <>
            <p className="text-caption text-on-surface">
              再确认一次：执行后**没有撤销**。如果你只是想看看情况，请点「拒绝」。
            </p>
            <label htmlFor={finalId} className="flex items-center gap-2 text-caption text-error">
              <input
                id={finalId}
                type="checkbox"
                checked={finalConfirmed}
                onChange={(e) => setFinalConfirmed(e.target.checked)}
              />
              我确认要执行这条极高风险命令
            </label>
          </>
        )}

        <footer className="flex justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={stage === 2 ? () => setStage(1) : onReject}
            disabled={busy}
            autoFocus
          >
            {stage === 2 ? '退回去' : '拒绝'}
          </Button>
          {stage === 1 ? (
            <Button size="sm" onClick={firstStep} disabled={busy || (needsConfirm && !confirmed)}>
              {needsDouble ? '继续' : '允许执行'}
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => onApprove?.(needsConfirm, true)}
              disabled={busy || !finalConfirmed}
            >
              确认执行
            </Button>
          )}
        </footer>
      </div>
    </div>
  );
}
