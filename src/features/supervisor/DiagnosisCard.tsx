/**
 * 诊断书卡片（前端 F2）。
 *
 * 结构固定（PRD F5）：结论 / 问题与影响 / 证据 / 已尝试 / 建议动作 / 成本。
 * 建议按钮必须显示动作语义，不可写成「确定」这类模糊词。
 */

import { AlertTriangle, CheckCircle2, Info } from 'lucide-react';

import { Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { DiagnosisReport, DiagnosisSuggestion } from '@/types/supervisor';

import { stageLabel } from './labels';

interface Props {
  report: DiagnosisReport | null;
  onAction?: (suggestion: DiagnosisSuggestion) => void;
  actionPending?: string;
  className?: string;
}

export function DiagnosisCard({ report, onAction, actionPending, className }: Props) {
  if (!report) {
    return (
      <p className="text-caption text-on-surface-variant py-4">
        本次运行没有生成诊断书（未触发失败或降级）。
      </p>
    );
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex items-start gap-2">
        <AlertTriangle className="w-4 h-4 text-warning shrink-0 mt-0.5" />
        <p className="text-body-sm text-on-surface">{report.conclusion}</p>
      </div>

      {report.problems.length > 0 && (
        <section>
          <h4 className="text-caption font-semibold text-on-surface-variant mb-1">问题与影响</h4>
          <ul className="space-y-1">
            {report.problems.map((p, i) => (
              <li key={`${p.title}-${i}`} className="flex items-start gap-1.5 text-caption">
                <Badge variant={p.severity === 'error' ? 'error' : 'warning'}>
                  {p.severity === 'error' ? '错误' : '警告'}
                </Badge>
                <span className="text-on-surface">
                  {p.title}
                  {p.stage ? `（${stageLabel(p.stage)}）` : ''}
                  {p.location ? ` — ${p.location}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.evidence.length > 0 && (
        <section>
          <h4 className="text-caption font-semibold text-on-surface-variant mb-1">证据</h4>
          <ul className="space-y-0.5">
            {report.evidence.map((e, i) => (
              <li key={`${e.ref ?? 'ev'}-${i}`} className="text-caption text-on-surface-variant">
                · {e.text}
              </li>
            ))}
          </ul>
        </section>
      )}

      {report.attempted.length > 0 && (
        <section>
          <h4 className="text-caption font-semibold text-on-surface-variant mb-1">已尝试</h4>
          <ul className="space-y-0.5">
            {report.attempted.map((a, i) => (
              <li key={`${a.action}-${i}`} className="text-caption text-on-surface-variant">
                · {a.action} — {a.outcome}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h4 className="text-caption font-semibold text-on-surface-variant mb-1">建议</h4>
        <div className="flex flex-wrap gap-2">
          {report.suggestions.map((s) => (
            <Button
              key={s.id}
              size="sm"
              variant={s.action === 'accept_degraded' ? 'outline' : 'default'}
              disabled={actionPending === s.id}
              onClick={() => onAction?.(s)}
              title={s.est_cost_usd ? `预计成本 $${s.est_cost_usd}` : undefined}
            >
              {s.label}
            </Button>
          ))}
        </div>
      </section>

      <footer className="flex items-center gap-3 text-caption text-on-surface-variant">
        <Info className="w-3.5 h-3.5" />
        <span>
          本次已用 {report.cost.tokens} tokens
          {report.cost.spent_usd != null ? `（≈$${report.cost.spent_usd.toFixed(4)}）` : ''}
        </span>
        {report.mode === 'shadow' && (
          <Badge variant="info">
            <CheckCircle2 className="w-3 h-3 mr-1" />
            仅记录未执行
          </Badge>
        )}
      </footer>
    </div>
  );
}
