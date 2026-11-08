/**
 * GenUI 渲染器：把一份**已校验**的 spec 画成只读结构化视图。
 *
 * 设计要点（与 `pluginLayoutRenderer` 刻意分开，不复用其 schema/状态机）：
 *
 * 1. **渲染前再洗一遍**：外部传进来的 `rawSpec` 一律过 `validateGenUISpec()`。
 *    宿主可能拿到旧缓存 / 被代理改过的响应 / 历史 session 数据，TS 类型保证不了运行时。
 * 2. **逐节点容错**：每个顶层节点包一层 ErrorBoundary —— 一个节点炸了只显示一行占位，
 *    不让整张简报卡白屏。
 * 3. **本地优先**：手风琴用原生 `<details>`、表格排序这类纯 UI 状态不回调宿主；
 *    只有节点显式声明了 `action` **且**宿主给了 `onAction` 时按钮才可点（否则禁用）。
 * 4. **不碰 HTML**：没有 `dangerouslySetInnerHTML`，所有文本走 `asText`，链接不可点（
 *    首版不开放外链资源），模型无法借 spec 注入任何东西。
 */
import React, { useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { asText } from '@/lib/render';
import { cn } from '@/lib/utils';
import { validateGenUISpec } from './validate';
import type { DisplaySpecContract } from './contractSource';
import type { GenUIActionEvent, GenUIActionKind, GenUIActionScope, GenUINode, GenUISpec } from './types';

export interface GenUISpecRendererProps {
  /** 后端给的 spec（可能来自模型、可能脏、可能是空对象） */
  rawSpec: unknown;
  /**
   * 这条 spec 对应的**契约**（来自插件，运行期通过 `/api/plugin/contributions` 下发）。
   * 契约缺失时整块不渲染——前端不猜白名单（能力在插件里）。
   */
  contract?: DisplaySpecContract | null;
  /** 宿主动作回调；不传时所有交互按钮渲染为禁用态（不假装可点） */
  onAction?: (event: GenUIActionEvent) => void;
  /**
   * 宿主**实际支持**的动作类型。节点声明了其它类型（例如只有 ask 可用却写了 confirm）
   * 时按钮渲染为禁用态——不假装可点，也不静默吞掉。
   */
  supportedActions?: readonly GenUIActionKind[];
  /**
   * 这张卡片是简报还是规划书：`confirm` 动作要靠它决定确认哪一个（P4.2）。
   * 其它动作不区分来源；不传时宿主按"未知来源"处理（当前实现会忽略 confirm）。
   */
  scope?: GenUIActionScope;
  /** 只读场景（审阅覆盖层）：不渲染动作控件——避免第二个确认入口，也不摆点不动的按钮 */
  hideActions?: boolean;
  /** 紧凑模式（卡片内嵌时用）：更小的间距与字号 */
  compact?: boolean;
  className?: string;
}

const TONE_TEXT: Record<string, string> = {
  info: 'text-primary',
  success: 'text-track-video',
  warning: 'text-track-audio',
  error: 'text-error',
};

const TONE_BOX: Record<string, string> = {
  info: 'border-primary/25 bg-primary/5',
  success: 'border-track-video/25 bg-track-video/5',
  warning: 'border-track-audio/25 bg-track-audio/5',
  error: 'border-error/25 bg-error/5',
};

const BADGE_BOX: Record<string, string> = {
  success: 'bg-track-video/15 text-track-video border-track-video/30',
  warn: 'bg-track-audio/15 text-track-audio border-track-audio/30',
  danger: 'bg-error/15 text-error border-error/30',
  accent: 'bg-primary/15 text-primary border-primary/30',
};

const TEXT_SIZE: Record<string, string> = {
  display: 'text-headline-sm font-semibold',
  h1: 'text-title-lg font-semibold',
  h2: 'text-title-md font-semibold',
  h3: 'text-title-sm font-medium',
  body: 'text-body-sm',
  muted: 'text-body-sm text-on-surface-variant',
  caption: 'text-caption text-on-surface-variant',
};

/**
 * 动作的**默认**按钮文案。
 *
 * ⚠️ 白名单 ≠ 宿主支持（计划 T4.1）：`GENUI_ACTION_KINDS` 是**词法**契约（老 spec 写
 * `select`/`confirm` 不该被判非法），但**是否可点**由宿主传的 `supportedActions` 决定。
 * 当前只实现 `ask`（→ 发回当前需求会话）；`select`/`confirm` 一律渲染为禁用态——
 * 尤其 `confirm` 不能单击直达，否则等于"模型写的按钮推进状态机"（违反 C10）。
 */
const ACTION_LABEL: Record<string, string> = {
  ask: '继续追问',
  select: '选这个',
  confirm: '确认',
};

/** 单个节点的错误隔离：一个节点炸了只占一行，不牵连兄弟节点。 */
class NodeBoundary extends React.Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { failed: boolean }
> {
  constructor(props: { children: React.ReactNode; fallback: React.ReactNode }) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return this.props.fallback;
    return this.props.children;
  }
}

