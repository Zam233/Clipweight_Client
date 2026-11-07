/**
 * GenUI spec 的前端运行时校验（镜像后端 `clipwright/schema/genui.py::sanitize_spec`）。
 *
 * **为什么要第二道闸**：后端只校验它自己那条写路径。前端还可能拿到
 * 旧缓存、被代理改过的响应、历史 session（写于没有校验器的版本）、以及将来别的插件
 * 直接塞进来的数据。所以渲染前一律重洗一遍——**类型系统的保证只到编译期**。
 *
 * 规则与后端逐条对应：未知组件 → 占位文本（兄弟节点保留）；危险键剔除；
 * 非法动作丢弃；超长文本截断；表格列/行、节点数、嵌套深度有上限；
 * 顶层版本不符或清洗后不可用 → 返回 `null`（宿主显示原有内容，不显示空白块）。
 */
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

// 上限与后端 `clipwright/schema/genui.py` 一一对应，统一真相在
// `contract.json`（后端 `genui_contract.json` 的逐字节副本）；
// `genui.test.tsx::ContractSingleSource` 逐项断言常量与 JSON 相等，改一边忘另一边会红。
export const MAX_NODES = 100;
export const MAX_DEPTH = 6;
export const MAX_TEXT_CHARS = 4000;
export const MAX_ARRAY_ITEMS = 100;
export const MAX_TABLE_COLS = 12;
export const MAX_ACTION_PAYLOAD_CHARS = 2000;
/**
 * 整块上限（计划 T3.2 补齐；后端 `MAX_SPEC_BYTES` 同值）。
 * 量的是**清洗后**的 `JSON.stringify(spec).length`——字符数近似字节，与后端
 * `len(json.dumps(spec, ensure_ascii=False))` 同口径（中文按 1 个字符算）。
 */
export const MAX_SPEC_BYTES = 64 * 1024;
/** `select` 动作的选项上限（与后端 / `contract.json` 同值，计划 T4.2）。 */
export const MAX_SELECT_OPTIONS = 6;
/** 单个选项文案上限。 */
export const MAX_OPTION_CHARS = 40;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
export const GENUI_TONES: ReadonlySet<string> = new Set(['info', 'success', 'warning', 'error']);
const BADGE_TONES: ReadonlySet<string> = new Set(['success', 'warn', 'danger', 'accent']);
export const GENUI_TEXT_SIZES: ReadonlySet<string> = new Set(['display', 'h1', 'h2', 'h3', 'body', 'muted', 'caption']);
const CONTAINER_TYPES: ReadonlySet<string> = new Set(['row', 'col', 'card', 'accordion']);

export interface GenUIValidateResult {
  spec: GenUISpec | null;
  problems: string[];
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return '';
}

function clip(text: string, limit = MAX_TEXT_CHARS): string {
  return text.length <= limit ? text : `${text.slice(0, limit)}…（已截断）`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stripForbidden(node: Record<string, unknown>): void {
  for (const key of Object.keys(node)) {
    if (FORBIDDEN_KEYS.has(key)) delete node[key];
  }
}

function cleanPayload(value: unknown, depth = 0): unknown {
  if (depth > 2) return null;
  if (typeof value === 'string') return clip(value, 500);
  if (typeof value === 'number' || typeof value === 'boolean' || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => cleanPayload(v, depth + 1));
  if (isPlainObject(value)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value).slice(0, 20)) {
      if (FORBIDDEN_KEYS.has(k)) continue;
      out[k] = cleanPayload(v, depth + 1);
    }
    return out;
  }
  return null;
}

