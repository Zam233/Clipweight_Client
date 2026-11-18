import { textMotionFlags } from './flags';

export type RolloutStage = 'off' | 'canary' | 'on';

/** FNV-1a 稳定分桶；同 projectId 永远同桶，避免刷新漂移。 */
export function stableBucket(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100;
}

function stageOf(raw: unknown): RolloutStage {
  return raw === 'on' || raw === 'canary' ? raw : 'off';
}

function percentOf(raw: unknown): number {
  const n = typeof raw === 'string' ? Number(raw) : NaN;
  return Number.isFinite(n) ? Math.max(0, Math.min(100, n)) : 0;
}

export interface RolloutConfig {
  stage: RolloutStage;
  percent: number;
}

export function motionSpecRollout(): RolloutConfig {
  const env = import.meta.env as Record<string, string | undefined>;
  return {
    stage: stageOf(env.VITE_TEXT_MOTION_3D_ROLLOUT),
    percent: percentOf(env.VITE_TEXT_MOTION_3D_ROLLOUT_PERCENT),
  };
}

/** CSS3D 覆盖层：off=关；on=全开；canary=按 projectId 稳定分桶。 */
export function isMotionSpec3DEnabled(projectId: string | null | undefined): boolean {
  if (textMotionFlags.overlay3d) return true;
  const { stage, percent } = motionSpecRollout();
  if (stage === 'on') return true;
  if (stage !== 'canary' || !projectId) return false;
  return stableBucket(projectId) < percent;
}

/** 精确抽帧入口：默认关闭，可由 flag 或 canary 打开。 */
export function isServerFrameEnabled(projectId: string | null | undefined): boolean {
  if (textMotionFlags.overlayServerFrame) return true;
  const { stage, percent } = motionSpecRollout();
  if (stage === 'on') return true;
  if (stage !== 'canary' || !projectId) return false;
  return stableBucket(`${projectId}:frame`) < percent;
}
