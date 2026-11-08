/**
 * 一个业务对象里的**展示 spec 列表**渲染块（B4-T4.4）。
 *
 * 为什么单独抽出来：三个挂载点（简报卡 / 规划书卡 / 审阅覆盖层）逻辑完全一样——
 * 解析 `display_specs`（含老 `genui` 回退）→ 逐条取契约 → 有契约才渲染。
 * 契约缺失（插件未装/被禁用）时**整块不渲染**，业务字段照常显示。
 */
import { GenUISpecRenderer } from './GenUISpecRenderer';
import { resolveDisplaySpecs, useDisplaySpecContracts } from './contractSource';
import type { GenUIActionEvent, GenUIActionScope } from './types';

export interface DisplaySpecsBlockProps {
  /** 业务对象（`creative_brief` / `production_plan`，也接受消息里的同形状对象） */
  obj: unknown;
  /** 这一面是什么（老键 `genui` 回退时用它当 specId） */
  surface: 'brief' | 'plan';
  /** 测试锚点：保持 `brief-genui` / `plan-genui` 不变 */
  testId: string;
  scope?: GenUIActionScope;
  /** 只读场景（审阅覆盖层）：不渲染动作按钮 */
  hideActions?: boolean;
  onAction?: (event: GenUIActionEvent) => void;
  /** 外层容器类名（默认沿用卡片的横向内边距 + 分隔线） */
  className?: string;
}

const DEFAULT_CLASS = 'px-3 pt-2.5 pb-2.5 border-b border-outline-variant/20';

export function DisplaySpecsBlock({
  obj, surface, testId, scope, hideActions = false, onAction, className,
}: DisplaySpecsBlockProps) {
  const contracts = useDisplaySpecContracts();
  const specs = resolveDisplaySpecs(obj, surface);
  const usable = specs
    .map((spec) => ({ ...spec, contract: contracts.get(spec.specId) }))
    .filter((spec): spec is typeof spec & { contract: NonNullable<typeof spec.contract> } => !!spec.contract);
  if (usable.length === 0) return null;
  return (
    <div className={className ?? DEFAULT_CLASS} data-testid={testId}>
      {usable.map(({ specId, raw, contract }) => (
        <GenUISpecRenderer
          key={specId}
          rawSpec={raw}
          contract={contract}
          compact
          scope={scope}
          hideActions={hideActions}
          supportedActions={['ask', 'select', 'confirm']}
          onAction={onAction}
        />
      ))}
    </div>
  );
}
