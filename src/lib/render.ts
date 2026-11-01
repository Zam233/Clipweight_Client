/**
 * 渲染安全阀：后端字段进 JSX 之前一律过一遍。
 *
 * 为什么需要它（2026-10-31 用户实测）：
 * 界面上出现 `Objects are not valid as a React child (found: object with keys {name})`，
 * 整页被 ErrorBoundary 兜住变成「界面渲染中断」。根因是某些后端/模型产物字段的**运行时
 * 形状**和 TypeScript 声明不一致——声明 `string` 的地方实际来了 `{"name": "..."}`。
 * TS 在编译期管不了接口数据，所以必须在渲染边界做一次**运行时**收口。
 *
 * 纪律：
 * - 标量（string/number/boolean）原样返回（空串、0、false 都要保留）；
 * - null/undefined → 空串，不渲染出 "null"；
 * - 对象/数组 → JSON 文本（宁可让人看到结构化原文，也不要白屏）；
 * - React 元素（带 `$$typeof` 标记）**不**走 JSON，原样透传。
 */

/** 任何值 → 可以安全放进 JSX 的字符串。 */
export function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  const t = typeof value;
  if (t === 'string') return value as string;
  if (t === 'number' || t === 'boolean' || t === 'bigint') return String(value);
  if (t === 'function' || t === 'symbol') return '';
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/** 把未知值收成一个可渲染的节点：React 元素透传，其余交给 asText。 */
export function asNode(value: unknown): unknown {
  if (value === null || value === undefined) return '';
  const t = typeof value;
  if (t === 'string' || t === 'number' || t === 'boolean') return value;
  if (t === 'object' && (value as { $$typeof?: unknown }).$$typeof) return value;
  return asText(value);
}

/** 列表字段的安全字符串数组（`[{name}]` 这种脏数据不会把页面炸掉）。 */
export function textList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((v) => {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        const rec = v as Record<string, unknown>;
        const preferred = rec.name ?? rec.label ?? rec.title ?? rec.text ?? rec.id;
        if (typeof preferred === 'string' && preferred) return preferred;
      }
      return asText(v);
    })
    .filter((s) => s !== '');
}