function ActionControl({
  node, nodeId, onAction, supported, scope,
}: {
  node: GenUINode;
  nodeId: string;
  onAction?: (event: GenUIActionEvent) => void;
  supported?: readonly GenUIActionKind[];
  scope?: GenUIActionScope;
}) {
  const action = node.action;
  if (!action) return null;
  const typeSupported = !supported || supported.includes(action.type);
  const disabled = !onAction || !typeSupported;
  const title = !onAction
    ? '当前位置没有可用的处理回调'
    : !typeSupported
      ? '这个位置不支持该动作'
      : undefined;
  const btnCls = (extra?: string) => cn(
    'inline-flex items-center gap-1 rounded-cw-xs px-2 py-1 text-caption border transition-colors',
    disabled
      ? 'border-outline-variant/30 text-on-surface-variant/40 cursor-not-allowed'
      : 'border-primary/40 text-primary hover:bg-primary/10 cursor-pointer',
    extra,
  );

  // `select`：选项组。宿主收到的是 `{value}`，**发送文案由宿主模板拼**——
  // 模型只能决定"有哪些选项"，不能决定"点下去会说什么"（C3 的延伸）。
  if (action.type === 'select') {
    const rawOptions = action.payload?.options;
    const options = Array.isArray(rawOptions)
      ? rawOptions.filter((x): x is string => typeof x === 'string' && x.trim() !== '')
      : [];
    if (options.length === 0) return null;
    return (
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5" data-genui="select">
        <span className="text-caption text-on-surface-variant">
          {asText(action.label) || ACTION_LABEL.select}
        </span>
        {options.map((option) => (
          <button
            key={option}
            type="button"
            disabled={disabled}
            title={title}
            data-testid={`genui-select-${option}`}
            onClick={() => onAction?.({
              action: { type: 'select', label: action.label, payload: { value: option } },
              nodeId,
              scope,
            })}
            className={btnCls()}
          >
            {asText(option)}
          </button>
        ))}
      </div>
    );
  }

  const label = action.label || ACTION_LABEL[action.type] || action.type;
  return (
    <button
      type="button"
      disabled={disabled}
      title={title}
      data-testid={`genui-action-${action.type}`}
      onClick={() => onAction?.({ action, nodeId, scope })}
      className={btnCls('mt-1.5')}
    >
      {asText(label)}
    </button>
  );
}

/** 行数达到这个阈值才给排序/筛选控件（小表格不堆交互）——计划 T5.1。 */
const TABLE_INTERACTIVE_MIN_ROWS = 8;

/** 纯函数：按列排序（数字列按数值，其余按中文本地化字符串），**不改**原数组。 */
export function sortTableRows(rows: string[][], col: number, dir: 1 | -1): string[][] {
  return [...rows].sort((a, b) => {
    const av = asText(a[col]);
    const bv = asText(b[col]);
    const an = Number(av);
    const bn = Number(bv);
    const bothNumeric =
      av.trim() !== '' && bv.trim() !== '' && Number.isFinite(an) && Number.isFinite(bn);
    if (bothNumeric) return (an - bn) * dir;
    return av.localeCompare(bv, 'zh') * dir;
  });
}

/** 纯函数：跨列子串筛选（大小写不敏感）；`query` 为空时原样返回。 */
export function filterTableRows(rows: string[][], query: string): string[][] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) => row.some((cell) => asText(cell).toLowerCase().includes(q)));
}

