/**
 * 风险等级徽标（F7）。不只靠颜色：带图标 + 中文文案。
 */

import { AlertOctagon, AlertTriangle, Info, ShieldCheck } from 'lucide-react';

import { Badge } from '@/components/ui';
import type { RiskLevel } from '@/types/supervisor';

import { riskLabel } from './labels';

interface Props {
  level: RiskLevel | string;
  className?: string;
}

const ICONS = {
  low: ShieldCheck,
  med: Info,
  high: AlertTriangle,
  critical: AlertOctagon,
} as const;

const VARIANTS = {
  low: 'success',
  med: 'info',
  high: 'warning',
  critical: 'error',
} as const;

export function ExecLevelBadge({ level, className }: Props) {
  const key = (level in ICONS ? level : 'high') as keyof typeof ICONS;
  const Icon = ICONS[key];
  return (
    <Badge variant={VARIANTS[key]} className={className}>
      <Icon className="w-3 h-3 mr-1" aria-hidden />
      {riskLabel(key)}
    </Badge>
  );
}
