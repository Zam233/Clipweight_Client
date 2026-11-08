/**
 * 计划面板（路线 C / C4）。
 *
 * B10（2026-10-28 PRD / 缺口 N2）：主 agent 化之后 Plan **只是初始假设**
 * （后端 `hypothesis_only=true`）。真实执行由 tool_loop 按现场决定，步骤状态
 * 可能永远停在 pending。所以：
 * - `hypothesis_only !== false` → 按「初始假设」展示：不显示执行进度条、不把
 *   pending 说成"待执行"，明确告诉用户"按现场决定，可能不按这里走"；
 * - 老数据（`hypothesis_only === false`）→ 保留原来的计划/确认语义。
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
  // 只有后端明确说"不是假设"（老数据）才按执行进度展示
  const hypothesis = plan.hypothesis_only !== false;

  return (
    <section
      className={cn('space-y-3', className)}
      aria-label={hypothesis ? '初始假设' : '执行计划'}
      data-hypothesis={hypothesis ? 'true' : 'false'}
    >
      <header className="flex items-center gap-2 flex-wrap">
        <h3 className="text-body-sm font-semibold text-on-surface">
          {hypothesis ? '初始假设' : '计划'}（{plan.steps.length} 步）
        </h3>
        <Badge variant={hypothesis ? 'info' : 'default'}>
          {hypothesis ? '仅供参考，不是执行进度' : `计划 v${plan.version}`}
        </Badge>
        {plan.version > 1 && <Badge variant="info">已改过 {plan.version - 1} 次</Badge>}
        <span className="text-caption text-on-surface-variant ml-auto">
          {est.known
            ? `${hypothesis ? '假设' : '预估'}成本 ${moneyText(est.total)}`
            : '未配置模型单价，只能统计 token'}
        </span>
      </header>

      {hypothesis && (
        <p
          className="text-caption text-on-surface-variant rounded-cw-sm bg-surface-container px-2.5 py-2"
          data-testid="plan-hypothesis-note"
        >
          主 agent 会边做边判断：实际步骤由现场情况决定，可能不按这里走。
          想看真实发生了什么，请对照执行日志与子 agent 运行记录。
        </p>
      )}

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
                {hypothesis && step.status === 'pending' ? (
                  <Badge variant="default">设想</Badge>
                ) : (
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
                )}
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
          {started ? '已开始' : hypothesis ? '开始（按现场推进）' : '按计划执行'}
        </Button>
        <Button size="sm" variant="outline" onClick={onReplan} disabled={busy || started}>
          重新规划
        </Button>
        <span className="text-caption text-on-surface-variant">
          只在点开始之后才会真的花钱
        </span>
      </div>
    </section>
  );
}
