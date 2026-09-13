/**
 * 插件插槽契约 —— 可贡献的前端扩展点（方案 D / M1 契约冻结）。
 *
 * 名单冻结：新增 slot 需走 SlotRegistry 的契约评审（见
 * docs/pluginization-plan-2026-09-10.md §6 D-0）。
 *
 * 契约纪律：
 * - icon 走白名单（渲染器无法解析的图标名直接丢弃）；
 * - visibleWhen 是受限表达式（路径 + 比较），禁止 eval；
 * - payload 的 schema 按 slot 分别定义（见 D-3 表）。
 */

/** 可贡献的插槽 —— 名单冻结。 */
export type SlotName =
  | 'nav.primary'          // 主导航项（首页/项目/人格/音色旁）
  | 'nav.settings'         // 管理控制台导航项（ConsoleShell 侧栏）
  | 'page'                 // 独立页面（走统一 PluginPage 壳，不支持任意 JS）
  | 'editor.left-panel'
  | 'editor.right-panel'
  | 'editor.bottom-panel'
  | 'editor.toolbar'       // 工具栏按钮/组
  | 'timeline.tool'        // 时间轴工具（与剃刀/范围同级）
  | 'timeline.context-menu'// 时间轴右键菜单项
  | 'props.section'        // 属性面板分区（按 clip kind 过滤）
  | 'export.preset'        // 导出预设
  | 'settings.section'     // 设置页分区
  | 'shortcut';            // 快捷键

export const SLOT_NAMES: readonly SlotName[] = [
  'nav.primary',
  'nav.settings',
  'page',
  'editor.left-panel',
  'editor.right-panel',
  'editor.bottom-panel',
  'editor.toolbar',
  'timeline.tool',
  'timeline.context-menu',
  'props.section',
  'export.preset',
  'settings.section',
  'shortcut',
] as const;

/** lucide 图标白名单（渲染器仅能解析这些名字）。 */
export const SLOT_ICON_WHITELIST: readonly string[] = [
  'Activity', 'AlertCircle', 'AudioLines', 'BookOpen', 'Boxes', 'ChartBar',
  'Check', 'Circle', 'Clock', 'Database', 'Download', 'FileText', 'Film',
  'FolderOpen', 'Gauge', 'GitBranch', 'Globe', 'Image', 'LayoutPanelLeft',
  'Lightbulb', 'ListOrdered', 'Mic', 'Palette', 'Play', 'Puzzle', 'Scissors',
  'Settings', 'SlidersHorizontal', 'Sparkles', 'Star', 'Tag', 'Terminal',
  'Timer', 'Upload', 'Wand2', 'Waves', 'Wrench', 'Zap',
];

/** 宿主提供的可见性求值上下文（visibleWhen 只读这些字段）。 */
export interface SlotVisibilityContext {
  hasSelection?: boolean;
  clipKind?: string;
  trackKind?: string;
  playing?: boolean;
  hasTimeline?: boolean;
  isAdmin?: boolean;
  [key: string]: unknown;
}

/** 面板/分区类 slot 复用的布局树（与 features/plugins/types.ts 的 UILayout 同构）。 */
export interface SlotLayout {
  title?: string;
  widgets: Array<Record<string, unknown>>;
}

export interface SlotAction {
  endpoint: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: Record<string, unknown>;
}

export interface SlotContribution {
  slot: SlotName;
  id: string;
  title: string;
  /** 贡献类型（后端 /contributions 返回；ui_slot / export_preset / …） */
  kind?: string;
  /** 默认 100；内核元素用 <100（单一排序来源）。 */
  order?: number;
  /** lucide 图标名，白名单校验。 */
  icon?: string;
  /** 声明式可见性；受限表达式，禁止任意 JS。 */
  visibleWhen?: string;
  /** 面板/分区类：复用现有 UILayout。 */
  layout?: SlotLayout;
  /** 预设/快捷键/工具类：纯数据载荷。 */
  payload?: Record<string, unknown>;
}

/** 后端 /api/plugin/contributions 的响应形状（D-1）。 */
export interface SlotContributionResponse {
  contributions: SlotContribution[];
  legacy?: boolean;
}

// ── 受限表达式求值（visibleWhen）─────────────────────

/**
 * 求值 `visibleWhen` 受限表达式。
 *
 * 语法（冻结）：`path`（真值判断）或 `path OP literal`，其中
 * - OP ∈ `=== !== == != ` （以及 `true/false` 字面量）；
 * - path 以 `context.` 开头，支持点号逐层；
 * - literal 支持裸字符串、单/双引号字符串、true/false/数字。
 *
 * 任何解析失败一律返回 false（保守：不显示），绝不 eval。
 */
export function evalVisibleWhen(
  expr: string | undefined,
  context: SlotVisibilityContext,
): boolean {
  if (!expr || !expr.trim()) return true;
  const m = expr.trim().match(
    /^context\.([A-Za-z_][\w.]*)(?:\s*(===|!==|==|!=)\s*(.+))?$/,
  );
  if (!m) return false;
  const [, path, op, rawLiteral] = m;
  const value = path.split('.').reduce<unknown>(
    (acc, part) => (acc && typeof acc === 'object' ? (acc as Record<string, unknown>)[part] : undefined),
    context,
  );
  if (!op) return Boolean(value);
  const literal = parseLiteral(rawLiteral);
  switch (op) {
    case '===': return value === literal;
    case '!==': return value !== literal;
    case '==': return value == literal; // eslint-disable-line eqeqeq
    case '!=': return value != literal; // eslint-disable-line eqeqeq
    default: return false;
  }
}

function parseLiteral(raw: string): unknown {
  const s = raw.trim();
  if (s === 'true') return true;
  if (s === 'false') return false;
  if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
  const quoted = s.match(/^(['"])(.*)\1$/);
  if (quoted) return quoted[2];
  return s; // 裸字符串
}

/** 贡献合法性校验：slot 名与图标白名单（D-2 渲染器入库前统一调用）。 */
export function isSlotName(value: unknown): value is SlotName {
  return typeof value === 'string' && (SLOT_NAMES as readonly string[]).includes(value);
}

export function sanitizeIContribution(c: SlotContribution): SlotContribution {
  return {
    ...c,
    order: typeof c.order === 'number' ? c.order : 100,
    icon: c.icon && SLOT_ICON_WHITELIST.includes(c.icon) ? c.icon : undefined,
  };
}

/**
 * B9：插件导航路径校验 —— 只接受站内绝对路径。
 *
 * 插件贡献的 `payload.to` 会直接进 `navigate({to})`；非法值（外链、裸 key、
 * `..` 穿越、协议相对 `//host`）会让路由进错误页。白名单校验：
 * 单个 `/` 开头、仅字母数字与 `-_.~/$`、不含 `..` 片段。
 */
export function safePluginPath(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const to = value.trim();
  if (!to.startsWith('/') || to.startsWith('//')) return null;
  if (!/^\/[A-Za-z0-9\-_./$]*$/.test(to)) return null;
  if (to.split('/').includes('..')) return null;
  return to.length > 1 && to.endsWith('/') ? to.slice(0, -1) : to;
}
