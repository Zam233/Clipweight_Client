/**
 * GenUI 展示 spec 的类型契约（与后端 `clipwright/schema/genui.py` 一一对应）。
 *
 * **它是什么**：一份只用于展示的 JSON（`version: 1` + 组件 `items` 树），出现在创意简报、
 * 规划书、右侧 agent 副驾驶的卡片里。参考实现是 DSH 的 `dsh-genui`（`dsh-ui` 围栏），
 * 这里刻意只取**安全子集**：13 类纯 React 组件，无 HTML/脚本/CSS/远端图表引擎。
 *
 * **三条纪律**（与后端一致）：
 * 1. 权威数据不在 spec 里 —— `CreativeBrief` / 规划书 markdown 才是确认与执行的对象；
 * 2. 不信任模型输出 —— 拿到什么都先过 `validateGenUISpec()`（见 `validate.ts`）；
 * 3. 可缺省 —— 没有 spec 时卡片显示原有内容，不显示空白块。
 */

export const GENUI_VERSION = 1 as const;

/** 组件白名单（必须与后端 `GENUI_COMPONENT_TYPES` 一致）。 */
export const GENUI_COMPONENT_TYPES = [
  'text', 'list', 'callout', 'badge', 'stat', 'progress', 'table',
  'steps', 'divider', 'row', 'col', 'card', 'accordion',
] as const;

export type GenUIComponentType = (typeof GENUI_COMPONENT_TYPES)[number];

/** 宿主已实现的动作（**不含** endpoint / URL / method / 任意能力名）。 */
export const GENUI_ACTION_KINDS = ['ask', 'select', 'confirm'] as const;
export type GenUIActionKind = (typeof GENUI_ACTION_KINDS)[number];

export type GenUITone = 'info' | 'success' | 'warning' | 'error';
export type GenUIStatTone = 'success' | 'warn' | 'danger' | 'accent';
export type GenUITextSize = 'display' | 'h1' | 'h2' | 'h3' | 'body' | 'muted' | 'caption';

export interface GenUIAction {
  type: GenUIActionKind;
  label?: string;
  /** 只允许标量与浅层容器（校验器会剔除其它东西） */
  payload?: Record<string, unknown>;
}

interface GenUINodeBase {
  /** 可选交互：没有宿主回调时按钮渲染为禁用态（不假装可点） */
  action?: GenUIAction;
}

export interface GenUITextNode extends GenUINodeBase {
  type: 'text';
  content: string;
  size?: GenUITextSize;
  tone?: GenUITone;
}

export interface GenUIListNode extends GenUINodeBase {
  type: 'list';
  items: Array<string | { title: string; desc: string }>;
}

export interface GenUICalloutNode extends GenUINodeBase {
  type: 'callout';
  tone: GenUITone;
  content: string;
  title?: string;
}

export interface GenUIBadgeNode extends GenUINodeBase {
  type: 'badge';
  label: string;
  tone?: GenUIStatTone;
}

export interface GenUIStatNode extends GenUINodeBase {
  type: 'stat';
  label: string;
  value: string;
  delta?: string;
}

export interface GenUIProgressNode extends GenUINodeBase {
  type: 'progress';
  value: number;
  label?: string;
  valueLabel?: string;
}

export interface GenUITableNode extends GenUINodeBase {
  type: 'table';
  columns: string[];
  rows: string[][];
}

export interface GenUIStepsNode extends GenUINodeBase {
  type: 'steps';
  steps: Array<{ title: string; desc?: string }>;
  current?: number;
}

export interface GenUIDividerNode extends GenUINodeBase {
  type: 'divider';
  label?: string;
}

export interface GenUIContainerNode extends GenUINodeBase {
  type: 'row' | 'col';
  items: GenUINode[];
}

export interface GenUICardNode extends GenUINodeBase {
  type: 'card';
  title?: string;
  tone?: GenUITone;
  items: GenUINode[];
}

export interface GenUIAccordionNode extends GenUINodeBase {
  type: 'accordion';
  items: Array<{ title: string; items: GenUINode[] }>;
}

export type GenUINode =
  | GenUITextNode
  | GenUIListNode
  | GenUICalloutNode
  | GenUIBadgeNode
  | GenUIStatNode
  | GenUIProgressNode
  | GenUITableNode
  | GenUIStepsNode
  | GenUIDividerNode
  | GenUIContainerNode
  | GenUICardNode
  | GenUIAccordionNode;

export interface GenUISpec {
  version: typeof GENUI_VERSION;
  title?: string;
  /** 谁产出的（`brief` / `plan`），仅诊断用 */
  source?: string;
  items: GenUINode[];
}

/** 动作来自哪类卡片：宿主据此把 `confirm` 路由到对应确认回调（P4.2）。 */
export type GenUIActionScope = 'brief' | 'plan';

/** 宿主接到的动作（渲染器把节点里的 action + 节点上下文一起交回来）。 */
export interface GenUIActionEvent {
  action: GenUIAction;
  /** 触发它的节点 id（渲染时生成的稳定路径，用于日志/去重） */
  nodeId: string;
  title?: string;
  /** 卡片归属；`confirm` 必须靠它决定"确认的是简报还是规划书" */
  scope?: GenUIActionScope;
}
