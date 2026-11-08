/**
 * V32 负时间片头的前端口径。
 *
 * 后端 `preroll_sec` 的约束是 0–15 秒；前端只负责把用户输入归一成合法值，
 * 不做"猜他想填多少"的兜底：非法/负数一律归 0（= 无片头），超上限截到 15。
 */

export const MAX_PREROLL_SEC = 15;

export function clampPreroll(raw: string | number): number {
  const value = typeof raw === 'number' ? raw : Number.parseFloat(raw);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(MAX_PREROLL_SEC, Math.round(value * 10) / 10);
}

/** 提交时是否要带 `preroll_sec`（0 不传，保持后端默认行为）。 */
export function prerollPayload(seconds: number): { preroll_sec: number } | Record<string, never> {
  return seconds > 0 ? { preroll_sec: seconds } : {};
}
