import { useNavigate } from '@tanstack/react-router';
import { Slot } from '@/features/plugins/Slot';
import { ChevronRight } from 'lucide-react';
import { CONSOLE_NAV } from './consoleNav';

/**
 * ConsoleEntriesPanel — 设置页的系统控制台入口列表。
 *
 * 顺序**直接来自 `CONSOLE_NAV`**（与控制台左栏同一份），不再各写一份：
 * 用户在设置页看到的顺序，就是点进去之后左栏的顺序。
 *
 * 插件贡献的设置分区（`settings.section` slot）**排在最后**——内核功能固定在前、
 * 插件追加在后。此前 `Slot` 被放在页面最顶部，用户一进设置先看到一堆插件提供的
 * 分区，自己的偏好设置被挤到下面，这也是"设置页混乱"的来源之一。
 */
export function ConsoleEntriesPanel() {
  const navigate = useNavigate();

  return (
    <div className="space-y-6">
      <section>
        <div className="flex items-baseline gap-3 mb-3">
          <h2 className="text-title-sm font-medium text-on-surface">系统控制台</h2>
          <p className="text-caption text-on-surface-variant">
            顺序与控制台左栏一致 · 共 {CONSOLE_NAV.length} 项
          </p>
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
          {CONSOLE_NAV.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.to}
                onClick={() => navigate({ to: item.to })}
                className="w-full flex items-center gap-4 bg-surface-container border border-outline-variant/30 rounded-cw-md px-5 py-4
                  hover:border-primary/50 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-primary/10 transition-all duration-short3
                  cursor-pointer group text-left"
              >
                <span className="w-10 h-10 rounded-cw-sm bg-primary-container flex items-center justify-center shrink-0">
                  <Icon className="w-5 h-5 text-on-primary-container" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-body-sm font-semibold text-on-surface group-hover:text-primary transition-colors">
                    {item.label}
                  </p>
                  <p className="text-caption text-on-surface-variant truncate">{item.desc}</p>
                </div>
                <span className="font-mono text-caption text-on-surface-variant/40 shrink-0">{item.code}</span>
                <ChevronRight className="w-4 h-4 text-on-surface-variant group-hover:text-primary group-hover:translate-x-1 transition-all shrink-0" />
              </button>
            );
          })}
        </div>
      </section>

      {/* 插件贡献的设置分区（含旧 ui.json 经后端兼容层包装的 legacy 项）——固定排最后 */}
      <PluginSettingsSections />
    </div>
  );
}

/** 插件 Hook 进设置页的分区；没有插件贡献时不占位（避免空标题）。 */
function PluginSettingsSections() {
  return (
    <section>
      <Slot name="settings.section" />
    </section>
  );
}
