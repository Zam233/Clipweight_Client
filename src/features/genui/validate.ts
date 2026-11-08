/**
 * 前端第二道闸：把「可能是模型编的 / 可能是旧缓存」的 spec 洗成可信 spec。
 *
 * **规则全部来自契约**（B4-T4.2）：组件白名单、上限、动作、色调、字号都由
 * `plugins/genui/contract.json` 经 `GET /api/plugin/contributions?kind=display_spec`
 * 下发；前端不再持有自己的白名单。拿不到契约 → **不渲染**（`spec: null`）。
 *
 * 保留的 `MAX_*` / `GENUI_*` 常量只是"前端已实现原语"的编译期闭包，供 CI 子集断言
 * （契约声明的组件/动作必须 ⊆ 前端能渲染的），**不再当校验规则**。
 */
import { asText } from '@/lib/render';
import type { DisplaySpecContract } from './contractSource';
import {
  GENUI_ACTION_KINDS,
  GENUI_COMPONENT_TYPES,
  GENUI_VERSION,
  type GenUIAction,
  type GenUIActionKind,
  type GenUINode,
  type GenUISpec,
  type GenUITextSize,
  type GenUITone,
} from './types';

// ── 前端已实现原语的编译期闭包（只用于 CI 子集断言与类型收敛）──────────
export const MAX_NODES = 100;
export const MAX_DEPTH = 6;
export const MAX_TEXT_CHARS = 4000;
export const MAX_ARRAY_ITEMS = 100;
export const MAX_TABLE_COLS = 12;
export const MAX_ACTION_PAYLOAD_CHARS = 2000;
export const MAX_SPEC_BYTES = 64 * 1024;
export const MAX_SELECT_OPTIONS = 6;
export const MAX_OPTION_CHARS = 40;
export const GENUI_TONES: ReadonlySet<string> = new Set(['info', 'success', 'warning', 'error']);
const BADGE_TONES: ReadonlySet<string> = new Set(['success', 'warn', 'danger', 'accent']);
export const GENUI_TEXT_SIZES: ReadonlySet<string> = new Set([
  'display', 'h1', 'h2', 'h3', 'body', 'muted', 'caption',
]);
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['row', 'col', 'card', 'accordion']);

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** 前端**已实现**的原语（编译期闭包）。契约可以声明更多（A4），多出来的降级为占位。 */
const IMPLEMENTED_COMPONENTS: ReadonlySet<string> = new Set(GENUI_COMPONENT_TYPES);

/** 契约归一后的运行时规则（校验器唯一的事实来源）。 */
interface Rules {
  version: number;
  components: ReadonlySet<string>;
  actions: ReadonlySet<string>;
  tones: ReadonlySet<string>;
  badgeTones: ReadonlySet<string>;
  textSizes: ReadonlySet<string>;
  maxNodes: number;
  maxDepth: number;
  maxTextChars: number;
  maxArrayItems: number;
  maxTableCols: number;
  maxActionPayloadChars: number;
  maxSpecBytes: number;
  maxSelectOptions: number;
  maxOptionChars: number;
}

const DEFAULT_LIMITS: Record<string, number> = {
  max_nodes: MAX_NODES,
  max_depth: MAX_DEPTH,
  max_text_chars: MAX_TEXT_CHARS,
  max_array_items: MAX_ARRAY_ITEMS,
  max_table_cols: MAX_TABLE_COLS,
  max_action_payload_chars: MAX_ACTION_PAYLOAD_CHARS,
  max_spec_bytes: MAX_SPEC_BYTES,
  max_select_options: MAX_SELECT_OPTIONS,
  max_option_chars: MAX_OPTION_CHARS,
};

function limitOf(contract: DisplaySpecContract, key: string): number {
  return contract.limits[key] ?? DEFAULT_LIMITS[key] ?? 0;
}

function rulesFromContract(contract: DisplaySpecContract): Rules {
  return {
    version: contract.version || GENUI_VERSION,
    components: new Set(contract.components),
    actions: new Set(contract.actions),
    tones: new Set(contract.tones),
    badgeTones: new Set(contract.badgeTones),
    textSizes: new Set(contract.textSizes),
    maxNodes: limitOf(contract, 'max_nodes'),
    maxDepth: limitOf(contract, 'max_depth'),
    maxTextChars: limitOf(contract, 'max_text_chars'),
    maxArrayItems: limitOf(contract, 'max_array_items'),
    maxTableCols: limitOf(contract, 'max_table_cols'),
    maxActionPayloadChars: limitOf(contract, 'max_action_payload_chars'),
    maxSpecBytes: limitOf(contract, 'max_spec_bytes'),
    maxSelectOptions: limitOf(contract, 'max_select_options'),
    maxOptionChars: limitOf(contract, 'max_option_chars'),
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

interface CleanContext {
  problems: string[];
  rules: Rules;
  counter: { value: number };
}

function clip(text: string, rules: Rules, limit?: number): string {
  const cap = limit ?? rules.maxTextChars;
  return text.length <= cap ? text : `${text.slice(0, cap)}…（已截断）`;
}

function stripForbidden(node: Record<string, unknown>): void {
  for (const key of Object.keys(node)) {
    if (FORBIDDEN_KEYS.has(key)) delete node[key];
  }
}

function cleanPayload(value: unknown, rules: Rules, depth = 0): unknown {
  if (depth > 2) return null;
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return clip(value, rules, 500);
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => cleanPayload(v, rules, depth + 1));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).slice(0, 20)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      out[k] = cleanPayload(v, rules, depth + 1);
    }
    return out;
  }
  return null;
}

