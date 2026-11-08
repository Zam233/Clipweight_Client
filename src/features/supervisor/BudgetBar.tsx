/**
 * 成本条（前端 F3）。
 *
 * 两种形态（PRD F6）：
 * - 未配置预算：只显示已花金额，**不显示进度、不冻结任何操作**；
 * - 已配置：显示「已花 / 预算」，≥70% 黄、≥100% 红并提示重试已冻结。
 */

import { cn } from '@/lib/utils';
import type { BudgetSnapshot } from '@/types/supervisor';

interface Props {
  budget: BudgetSnapshot | null;
  className?: string;
}

export function BudgetBar({ budget, className }: Props) {
  if (!budget) {
    return (
      <p className={cn('text-caption text-on-surface-variant', className)}>
        成本数据尚未就绪。
      </p>
    );
  }

  const subagentLine = (budget.subagentSpentUsd ?? 0) > 0 && (
    <p className="text-caption text-on-surface-variant mt-1">
      其中子代理花费 ≈ ${(budget.subagentSpentUsd ?? 0).toFixed(4)}
    </p>
  );

  if (!budget.budgetEnabled || budget.level === 'unlimited') {
    return (
      <div className={cn('space-y-1', className)}>
        <p className="text-body-sm text-on-surface">
          已花 ≈ ${budget.spent_usd.toFixed(4)}
          <span className="text-caption text-on-surface-variant ml-2">
            （未设置预算 · 无上限）
          </span>
        </p>
        {subagentLine}
      </div>
    );
  }

  const ratio = budget.ratio ?? 0;
  const pct = Math.min(100, Math.round(ratio * 100));
  const barColor =
    budget.level === 'blocked'
      ? 'bg-error'
      : budget.level === 'warn'
        ? 'bg-warning'
        : 'bg-primary';

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center justify-between text-caption text-on-surface-variant">
        <span>
          已花 ≈ ${budget.spent_usd.toFixed(4)}
          {budget.budget_usd != null ? ` / $${budget.budget_usd.toFixed(2)}` : ''}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="h-2 rounded-cw-full bg-surface-container overflow-hidden">
        <div className={cn('h-full transition-all duration-300', barColor)} style={{ width: `${pct}%` }} />
      </div>
      {budget.level === 'blocked' && (
        <p className="text-caption text-error">预算已耗尽：新的重做与派工已被拒绝。</p>
      )}
      {budget.level === 'warn' && (
        <p className="text-caption text-warning">预算已用 70% 以上：模型已收窄到便宜/标准档。</p>
      )}
      {subagentLine}
    </div>
  );
}
