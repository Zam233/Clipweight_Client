/**
 * 人工改派工单（F4）。
 *
 * 只允许选核心环节；必须写理由（进账本留痕）。提交后由页面决定是否触发 retry。
 */

import { useState } from 'react';

import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

import { STAGE_CN, stageLabel } from './labels';

const STAGES = ['structure', 'material', 'edit', 'animation', 'audio'] as const;

interface Props {
  onSubmit?: (order: { target_stage: string; reason: string }) => void;
  busy?: boolean;
  result?: { requires_retry?: boolean } | null;
  className?: string;
}

export function DispatchForm({ onSubmit, busy, result, className }: Props) {
  const [stage, setStage] = useState<string>('edit');
  const [reason, setReason] = useState('');

  const disabled = busy || !reason.trim();

  return (
    <form
      className={cn('space-y-2', className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (disabled) return;
        onSubmit?.({ target_stage: stage, reason: reason.trim() });
      }}
    >
      <label className="block text-caption text-on-surface-variant">
        要重做的环节
        <select
          className="mt-1 w-full bg-surface-container rounded-cw-sm px-2 py-1 text-body-sm text-on-surface"
          value={stage}
          onChange={(e) => setStage(e.target.value)}
        >
          {STAGES.map((s) => (
            <option key={s} value={s}>
              {stageLabel(s)}
            </option>
          ))}
        </select>
      </label>

      <label className="block text-caption text-on-surface-variant">
        理由（会记入调度账本，供事后追溯）
        <textarea
          className="mt-1 w-full bg-surface-container rounded-cw-sm px-2 py-1 text-body-sm text-on-surface"
          rows={2}
          value={reason}
          placeholder="例如：第 3 段画面明显卡顿，怀疑剪辑点有问题"
          onChange={(e) => setReason(e.target.value)}
        />
      </label>

      <div className="flex items-center gap-2">
        <Button size="sm" type="submit" disabled={disabled}>
          提交改派
        </Button>
        <span className="text-caption text-on-surface-variant">
          {result?.requires_retry ? '已登记，重试该环节后生效' : `目标：${STAGE_CN[stage] ?? stage}`}
        </span>
      </div>
    </form>
  );
}
