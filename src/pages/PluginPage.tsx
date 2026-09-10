/**
 * D-3b：插件页面壳（slot `page`）。
 *
 * 设计（方案 §6）：插件页面**不支持任意 JS**——`page` 贡献以 UILayout
 * 声明式描述内容，本壳按路由参数 `pageId` 匹配贡献并渲染。路由无需为
 * 插件动态注册（26 条内核路由保持不变），统一走 `/plugin/$pageId`。
 */
import { useParams, useNavigate } from '@tanstack/react-router';
import { StandardLayout } from '@/layouts/StandardLayout';
import { Button } from '@/components/ui';
import { Puzzle } from 'lucide-react';
import { PluginLayoutRenderer } from '@/features/plugins/PluginLayoutRenderer';
import { usePluginSlots } from '@/features/plugins/usePluginSlots';

export function PluginPage() {
  const { pageId } = useParams({ from: '/plugin/$pageId' });
  const navigate = useNavigate();
  const pages = usePluginSlots('page');

  // 匹配规则：贡献 id 或 payload.path 与路由参数一致
  const page = pages.find((c) => {
    const path = String((c.payload as { path?: unknown } | undefined)?.path ?? '');
    const normalized = path.replace(/^\/+/, '').replace(/^plugin\//, '');
    return c.id === pageId || normalized === pageId;
  });

  if (!page) {
    return (
      <StandardLayout title="插件页面">
        <div className="max-w-2xl mx-auto py-16 text-center space-y-3">
          <Puzzle className="w-8 h-8 mx-auto text-on-surface-variant/60" />
          <p className="text-body text-on-surface">插件页面不存在或已被禁用。</p>
          <p className="text-label-sm text-on-surface-variant">
            若插件刚被启用/禁用，请稍候数秒后重试（贡献列表有 30 秒缓存）。
          </p>
          <Button size="sm" variant="outline" onClick={() => navigate({ to: '/' })}>
            返回首页
          </Button>
        </div>
      </StandardLayout>
    );
  }

  return (
    <StandardLayout title={page.title}>
      <div className="max-w-3xl mx-auto space-y-4">
        {page.layout ? (
          <PluginLayoutRenderer layout={page.layout as never} />
        ) : (
          <p className="text-body-sm text-on-surface-variant">该插件页面未提供布局内容。</p>
        )}
      </div>
    </StandardLayout>
  );
}