/**
 * 表格节点：≥8 行时给**本地**排序 / 筛选（计划 T5.1）。
 *
 * 为什么是本地：排序、筛选是纯 UI 状态，不该回调宿主（不产生请求、不影响会话），
 * 有状态上限（≤100 行 × ≤12 列），前端排一次的成本远低于一次往返。
 * 表头按钮有 `aria-label`；筛选框有 `aria-label`，`data-testid` 供测试稳定选取。
 */
function GenUITableNode({ columns, rows }: { columns: string[]; rows: string[][] }) {
  const [sort, setSort] = useState<{ col: number; dir: 1 | -1 } | null>(null);
  const [query, setQuery] = useState('');
  const interactive = rows.length >= TABLE_INTERACTIVE_MIN_ROWS;
  const visible = useMemo(() => {
    const filtered = interactive ? filterTableRows(rows, query) : rows;
    return sort ? sortTableRows(filtered, sort.col, sort.dir) : filtered;
  }, [rows, query, sort, interactive]);
  const toggleSort = (col: number) => setSort((prev) => (
    prev && prev.col === col ? { col, dir: prev.dir === 1 ? -1 : 1 } : { col, dir: 1 }
  ));
  return (
    <div data-genui="table">
      {interactive && (
        <div className="flex items-center gap-2 mb-1">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="筛选…"
            aria-label="筛选表格"
            data-testid="genui-table-filter"
            className="flex-1 min-w-0 px-2 py-1 rounded-cw-xs bg-surface border border-outline-variant/40 text-caption text-on-surface"
          />
          <span className="text-caption text-on-surface-variant tabular-nums whitespace-nowrap">
            {visible.length}/{rows.length} 行
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-body-sm border-collapse">
          <thead>
            <tr>
              {columns.map((col, i) => (
                <th
                  key={i}
                  className="text-left font-medium text-on-surface-variant border-b border-outline-variant/40 px-1.5 py-1 whitespace-nowrap"
                >
                  {interactive ? (
                    <button
                      type="button"
                      onClick={() => toggleSort(i)}
                      aria-label={`按「${asText(col)}」排序`}
                      data-testid={`genui-table-sort-${i}`}
                      className="inline-flex items-center gap-0.5 hover:text-on-surface cursor-pointer"
                    >
                      {asText(col)}
                      <span className="text-caption">
                        {sort?.col === i ? (sort.dir === 1 ? '↑' : '↓') : '↕'}
                      </span>
                    </button>
                  ) : (
                    asText(col)
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody data-testid="genui-table-body">
            {visible.map((row, ri) => (
              <tr key={ri} className="border-b border-outline-variant/20 last:border-0">
                {row.map((cell, ci) => (
                  <td key={ci} className="px-1.5 py-1 text-on-surface align-top break-words">
                    {asText(cell)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function renderNode(
  node: GenUINode,
  nodeId: string,
  onAction: ((event: GenUIActionEvent) => void) | undefined,
  compact: boolean,
  depth: number,
): React.ReactNode {
  switch (node.type) {
    case 'text': {
      const cls = TEXT_SIZE[node.size || 'body'] || TEXT_SIZE.body;
      const tone = node.tone ? TONE_TEXT[node.tone] || '' : '';
      return (
        <p className={cn(cls, tone, 'whitespace-pre-wrap break-words')} data-genui="text">
          {asText(node.content)}
        </p>
      );
    }
    case 'list': {
      return (
        <ul className="space-y-1" data-genui="list">
          {node.items.map((item, i) => {
            if (typeof item === 'string') {
              return (
                <li key={i} className="text-body-sm text-on-surface flex gap-1.5">
                  <span className="text-on-surface-variant shrink-0">·</span>
                  <span className="break-words">{asText(item)}</span>
                </li>
              );
            }
            return (
              <li key={i} className="text-body-sm text-on-surface">
                <span className="flex gap-1.5">
                  <span className="text-on-surface-variant shrink-0">·</span>
                  <span className="break-words">
                    {asText(item.title)}
                    {item.desc ? (
                      <span className="text-on-surface-variant">：{asText(item.desc)}</span>
                    ) : null}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      );
    }
    case 'callout': {
      return (
        <div
          className={cn('rounded-cw-sm border px-2.5 py-2', TONE_BOX[node.tone] || TONE_BOX.info)}
          data-genui="callout"
        >
          {node.title ? (
            <p className={cn('text-label font-medium mb-0.5', TONE_TEXT[node.tone] || '')}>{asText(node.title)}</p>
          ) : null}
          <p className="text-body-sm text-on-surface whitespace-pre-wrap break-words">{asText(node.content)}</p>
        </div>
      );
    }
    case 'badge': {
      const cls = BADGE_BOX[node.tone || 'accent'] || BADGE_BOX.accent;
      return (
        <span
          className={cn('inline-flex items-center rounded-full border px-2 py-0.5 text-caption', cls)}
          data-genui="badge"
        >
          {asText(node.label)}
        </span>
      );
    }
    case 'stat': {
      return (
        <div data-genui="stat" className="min-w-0">
          <p className="text-caption text-on-surface-variant truncate">{asText(node.label)}</p>
          <p className="text-title-md font-semibold text-on-surface tabular-nums truncate">{asText(node.value)}</p>
          {node.delta ? (
            <p
              className={cn(
                'text-caption tabular-nums',
                asText(node.delta).trim().startsWith('-') ? 'text-error' : 'text-track-video',
              )}
            >
              {asText(node.delta)}
            </p>
          ) : null}
        </div>
      );
    }
    case 'progress': {
      const value = Number.isFinite(node.value) ? Math.max(0, Math.min(100, node.value)) : 0;
      return (
        <div data-genui="progress">
          <div className="flex items-center justify-between text-caption text-on-surface-variant mb-1">
            <span className="truncate">{asText(node.label)}</span>
            <span className="tabular-nums">{asText(node.valueLabel) || `${Math.round(value)}%`}</span>
          </div>
          <div className="h-1.5 rounded-full bg-outline-variant/30 overflow-hidden">
            <div className="h-full bg-primary" style={{ width: `${value}%` }} />
          </div>
        </div>
      );
    }
    case 'table': {
      return <GenUITableNode columns={node.columns} rows={node.rows} />;
    }
    case 'steps': {
      return (
        <ol className="space-y-1.5" data-genui="steps">
          {node.steps.map((step, i) => {
            const active = typeof node.current === 'number' ? i === node.current : false;
            const done = typeof node.current === 'number' ? i < node.current : false;
            return (
              <li key={i} className="flex gap-2 text-body-sm">
                <span
                  className={cn(
                    'shrink-0 w-5 h-5 rounded-full border text-caption flex items-center justify-center tabular-nums',
                    active
                      ? 'border-primary text-primary'
                      : done
                        ? 'border-track-video/40 text-track-video'
                        : 'border-outline-variant/40 text-on-surface-variant',
                  )}
                >
                  {i + 1}
                </span>
                <span className="min-w-0">
                  <span className={cn('block', active ? 'text-on-surface font-medium' : 'text-on-surface')}>
                    {asText(step.title)}
                  </span>
                  {step.desc ? (
                    <span className="block text-caption text-on-surface-variant break-words">{asText(step.desc)}</span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      );
    }
    case 'divider': {
      if (!node.label) return <hr className="border-outline-variant/30" data-genui="divider" />;
      return (
        <div className="flex items-center gap-2" data-genui="divider">
          <span className="h-px flex-1 bg-outline-variant/30" />
          <span className="text-caption text-on-surface-variant">{asText(node.label)}</span>
          <span className="h-px flex-1 bg-outline-variant/30" />
        </div>
      );
    }
    case 'row':
    case 'col': {
      const isRow = node.type === 'row';
      return (
        <div
          data-genui={node.type}
          className={cn(isRow ? 'flex flex-wrap items-start gap-3' : 'flex flex-col gap-2')}
        >
          {node.items.map((child, i) => (
            <NodeBoundary
              key={i}
              fallback={
                <p className="text-caption text-on-surface-variant/60">（这段内容渲染失败）</p>
              }
            >
              {renderNode(child, `${nodeId}.${i}`, onAction, compact, depth + 1)}
            </NodeBoundary>
          ))}
        </div>
      );
    }
    case 'card': {
      return (
        <section
          data-genui="card"
          className={cn(
            'rounded-cw-sm border px-2.5 py-2',
            node.tone ? TONE_BOX[node.tone] || TONE_BOX.info : 'border-outline-variant/30 bg-surface/40',
          )}
        >
          {node.title ? (
            <p className={cn('text-label font-medium mb-1.5', node.tone ? TONE_TEXT[node.tone] || '' : 'text-on-surface')}>
              {asText(node.title)}
            </p>
          ) : null}
          <div className={cn('flex flex-col', compact ? 'gap-1.5' : 'gap-2')}>
            {node.items.map((child, i) => (
              <NodeBoundary
                key={i}
                fallback={
                  <p className="text-caption text-on-surface-variant/60">（这段内容渲染失败）</p>
                }
              >
                {renderNode(child, `${nodeId}.${i}`, onAction, compact, depth + 1)}
              </NodeBoundary>
            ))}
          </div>
        </section>
      );
    }
    case 'accordion': {
      return (
        <div className="flex flex-col gap-1" data-genui="accordion">
          {node.items.map((group, i) => (
            <details key={i} className="rounded-cw-sm border border-outline-variant/30 px-2 py-1.5">
              <summary className="flex items-center gap-1 cursor-pointer text-label text-on-surface list-none">
                <ChevronRight className="w-3 h-3 shrink-0 transition-transform [details[open]_&]:rotate-90" />
                <span className="truncate">{asText(group.title)}</span>
              </summary>
              <div className="flex flex-col gap-1.5 mt-1.5">
                {group.items.map((child, j) => (
                  <NodeBoundary
                    key={j}
                    fallback={<p className="text-caption text-on-surface-variant/60">（这段内容渲染失败）</p>}
                  >
                    {renderNode(child, `${nodeId}.a${i}.${j}`, onAction, compact, depth + 1)}
                  </NodeBoundary>
                ))}
              </div>
            </details>
          ))}
        </div>
      );
    }
    default:
      return (
        <p className="text-caption text-on-surface-variant/70">
          （暂不支持的组件：{asText((node as { type?: unknown }).type)}）
        </p>
      );
  }
}

export function GenUISpecRenderer({
  rawSpec, contract, onAction, supportedActions, scope, hideActions = false,
  compact = false, className,
}: GenUISpecRendererProps) {
  const { spec, problems } = useMemo(
    () => validateGenUISpec(rawSpec, contract),
    [rawSpec, contract],
  );
  // 降级原因只在开发期可见（生产不打扰用户），但保留节点级占位提示
  if (problems.length && typeof console !== 'undefined') {
    console.debug('[genui] spec 已降级', problems.slice(0, 5));
  }
  if (!spec) return null;
  return (
    <div
      data-testid="genui-spec"
      className={cn(compact ? 'flex flex-col gap-1.5' : 'flex flex-col gap-2', className)}
    >
      {spec.items.map((node, i) => {
        const nodeId = `n${i}`;
        return (
          <div key={nodeId} className="min-w-0">
            <NodeBoundary
              fallback={<p className="text-caption text-on-surface-variant/60">（这段内容渲染失败）</p>}
            >
              {renderNode(node, nodeId, onAction, compact, 0)}
            </NodeBoundary>
            {!hideActions && (
              <ActionControl node={node} nodeId={nodeId} onAction={onAction} supported={supportedActions} scope={scope} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/** 给宿主用的小工具：拿到可用 spec 才渲染（避免宿主自己判断形状）。 */
export function useGenUISpec(rawSpec: unknown): GenUISpec | null {
  return useMemo(() => validateGenUISpec(rawSpec).spec, [rawSpec]);
}

/** 测试用：把渲染树里的按钮状态算出来（避免在测试里翻 DOM 结构）。 */
export function genuiActionEnabled(node: GenUINode, onAction?: unknown): boolean {
  return Boolean(node.action) && typeof onAction === 'function';
}

/** 兼容占位：某些宿主可能传 `spec` 而不是 `rawSpec` */
export default GenUISpecRenderer;

// 注：首版那个 `useGenUILocalState` 占位导出已删除——表格排序/筛选（计划 T5.1）现在是
// 真正的本地状态（见 `GenUITableNode`），不需要"给未来扩展"的空壳。