function cleanAction(raw: unknown, problems: string[]): GenUIAction | undefined {
  if (!isPlainObject(raw)) return undefined;
  const kind = asText(raw.type).trim().toLowerCase();
  if (!(GENUI_ACTION_KINDS as readonly string[]).includes(kind)) {
    problems.push(`动作类型不在白名单：${kind || '空'}`);
    return undefined;
  }
  const action: GenUIAction = { type: kind as GenUIActionKind };
  const label = asText(raw.label).trim();
  if (label) action.label = clip(label, 80);
  const payload = cleanPayload(raw.payload);
  if (isPlainObject(payload) && Object.keys(payload).length > 0) {
    action.payload = payload as Record<string, unknown>;
  }
  if (kind === 'select') {
    // 与后端 `_clean_select_options` 同规则：只收非空字符串、去重保序、逐项截断、总数封顶。
    // 没有可用选项的 select 按钮点了什么也不会发生 → 整个动作丢弃（节点照常显示）。
    const options = cleanSelectOptions(payload);
    if (options.length === 0) {
      problems.push('select 没有可用的 payload.options，动作已丢弃');
      return undefined;
    }
    action.payload = { options };
  }
  try {
    if (JSON.stringify(action).length > MAX_ACTION_PAYLOAD_CHARS) {
      problems.push('动作载荷超长，已丢弃');
      return { type: action.type };
    }
  } catch {
    return { type: action.type };
  }
  return action;
}

function cleanSelectOptions(payload: unknown): string[] {
  if (!isPlainObject(payload)) return [];
  const raw = payload.options;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw.slice(0, MAX_SELECT_OPTIONS * 2)) {
    if (typeof item !== 'string') continue;
    // 选项是按钮文案：**纯截断**，不加「…（已截断）」标记（与后端同规则）
    const text = item.trim().slice(0, MAX_OPTION_CHARS);
    if (text && !out.includes(text)) out.push(text);
    if (out.length >= MAX_SELECT_OPTIONS) break;
  }
  return out;
}

function cleanStringList(raw: unknown, problems: string[], field: string): string[] {
  if (!Array.isArray(raw)) {
    if (raw !== undefined && raw !== null) problems.push(`${field} 不是数组，已忽略`);
    return [];
  }
  if (raw.length > MAX_ARRAY_ITEMS) problems.push(`${field} 超过 ${MAX_ARRAY_ITEMS} 项，已截断`);
  return raw.slice(0, MAX_ARRAY_ITEMS).map((x) => clip(asText(x))).filter(Boolean);
}

function cleanListItems(raw: unknown, problems: string[]): Array<string | { title: string; desc: string }> {
  if (!Array.isArray(raw)) {
    problems.push('list.items 不是数组，已忽略');
    return [];
  }
  const out: Array<string | { title: string; desc: string }> = [];
  for (const item of raw.slice(0, MAX_ARRAY_ITEMS)) {
    if (typeof item === 'string') {
      const text = clip(item);
      if (text) out.push(text);
    } else if (isPlainObject(item)) {
      const title = clip(asText(item.title ?? item.label));
      const desc = clip(asText(item.desc ?? item.description));
      if (title || desc) out.push({ title, desc });
    } else {
      problems.push('list 条目既不是字符串也不是对象，已丢弃');
    }
  }
  return out;
}

function cleanTable(node: Record<string, unknown>, problems: string[]): GenUINode {
  let columns = cleanStringList(node.columns, problems, 'table.columns');
  if (columns.length > MAX_TABLE_COLS) {
    problems.push(`table 列数超过 ${MAX_TABLE_COLS}，已截断`);
    columns = columns.slice(0, MAX_TABLE_COLS);
  }
  const rows: string[][] = [];
  if (Array.isArray(node.rows)) {
    if (node.rows.length > MAX_ARRAY_ITEMS) problems.push(`table 行数超过 ${MAX_ARRAY_ITEMS}，已截断`);
    for (const row of node.rows.slice(0, MAX_ARRAY_ITEMS)) {
      if (!Array.isArray(row)) continue;
      const cells = row.slice(0, columns.length || MAX_TABLE_COLS).map((c) => clip(asText(c), 500));
      if (cells.length) rows.push(cells);
    }
  } else {
    problems.push('table.rows 不是数组，已忽略');
  }
  return { type: 'table', columns, rows };
}

