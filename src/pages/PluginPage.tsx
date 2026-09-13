/**
 * D-3b：插件页面壳（slot `page`）。
 *
 * 设计（方案 §6）：插件页面**不支持任意 JS**——`page` 贡献以 UILayout
 * 声明式描述内容，本壳按路由参数 `pageId` 匹配贡献并渲染。路由无需为
 * 插件动态注册（26 条内核路由保持不变），统一走 `/plugin/$pageId`。
 */
import { useEffect, useState } from 'react';
import { useParams, useNavigate } from '@tanstack/react-router';
import { StandardLayout } from '@/layouts/StandardLayout';
import { Button } from '@/components/ui';
import { Puzzle, ShieldAlert } from 'lucide-react';
import { PluginLayoutRenderer } from '@/features/plugins/PluginLayoutRenderer';
import { usePluginSlots } from '@/features/plugins/usePluginSlots';
import { useAuthStore } from '@/stores/authStore';

export function PluginPage() {
  const { pageId } = useParams({ from: '/plugin/$pageId' });
  const navigate = useNavigate();
  const pages = usePluginSlots('page');

  // P6：插件页默认对所有登录用户开放；声明 admin_only 的贡献只投递给管理员
  // （后端已不下发，这里再按本地角色挡一次，避免缓存/刷新造成短暂可见）。
  const [isAdmin, setIsAdmin] = useState(true); // 角色未知时不误报「无权限」
  useEffect(() => {
    let alive = true;
    const auth = useAuthStore.getState();
    void auth.restore().then(() => {
      if (!alive) return;
      const user = useAuthStore.getState().user;
      setIsAdmin(!user || user.role === 'admin');
    }).catch(() => { /* 离线/未登录：按 off/token 本地模式放行 */ });
    return () => { alive = false; };
  }, []);

  // 匹配规则：贡献 id 或 payload.path 与路由参数一致
  const page = pages.find((c) => {
    const path = String((c.payload as { path?: unknown } | undefined)?.path ?? '');
    const normalized = path.replace(/^\/+/, '').replace(/^plugin\//, '');
    return c.id === pageId || normalized === pageId;
  });

  const declaredAdminOnly =
    (page?.payload as { admin_only?: unknown } | undefined)?.admin_only === true;
  if (page && declaredAdminOnly && !isAdmin) {
    return (
      <StandardLayout title="插件页面">
        <div className="max-w-2xl mx-auto py-16 text-center space-y-3">
          <ShieldAlert className="w-8 h-8 mx-auto text-on-surface-variant/60" />
          <p className="text-body text-on-surface">该插件页面仅管理员可访问。</p>
          <p className="text-label-sm text-on-surface-variant">
            插件作者将该页面声明为 admin_only。如需访问，请联系管理员调整角色。
          </p>
          <Button size="sm" variant="outline" onClick={() => navigate({ to: '/' })}>
            返回首页
          </Button>
        </div>
      </StandardLayout>
    );
  }

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
