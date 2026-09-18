import { useNavigate } from '@tanstack/react-router';
import { StandardLayout } from '@/layouts/StandardLayout';
import { PreferencesPanel } from '@/features/settings/PreferencesPanel';
import { ConsoleEntriesPanel } from '@/features/settings/ConsoleEntriesPanel';
import { Button } from '@/components/ui';

/**
 * SettingsPage — `/settings`：本机偏好 + 系统控制台入口。
 *
 * 结构（针对"点进去太乱"重排）：
 *  1. **本机偏好**（外观/时间轴/保存/演示模式/后端连接/用量/素材源/快捷键）
 *     —— 高频、就地生效，所以放最前面；
 *  2. **系统控制台入口** —— 顺序严格跟随控制台左栏（`CONSOLE_NAV`）；
 *  3. **插件 Hook 进设置页的分区** —— 固定排在最后。
 *
 * 控件本身来自 `PreferencesPanel`（首页「设置」tab 渲染同一份），
 * 这里不再重复实现任何一项偏好设置。
 */
export function SettingsPage() {
  const navigate = useNavigate();

  return (
    <StandardLayout title="全局设置">
      <div className="max-w-4xl mx-auto space-y-8">
        <section>
          <div className="flex items-baseline justify-between gap-3 mb-3">
            <div>
              <h2 className="text-title-sm font-medium text-on-surface">本机偏好</h2>
              <p className="text-caption text-on-surface-variant">改动即时生效，保存在本机</p>
            </div>
          </div>
          <PreferencesPanel />
        </section>

        <ConsoleEntriesPanel />

        <section className="flex flex-wrap items-center gap-3 pt-2 border-t border-outline-variant/25">
          <Button size="sm" variant="outline" onClick={() => navigate({ to: '/help' })}>
            帮助与文档
          </Button>
          <Button size="sm" variant="ghost" onClick={() => navigate({ to: '/' })}>
            返回工作台
          </Button>
        </section>
      </div>
    </StandardLayout>
  );
}