function cleanSteps(node: Record<string, unknown>, problems: string[]): GenUINode {
  const raw = node.steps;
  if (!Array.isArray(raw)) {
    problems.push('steps.steps 不是数组，已忽略');
    return { type: 'steps', steps: [] };
  }
  const steps: Array<{ title: string; desc?: string }> = [];
  for (const item of raw.slice(0, MAX_ARRAY_ITEMS)) {
    if (typeof item === 'string') {
      if (item.trim()) steps.push({ title: clip(item) });
    } else if (isPlainObject(item)) {
      const title = clip(asText(item.title));
      if (!title) continue;
      const desc = clip(asText(item.desc));
      steps.push(desc ? { title, desc } : { title });
    }
  }
  const out: GenUINode = { type: 'steps', steps };
  const current = node.current;
  if (typeof current === 'number' && Number.isInteger(current) && current >= 0) {
    out.current = Math.min(current, Math.max(steps.length - 1, 0));
  }
  return out;
}

interface CleanContext {
  problems: string[];
  counter: { value: number };
}

function cleanNode(raw: unknown, depth: number, ctx: CleanContext): GenUINode | null {
  if (depth > MAX_DEPTH) {
    ctx.problems.push(`嵌套超过 ${MAX_DEPTH} 层，以下节点已丢弃`);
    return null;
  }
  if (!isPlainObject(raw)) {
    ctx.problems.push('节点不是对象，已丢弃');
    return null;
  }
  stripForbidden(raw);
  const kind = asText(raw.type).trim().toLowerCase();
  if (!(GENUI_COMPONENT_TYPES as readonly string[]).includes(kind)) {
    ctx.problems.push(`未知组件已降级为占位：${kind || '空'}`);
    return { type: 'text', content: `（暂不支持的组件：${kind || '空'}）`, size: 'muted' };
  }
  ctx.counter.value += 1;
  if (ctx.counter.value > MAX_NODES) return null;

  let node: GenUINode;
  switch (kind) {
    case 'text': {
      const size = asText(raw.size).trim().toLowerCase();
      const tone = asText(raw.tone).trim().toLowerCase();
      node = { type: 'text', content: clip(asText(raw.content)) };
      if (GENUI_TEXT_SIZES.has(size)) node.size = size as GenUITextSize;
      if (GENUI_TONES.has(tone)) node.tone = tone as GenUITone;
      break;
    }
    case 'list':
      node = { type: 'list', items: cleanListItems(raw.items, ctx.problems) };
      break;
    case 'callout': {
      const tone = asText(raw.tone).trim().toLowerCase();
      node = {
        type: 'callout',
        tone: (GENUI_TONES.has(tone) ? tone : 'info') as GenUITone,
        content: clip(asText(raw.content)),
      };
      const title = clip(asText(raw.title), 120);
      if (title) node.title = title;
      break;
    }
    case 'badge': {
      const tone = asText(raw.tone).trim().toLowerCase();
      node = { type: 'badge', label: clip(asText(raw.label), 60) };
      if (BADGE_TONES.has(tone)) node.tone = tone as 'success' | 'warn' | 'danger' | 'accent';
      break;
    }
    case 'stat': {
      node = {
        type: 'stat',
        label: clip(asText(raw.label), 80),
        value: clip(asText(raw.value), 80),
      };
      const delta = clip(asText(raw.delta), 40);
      if (delta) node.delta = delta;
      break;
    }
    case 'progress': {
      const value = typeof raw.value === 'number' && Number.isFinite(raw.value) ? raw.value : 0;
      node = { type: 'progress', value: Math.max(0, Math.min(100, value)) };
      const label = clip(asText(raw.label), 80);
      if (label) node.label = label;
      const valueLabel = clip(asText(raw.valueLabel), 40);
      if (valueLabel) node.valueLabel = valueLabel;
      break;
    }
    case 'table':
      node = cleanTable(raw, ctx.problems);
      break;
    case 'steps':
      node = cleanSteps(raw, ctx.problems);
      break;
    case 'divider': {
      node = { type: 'divider' };
      const label = clip(asText(raw.label), 80);
      if (label) node.label = label;
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
      node = { type: 'card', items };
      const title = clip(asText(raw.title), 120);
      if (title) node.title = title;
      const tone = asText(raw.tone).trim().toLowerCase();
      if (GENUI_TONES.has(tone)) node.tone = tone as GenUITone;
      break;
    }
    case 'accordion': {
      const items: Array<{ title: string; items: GenUINode[] }> = [];
      if (Array.isArray(raw.items)) {
        for (const child of raw.items.slice(0, MAX_ARRAY_ITEMS)) {
          if (!isPlainObject(child)) continue;
          const inner: GenUINode[] = [];
          if (Array.isArray(child.items)) {
            for (const g of child.items) {
              const cleaned = cleanNode(g, depth + 1, ctx);
              if (cleaned) inner.push(cleaned);
            }
          }
          items.push({ title: clip(asText(child.title), 120), items: inner });
        }
      }
      node = { type: 'accordion', items };
      break;
    }
    default:
      // 白名单已拦过；这里只为类型收敛
      return null;
  }

  const action = cleanAction(raw.action, ctx.problems);
  if (action) node.action = action;
  return node;
}

