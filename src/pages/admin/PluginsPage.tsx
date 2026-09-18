import { ConsoleShell, ConsoleHeading } from './ConsoleShell';
import { PluginsPanel } from '@/features/settings/PluginsPanel';

/**
 * PluginsPage — `/settings/plugins`：插件管理的独立页外壳。
 *
 * 全部能力在 `PluginsPanel` 里（首页「插件」tab 渲染同一份），本文件只提供
 * 控制台外壳与页头。
 */
export function PluginsPage() {
  return (
    <ConsoleShell>
      <ConsoleHeading kicker="Extensions / Plugins" title="插件管理"
        desc="加载/卸载与启停、运行时配置、UI 预览、错误通道、健康聚合与贡献清单。配置写入后即时生效，无需重启。" />
      <PluginsPanel />
    </ConsoleShell>
  );
}
