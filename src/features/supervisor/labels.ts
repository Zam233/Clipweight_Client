/**
 * 调度中枢的对外文案映射（PRD §2.2 术语表）。
 *
 * 纪律：界面上**不出现** structure/material/edit 这类内部名，也不出现 S1/S2 这种
 * 策略代号——用户看到的是「选材」「剪辑」「换模型再试」。
 */

import type { Strategy } from '@/types/supervisor';

export const STAGE_CN: Record<string, string> = {
  structure: '脚本结构',
  material: '素材选材',
  edit: '剪辑',
  animation: '动画',
  audio: '配音与音频',
  quality: '质检',
  postprocess: '成片后处理',
};

export function stageLabel(stage: string): string {
  return STAGE_CN[stage] ?? (stage || '未知环节');
}

export const STRATEGY_CN: Record<string, string> = {
  S1_same: '同参数再试一次',
  S2_model: '换个模型再试',
  S3_upstream: '回到上游重做',
  S4_accept_degraded: '接受当前版本',
  S5_new_path: '换一种做法',
  S6_abort: '停止并转人工',
};

export function strategyLabel(strategy: Strategy | string): string {
  return STRATEGY_CN[strategy] ?? String(strategy || '未知策略');
}

export const RISK_CN: Record<string, string> = {
  low: '低',
  med: '中',
  high: '高',
  critical: '极高',
};

export function riskLabel(level: string): string {
  return RISK_CN[level] ?? String(level || '未知');
}

export const DECISION_CN: Record<string, string> = {
  pass: '通过',
  fail: '失败',
  cancelled: '已取消',
  skipped: '已跳过',
};

export function decisionLabel(decision: string): string {
  return DECISION_CN[decision] ?? String(decision || '');
}