/** 把任意输入洗成可信 spec；`null` 表示"这块没有可用 spec"。 */
export function validateGenUISpec(raw: unknown): GenUIValidateResult {
  const problems: string[] = [];
  if (raw === null || raw === undefined || raw === '' ) return { spec: null, problems };
  if (Array.isArray(raw) && raw.length === 0) return { spec: null, problems };
  if (!isPlainObject(raw)) return { spec: null, problems: ['spec 顶层不是对象'] };

  const versionRaw = raw.version ?? GENUI_VERSION;
  const version = Number(versionRaw);
  if (!Number.isFinite(version) || version !== GENUI_VERSION) {
    return { spec: null, problems: [`不支持的 spec 版本：${String(versionRaw)}`] };
  }
  if (!Array.isArray(raw.items) || raw.items.length === 0) {
    return { spec: null, problems: ['spec.items 缺失或为空'] };
  }

  const ctx: CleanContext = { problems, counter: { value: 0 } };
  const items: GenUINode[] = [];
  for (const entry of raw.items) {
    const cleaned = cleanNode(entry, 1, ctx);
    if (cleaned) items.push(cleaned);
  }
  if (items.length === 0) {
    return { spec: null, problems: [...problems, '清洗后没有任何可用节点'] };
  }
  const spec: GenUISpec = { version: GENUI_VERSION, items };
  const title = clip(asText(raw.title), 120);
  if (title) spec.title = title;
  const source = asText(raw.source);
  if (source) spec.source = source;
  // 体量检查放在**清洗之后**（T3.2）：后端丢的东西前端不该照渲。字符数近似字节，
  // 与后端 `len(json.dumps(spec, ensure_ascii=False))` 同口径。
  try {
    if (JSON.stringify(spec).length > MAX_SPEC_BYTES) {
      return { spec: null, problems: [...problems, `spec 超过 ${MAX_SPEC_BYTES} 字符，整块丢弃`] };
    }
  } catch {
    return { spec: null, problems: [...problems, 'spec 无法序列化（含非 JSON 值）'] };
  }
  return { spec, problems };
}

/** 便捷判定：有可用 spec 才算 true（宿主用来决定要不要渲染 GenUI 块）。 */
export function hasGenUI(raw: unknown): boolean {
  return validateGenUISpec(raw).spec !== null;
}

export { CONTAINER_TYPES };