function cleanSelectOptions(payload: unknown, rules: Rules): string[] {
  if (!isPlainObject(payload)) return [];
  const raw = payload.options;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw.slice(0, rules.maxSelectOptions * 2)) {
    if (typeof item !== 'string') continue;
    // 选项是按钮文案：纯截断，不加「…（已截断）」标记（与后端同规则）
    const text = item.trim().slice(0, rules.maxOptionChars);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= rules.maxSelectOptions) break;
  }
  return out;
}

function cleanAction(raw: unknown, rules: Rules, problems: string[]): GenUIAction | undefined {
  if (!isPlainObject(raw)) return undefined;
  const kind = asText(raw.type).trim().toLowerCase();
  if (!rules.actions.has(kind)) {
    problems.push(`动作类型不在白名单：${kind || '空'}`);
    return undefined;
  }
  const action: GenUIAction = { type: kind as GenUIActionKind };
  const label = asText(raw.label).trim();
  if (label) action.label = clip(label, rules, 80);
  const payload = cleanPayload(raw.payload, rules);
  if (isPlainObject(payload) && Object.keys(payload).length > 0) {
    action.payload = payload as Record<string, unknown>;
  }
  if (kind === 'select') {
    const options = cleanSelectOptions(payload, rules);
    if (options.length === 0) {
      problems.push('select 没有可用的 payload.options，动作已丢弃');
      return undefined;
    }
    action.payload = { options };
  }
  try {
    if (JSON.stringify(action).length > rules.maxActionPayloadChars) {
      problems.push('动作载荷超长，已丢弃');
      return { type: action.type };
    }
  } catch {
    return { type: action.type };
  }
  return action;
}

function cleanStringList(raw: unknown, problems: string[], field: string, rules: Rules): string[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) problems.push(`${field} 不是数组，已忽略`);
    return [];
  }
  if (raw.length > rules.maxArrayItems) problems.push(`${field} 超过 ${rules.maxArrayItems} 项，已截断`);
  return raw.slice(0, rules.maxArrayItems).map((x) => clip(asText(x), rules)).filter(Boolean);
}

function cleanListItems(raw: unknown, problems: string[], rules: Rules): Array<string | { title: string; desc: string }> {
  if (!Array.isArray(raw)) {
    problems.push('list.items 不是数组，已忽略');
    return [];
  }
  const out: Array<string | { title: string; desc: string }> = [];
  for (const item of raw.slice(0, rules.maxArrayItems)) {
    if (typeof item === 'string') {
      const text = clip(item, rules);
      if (text) out.push(text);
    } else if (isPlainObject(item)) {
      const title = clip(asText(item.title || item.label), rules);
      const desc = clip(asText(item.desc || item.description), rules);
      if (title || desc) out.push({ title, desc });
    } else {
      problems.push('list 条目既不是字符串也不是对象，已丢弃');
    }
  }
  return out;
}

function cleanTable(raw: Record<string, unknown>, problems: string[], rules: Rules): GenUINode {
  const columns = cleanStringList(raw.columns, problems, 'table.columns', rules).slice(0, rules.maxTableCols);
  if (Array.isArray(raw.columns) && raw.columns.length > rules.maxTableCols) {
    problems.push(`table 列数超过 ${rules.maxTableCols}，已截断`);
  }
  const rows: string[][] = [];
  if (Array.isArray(raw.rows)) {
    if (raw.rows.length > rules.maxArrayItems) problems.push(`table 行数超过 ${rules.maxArrayItems}，已截断`);
    for (const row of raw.rows.slice(0, rules.maxArrayItems)) {
      if (!Array.isArray(row)) continue;
      const cells = row.slice(0, columns.length || rules.maxTableCols).map((c) => clip(asText(c), rules, 500));
      if (cells.length) rows.push(cells);
    }
  } else {
    problems.push('table.rows 不是数组，已忽略');
  }
  return { type: 'table', columns, rows };
}

