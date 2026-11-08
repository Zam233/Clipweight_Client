/**
 * 调度中枢模式开关（F5，管理员）。
 *
 * 三档语义必须写在界面上——否则用户不知道 shadow 到底会不会动他的成片。
 */

import { cn } from '@/lib/utils';

export type SupervisorMode = 'off' | 'shadow' | 'on';

const OPTIONS: { value: SupervisorMode; label: string; desc: string }[] = [
  { value: 'off', label: '关闭', desc: '行为与改造前完全一致（默认）' },
  { value: 'shadow', label: '影子', desc: '只记录归因与诊断书，不改执行' },
  { value: 'on', label: '启用', desc: '按归因派工、按策略重做，并允许执行命令' },
];

interface Props {
  mode: SupervisorMode;
  onChange?: (mode: SupervisorMode) => void;
  busy?: boolean;
  className?: string;
}

export function SupervisorModeSwitch({ mode, onChange, busy, className }: Props) {
  return (
    <fieldset className={cn('space-y-1', className)}>
      <legend className="text-caption text-on-surface-variant mb-1">调度中枢模式</legend>
      {OPTIONS.map((opt) => (
        <label
          key={opt.value}
          className="flex items-start gap-2 text-caption text-on-surface cursor-pointer"
        >
          <input
            type="radio"
            name="supervisor-mode"
            value={opt.value}
            checked={mode === opt.value}
            disabled={busy}
            onChange={() => onChange?.(opt.value)}
            className="mt-0.5"
          />
          <span>
            <span className="font-semibold">{opt.label}</span>
            <span className="text-on-surface-variant ml-2">{opt.desc}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}
