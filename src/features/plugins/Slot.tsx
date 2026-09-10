/**
 * D-2：通用 Slot 壳 —— 拉取并渲染指定插槽的插件贡献。
 *
 * 面板/分区类贡献复用现有 PluginLayoutRenderer（13 种控件 + UIAction），
 * 不重写；其余 slot 类型由各自的渲染器（D-3 逐点迁移时接入）扩展。
 */
import type { ReactNode } from 'react';
import { PluginLayoutRenderer } from './PluginLayoutRenderer';
import { evalVisibleWhen, type SlotName, type SlotVisibilityContext } from './slots';
import { usePluginSlots } from './usePluginSlots';

interface SlotProps {
  name: SlotName;
  /** 可见性求值上下文（visibleWhen 只读这些字段）。 */
  context?: SlotVisibilityContext;
  /** 无贡献时的占位（默认 null=不渲染任何东西）。 */
  fallback?: ReactNode;
  /** 面板类贡献的自定义渲染器（D-3 逐点接入）；缺省用 PluginLayoutRenderer。 */
  renderLayout?: (layout: NonNullable<ReturnType<typeof usePluginSlots>[number]['layout']>, title: string) => ReactNode;
}

export function Slot({ name, context = {}, fallback = null, renderLayout }: SlotProps) {
  const items = usePluginSlots(name);
  const visible = items.filter((c) => evalVisibleWhen(c.visibleWhen, context));
  if (visible.length === 0) return <>{fallback}</>;

  return (
    <>
      {visible.map((c) => {
        if (c.layout) {
          if (renderLayout) return <div key={c.id}>{renderLayout(c.layout, c.title)}</div>;
          return (
            <section key={c.id} className="rounded-cw-md border border-outline-variant/30 overflow-hidden">
              <header className="px-3 py-2 bg-surface-container-high border-b border-outline-variant/20">
                <span className="text-label font-medium text-on-surface">{c.title}</span>
              </header>
              <div className="p-3">
                <PluginLayoutRenderer layout={c.layout as never} />
              </div>
            </section>
          );
        }
        return null; // 非面板类贡献由对应 slot 渲染器消费（D-3）
      })}
    </>
  );
}