function cleanSteps(raw: Record<string, unknown>, problems: string[], rules: Rules): GenUINode {
  const steps: Array<{ title: string; desc?: string }> = [];
  if (!Array.isArray(raw.steps)) {
    problems.push('steps.steps 不是数组，已忽略');
  } else {
    for (const item of raw.steps.slice(0, rules.maxArrayItems)) {
      if (typeof item === 'string' && item.trim()) steps.push({ title: clip(item, rules) });
      else if (isPlainObject(item)) {
        const title = clip(asText(item.title), rules);
        const desc = clip(asText(item.desc), rules);
        if (title) steps.push({ title, ...(desc ? { desc } : {}) });
      }
    }
  }
  const node: Extract<GenUINode, { type: 'steps' }> = { type: 'steps', steps };
  if (typeof raw.current === 'number' && !Number.isNaN(raw.current)) {
    node.current = Math.max(0, Math.min(raw.current, Math.max(steps.length - 1, 0)));
  }
  return node;
}

function cleanNode(raw: unknown, depth: number, ctx: CleanContext): GenUINode | null {
  const { rules, problems } = ctx;
  if (depth > rules.maxDepth) {
    problems.push(`嵌套超过 ${rules.maxDepth} 层，以下节点已丢弃`);
    return null;
  }
  if (!isPlainObject(raw)) {
    problems.push('节点不是对象，已丢弃');
    return null;
  }
  stripForbidden(raw);
  const kind = asText(raw.type).trim().toLowerCase();
  if (!rules.components.has(kind)) {
    problems.push(`契约未声明的组件已降级为占位：${kind || '空'}`);
    return { type: 'text', content: `（暂不支持的组件：${kind || '空'}）`, size: 'muted' };
  }
  if (!IMPLEMENTED_COMPONENTS.has(kind)) {
    // 契约声明了、但前端这一版还没有渲染器（A4 的硬边界：新原语必须发前端版本）
    problems.push(`契约声明了前端未实现的组件，已降级为占位：${kind}`);
    return { type: 'text', content: `（前端暂不支持的组件：${kind}）`, size: 'muted' };
  }
  ctx.counter.value += 1;
  if (ctx.counter.value > rules.maxNodes) return null;

  let node: GenUINode;
  switch (kind) {
    case 'text': {
      const tone = asText(raw.tone).trim().toLowerCase();
      const size = asText(raw.size).trim().toLowerCase();
      node = {
        type: 'text',
        content: clip(asText(raw.content), rules),
        ...(rules.textSizes.has(size) ? { size: size as GenUITextSize } : {}),
        ...(rules.tones.has(tone) ? { tone: tone as GenUITone } : {}),
      };
      break;
    }
    case 'list':
      node = { type: 'list', items: cleanListItems(raw.items, problems, rules) };
      break;
    case 'callout': {
      const tone = asText(raw.tone).trim().toLowerCase();
      const title = clip(asText(raw.title), rules, 120);
      node = {
        type: 'callout',
        tone: (rules.tones.has(tone) ? tone : 'info') as GenUITone,
        content: clip(asText(raw.content), rules),
        ...(title ? { title } : {}),
      };
      break;
    }
    case 'badge': {
      const tone = asText(raw.tone).trim().toLowerCase();
      node = {
        type: 'badge',
        label: clip(asText(raw.label), rules, 60),
        ...(rules.badgeTones.has(tone) ? { tone: tone as 'success' | 'warn' | 'danger' | 'accent' } : {}),
      };
      break;
    }
    case 'stat': {
      const delta = clip(asText(raw.delta), rules, 40);
      node = {
        type: 'stat',
        label: clip(asText(raw.label), rules, 80),
        value: clip(asText(raw.value), rules, 80),
        ...(delta ? { delta } : {}),
      };
      break;
    }
    case 'progress': {
      const value = Number.isFinite(Number(raw.value)) ? Number(raw.value) : 0;
      const label = clip(asText(raw.label), rules, 80);
      const valueLabel = clip(asText(raw.valueLabel), rules, 40);
      node = {
        type: 'progress',
        value: Math.max(0, Math.min(100, value)),
        ...(label ? { label } : {}),
        ...(valueLabel ? { valueLabel } : {}),
      };
      break;
    }
    case 'table':
      node = cleanTable(raw, problems, rules);
      break;
    case 'steps':
      node = cleanSteps(raw, problems, rules);
      break;
    case 'divider': {
      const label = clip(asText(raw.label), rules, 80);
      node = { type: 'divider', ...(label ? { label } : {}) };
      break;
    }
    case 'row':
    case 'col': {
      const items: GenUINode[] = [];
      if (Array.isArray(raw.items)) {
        for (const child of raw.items) {
          const cleaned = cleanNode(child, depth + 1, ctx);
          if (cleaned) items.push(cleaned);
        }
      }
      node = { type: kind, items };
      break;
    }
    case 'card': {
      const items: GenUINode[] = [];
      if (Array.isArray(raw.items)) {
        for (const child of raw.items) {
          const cleaned = cleanNode(child, depth + 1, ctx);
          if (cleaned) items.push(cleaned);
        }
      }
      const title = clip(asText(raw.title), rules, 120);
      const tone = asText(raw.tone).trim().toLowerCase();
      node = {
        type: 'card',
        items,
        ...(title ? { title } : {}),
        ...(rules.tones.has(tone) ? { tone: tone as GenUITone } : {}),
      };
      break;
    }
    default: {
      // accordion
      const groups: Array<{ title: string; items: GenUINode[] }> = [];
      if (Array.isArray(raw.items)) {
        for (const child of raw.items.slice(0, rules.maxArrayItems)) {
          if (!isPlainObject(child)) continue;
          const inner: GenUINode[] = [];
          if (Array.isArray(child.items)) {
            for (const g of child.items) {
              const cleaned = cleanNode(g, depth + 1, ctx);
              if (cleaned) inner.push(cleaned);
            }
          }
          groups.push({ title: clip(asText(child.title), rules, 120), items: inner });
        }
      }
      node = { type: 'accordion', items: groups };
      break;
    }
  }

  const action = cleanAction(raw.action, rules, problems);
  if (action) node.action = action;
  return node;
}

