/**
 * 导出时间线指纹（PRD §20 导出重试拆分）
 *
 * 重试必须能分清两件事：
 * - 「重试本次提交」= 用**提交时的快照**重跑，结果可比较（这才叫重试）；
 * - 「用当前时间线重新提交」= 用户已经改过时间线，跑的是新东西，不能叫重试。
 *
 * 判据是时间线内容的指纹。这里不引第三方 hash：对 `JSON.stringify` 的结果做两轮
 * FNV-1a 32 位，拼成 16 位十六进制——足够区分同一项目内的编辑，且同步、无依赖。
 */
import type { Timeline } from '@/types/timeline';

function _fnv1a(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 时间线内容指纹（16 位 hex）。空/缺失时间线也有稳定指纹，便于显示而不是空白。 */
export function timelineFingerprint(timeline: Timeline | null | undefined): string {
  let json: string;
  try {
    json = JSON.stringify(timeline ?? null);
  } catch {
    // 循环引用等异常情况：明确退化为"无法指纹"，不要假装两次相同
    return 'unhashable';
  }
  const a = _fnv1a(json, 0x811c9dc5);
  const b = _fnv1a(json, 0xcbf29ce4);
  return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0');
}

/** 人读的短指纹（8 位）；完整指纹留在 title 里 */
export function fingerprintLabel(fp: string): string {
  if (!fp || fp === 'unhashable') return '无法计算';
  return fp.slice(0, 8);
}

/** 提交后时间线是否被改过（决定按钮该给「重试」还是多给一个「用当前时间线提交」） */
export function timelineChanged(submitted: string, current: string): boolean {
  return submitted !== current;
}
