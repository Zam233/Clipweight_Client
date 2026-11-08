/**
 * 自动模式开关（F7）。必须显式、常驻、可反向，且文案写清后果。
 */

import { Button } from '@/components/ui';
import { cn } from '@/lib/utils';

interface Props {
  enabled: boolean;
  onChange?: (enabled: boolean) => void;
  busy?: boolean;
  className?: string;
}

export function AutoModeSwitch({ enabled, onChange, busy, className }: Props) {
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <Button
        size="sm"
        variant={enabled ? 'default' : 'outline'}
        onClick={() => onChange?.(!enabled)}
        disabled={busy}
        aria-pressed={enabled}
      >
        自动模式：{enabled ? '开' : '关'}
      </Button>
      <span className="text-caption text-on-surface-variant">
        {enabled
          ? '中危命令将直接执行，高危仍会询问'
          : '危险命令将逐条请你确认'}
      </span>
    </div>
  );
}
