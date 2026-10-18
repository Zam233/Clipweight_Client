/**
 * 计划面板（路线 C / C4）—— 用户看到的"第一步"。
 *
 * Q3 已裁定：默认 `plan_only=true`，所以这个面板就是确认页。它必须回答三件事：
 * 1. 打算做什么（每步 + 为什么）；
 * 2. 要花多少钱（**单价未配置时不许假装是 $0**，要说"只记 token"）；
 * 3. 有没有卡点（依赖不可用/跳过）。
 */

import { AlertTriangle, Check, Loader2, Play, SkipForward, X } from 'lucide-react';

import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { Plan, PlanStep, Task } from '@/types/task';

import { KIND_CN, STEP_STATUS_CN, moneyText, stepLabel } from './labels';

interface Props {
  task: Task;
  busy?: boolean;
  onStart?: () => void;
  onReplan?: () => void;
  className?: string;
}

function StepIcon({ step }: { step: PlanStep }) {
  switch (step.status) {
    case 'done':
      return <Check className="w-3.5 h-3.5 text-success" />;
    case 'failed':
      return <X className="w-3.5 h-3.5 text-error" />;
    case 'running':
      return <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />;
    case 'skipped':
      return <SkipForward className="w-3.5 h-3.5 text-on-surface-variant" />;
    default:
      return <span className="w-1.5 h-1.5 rounded-full bg-outline-variant" />;
  }
}

function estimateOf(plan: Plan): { known: boolean; total: number } {
  let total = 0;
  let known = false;
  for (const step of plan.steps) {
    if (typeof step.est_cost_usd === 'number') {
      total += step.est_cost_usd;
      known = true;
    }
  }
  return { known, total };
}

export function PlanPanel({ task, busy, onStart, onReplan, className }: Props) {
  const plan = task.plan;
  if (!plan) {
    return (
      <p className="text-caption text-on-surface-variant py-4">
        还没有计划。点「生成计划」让主 Agent 先想一遍要做什么。
      </p>
    );
  }
  const est = estimateOf(plan);
  const started = ['running', 'done', 'failed', 'paused'].includes(task.status);

  return (
    <section className={cn('space-y-3', className)} aria-label="执行计划">
      <header className="flex items-center gap-2 flex-wrap">
        <h3 className="text-body-sm font-semibold text-on-surface">
          计划（{plan.steps.length} 步）
        </h3>
        {plan.version > 1 && <Badge variant="info">已改过 {plan.version - 1} 次</Badge>}
        <span className="text-caption text-on-surface-variant ml-auto">
          {est.known ? `预估成本 ${moneyText(est.total)}` : '未配置模型单价，只能统计 token'}
        </span>
      </header>

      {plan.rationale && (
        <p className="text-caption text-on-surface-variant">{plan.rationale}</p>
      )}

      <ol className="space-y-1.5">
        {plan.steps.map((step, index) => (
          <li
            key={step.id}
            className="flex items-start gap-2 rounded-cw-sm bg-surface-container px-2.5 py-2"
          >
            <span className="mt-0.5 w-4 shrink-0 flex justify-center">
              <StepIcon step={step} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-caption font-mono text-on-surface-variant">
                  {index + 1}.
                </span>
                <span className="text-body-sm text-on-surface">{stepLabel(step)}</span>
                <Badge variant="default">{KIND_CN[step.kind] ?? step.kind}</Badge>
                <Badge
                  variant={
                    step.status === 'failed'
                      ? 'error'
                      : step.status === 'done'
                        ? 'success'
                        : 'default'
                  }
                >
                  {STEP_STATUS_CN[step.status] ?? step.status}
                </Badge>
                {step.attempt > 1 && (
                  <span className="text-caption text-on-surface-variant">
                    第 {step.attempt} 次
                  </span>
                )}
              </div>
              {step.why && (
                <p className="text-caption text-on-surface-variant mt-0.5">{step.why}</p>
              )}
              {step.error && (
                <p className="text-caption text-error mt-0.5 flex items-start gap-1">
                  <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                  {step.error}
                </p>
              )}
              {step.result_brief && !step.error && (
                <p className="text-caption text-on-surface-variant mt-0.5">
                  {step.result_brief}
                </p>
              )}
            </div>
            <span className="text-caption text-on-surface-variant shrink-0">
              {step.duration_ms > 0 ? `${Math.round(step.duration_ms)}ms` : ''}
            </span>
          </li>
        ))}
      </ol>

      <div className="flex items-center gap-2 flex-wrap">
        <Button
          size="sm"
          onClick={onStart}
          disabled={busy || started || task.status === 'cancelled'}
        >
          <Play className="w-3.5 h-3.5 mr-1" />
          {started ? '已开始' : '按计划执行'}
        </Button>
        <Button size="sm" variant="outline" onClick={onReplan} disabled={busy || started}>
          重新规划
        </Button>
        <span className="text-caption text-on-surface-variant">
          只在点「按计划执行」之后才会真的花钱
        </span>
      </div>
    </section>
  );
}