export interface ValidateResult {
  spec: GenUISpec | null;
  problems: string[];
}

export const NO_CONTRACT_PROBLEM = '无可用的 display_spec 契约（插件未安装或被禁用）';

/**
 * 按契约校验并清洗 spec。**没有契约就不渲染**（`spec: null`）——
 * 能力在插件里，插件不在就没有规则可依，猜一套白名单只会造成"契约漂移"。
 */
export function validateGenUISpec(raw: unknown, contract?: DisplaySpecContract | null): ValidateResult {
  if (!contract) return { spec: null, problems: [NO_CONTRACT_PROBLEM] };
  const rules = rulesFromContract(contract);
  const problems: string[] = [];
  if (raw === null || raw === undefined || raw === '' || raw === false) return { spec: null, problems };
  if (!isPlainObject(raw)) return { spec: null, problems: ['spec 顶层不是对象'] };
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    return { spec: null, problems: ['spec.items 缺失或为空'] };
  }
  const versionRaw = raw.version ?? rules.version;
  const version = Number(versionRaw);
  if (!Number.isFinite(version) || version !== rules.version) {
    return { spec: null, problems: [`不支持的 spec 版本：${String(versionRaw)}`] };
  }

  const ctx: CleanContext = { problems, rules, counter: { value: 0 } };
  const items: GenUINode[] = [];
  for (const entry of raw.items) {
    const cleaned = cleanNode(entry, 1, ctx);
    if (cleaned) items.push(cleaned);
  }
  if (items.length === 0) {
    return { spec: null, problems: [...problems, '清洗后没有任何可用节点'] };
  }
  // `GenUISpec.version` 是字面量 `1`（前端只认这一版）；契约版本不匹配已在上面拒绝。
  const spec: GenUISpec = { version: GENUI_VERSION, items };
  const title = clip(asText(raw.title), rules, 120);
  if (title) spec.title = title;
  const source = asText(raw.source);
  if (source) spec.source = source;
  // 体量检查放在**清洗之后**：后端丢的东西前端不该照渲（字符数近似字节，与后端同口径）
  try {
    if (JSON.stringify(spec).length > rules.maxSpecBytes) {
      return { spec: null, problems: [...problems, `spec 超过 ${rules.maxSpecBytes} 字符，整块丢弃`] };
    }
  } catch {
    return { spec: null, problems: [...problems, 'spec 无法序列化（含非 JSON 值）'] };
  }
  return { spec, problems };
}

/** 便捷判定：有契约且 spec 可用才算 true（宿主用来决定要不要渲染展示块）。 */
export function hasGenUI(raw: unknown, contract?: DisplaySpecContract | null): boolean {
  return validateGenUISpec(raw, contract).spec !== null;
}

/** 编译期闭包（CI 子集断言用）：前端能渲染的组件/动作/容器集合。 */
export function implementedPrimitives(): {
  components: ReadonlySet<string>;
  actions: ReadonlySet<string>;
  containers: ReadonlySet<string>;
} {
  return {
    components: new Set(GENUI_COMPONENT_TYPES),
    actions: new Set(GENUI_ACTION_KINDS),
    containers: new Set(CONTAINER_TYPES),
  };
}

export { BADGE_TONES, CONTAINER_TYPES, GENUI_COMPONENT_TYPES };
