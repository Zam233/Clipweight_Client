import {
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { lazy, Suspense } from 'react';
import { HomePage } from './pages/HomePage';
import { RouteErrorFallback } from './components/RouteErrorFallback';
import { useAuthStore } from '@/stores/authStore';

// Route-level code splitting: every page (except the landing HomePage) is
// lazy-loaded into its own chunk to keep the initial bundle small.
const lazyPage = <T extends Record<string, React.ComponentType>>(
  factory: () => Promise<T>,
  exportName: keyof T,
) => lazy(() => factory().then((m) => ({ default: m[exportName] })));

const EditorPage = lazyPage(() => import('./pages/EditorPage'), 'EditorPage');
const SettingsPage = lazyPage(() => import('./pages/SettingsPage'), 'SettingsPage');
const ExportPage = lazyPage(() => import('./pages/ExportPage'), 'ExportPage');
const PersonaPage = lazyPage(() => import('./pages/PersonaPage'), 'PersonaPage');
const PersonaDetailPage = lazyPage(() => import('./pages/PersonaDetailPage'), 'PersonaDetailPage');
const PersonaForgePage = lazyPage(() => import('./pages/PersonaForgePage'), 'PersonaForgePage');
const HelpPage = lazyPage(() => import('./pages/HelpPage'), 'HelpPage');
const ModelsPage = lazyPage(() => import('./pages/admin/ModelsPage'), 'ModelsPage');
const ToolsPage = lazyPage(() => import('./pages/admin/ToolsPage'), 'ToolsPage');
const PluginsPage = lazyPage(() => import('./pages/admin/PluginsPage'), 'PluginsPage');
const TypeMakerPage = lazyPage(() => import('./pages/admin/TypeMakerPage'), 'TypeMakerPage');
const TemplatesPage = lazyPage(() => import('./pages/admin/TemplatesPage'), 'TemplatesPage');
const LearningPage = lazyPage(() => import('./pages/admin/LearningPage'), 'LearningPage');
const VideoEditorPage = lazyPage(() => import('./pages/admin/VideoEditorPage'), 'VideoEditorPage');
const WebhooksPage = lazyPage(() => import('./pages/admin/WebhooksPage'), 'WebhooksPage');
const FontsPage = lazyPage(() => import('./pages/admin/FontsPage'), 'FontsPage');
const MgPreviewPage = lazyPage(() => import('./pages/admin/MgPreviewPage'), 'MgPreviewPage');
const SubtitleToolsPage = lazyPage(() => import('./pages/admin/SubtitleToolsPage'), 'SubtitleToolsPage');
const PreprocessPage = lazyPage(() => import('./pages/admin/PreprocessPage'), 'PreprocessPage');
const PipelineAdminPage = lazyPage(() => import('./pages/admin/PipelineAdminPage'), 'PipelineAdminPage');
const VoicePage = lazyPage(() => import('./pages/VoicePage'), 'VoicePage');
const ProjectsPage = lazyPage(() => import('./pages/ProjectsPage'), 'ProjectsPage');
const LoginPage = lazyPage(() => import('./pages/LoginPage'), 'LoginPage');
const MarketPage = lazyPage(() => import('./pages/MarketPage'), 'MarketPage');

/** 管理页鉴权守卫（审计 P1 修复）：
 * - 存在账号会话（restore 成功）时，仅 role === 'admin' 可访问管理页；
 * - 无会话时为本地/离线单用户模式，保持可用（桌面端部署形态）。 */
async function requireAdmin() {
  const auth = useAuthStore.getState();
  await auth.restore();
  const user = useAuthStore.getState().user;
  if (user && user.role !== 'admin') {
    sessionStorage.setItem('cw_guard_notice', '该页面需要管理员权限');
    throw redirect({ to: '/' });
  }
}

/** 数据页会话守卫（E2）：
 * - 曾登录过（cw_had_session 标记）且当前无有效会话 → 跳转登录页；
 * - 从未登录过视为 off/token 本地模式，照旧放行（不影响桌面部署形态）。 */
async function requireSession() {
  const auth = useAuthStore.getState();
  await auth.restore();
  const hadSession = localStorage.getItem('cw_had_session') === '1';
  if (hadSession && !useAuthStore.getState().user) {
    throw redirect({ to: '/login' });
  }
}

/** E1: 404 页——此前未知 URL 显示 TanStack Router 默认英文界面 */
function NotFoundView() {
  return (
    <div className="h-full w-full flex flex-col items-center justify-center gap-4 bg-surface text-on-surface">
      <span className="font-mono text-6xl font-bold text-on-surface-variant">404</span>
      <span className="text-body">页面不存在或已被移动</span>
      <Link
        to="/"
        className="px-4 py-2 rounded-lg bg-primary text-on-primary text-body cursor-pointer"
      >
        返回首页
      </Link>
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="h-full w-full flex items-center justify-center bg-surface">
      <div className="flex flex-col items-center gap-3">
        <span className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span className="font-mono text-caption text-on-surface-variant tracking-widest">加载中…</span>
      </div>
    </div>
  );
}

const rootRoute = createRootRoute({
  component: () => (
    <Suspense fallback={<RouteFallback />}>
      <Outlet />
    </Suspense>
  ),
  // E1: 404 页面（未知 URL 不再显示库默认英文界面）
  notFoundComponent: NotFoundView,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
  errorComponent: RouteErrorFallback,
});

const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/editor/$projectId',
  beforeLoad: async ({ params }) => {
    await requireSession(); // E2
    const { projectId } = params;
    // Validate id format only; EditorPage handles loading + offline fallback
    // (avoids a redundant double-fetch and allows offline/demo editor access)
    if (!projectId || !/^proj_[A-Za-z0-9_-]{1,63}$/.test(projectId)) {
      sessionStorage.setItem('cw_guard_notice', '项目链接无效');
      throw redirect({ to: '/' });
    }
  },
  component: EditorPage,
  errorComponent: RouteErrorFallback,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
  errorComponent: RouteErrorFallback,
});

const exportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/export/$projectId',
  beforeLoad: requireSession,
  component: ExportPage,
  errorComponent: RouteErrorFallback,
});

const personaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/persona',
  beforeLoad: requireSession,
  component: PersonaPage,
  errorComponent: RouteErrorFallback,
});

const personaDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/persona/$personaId',
  beforeLoad: requireSession,
  component: PersonaDetailPage,
  errorComponent: RouteErrorFallback,
});

const personaForgeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/persona/forge',
  component: PersonaForgePage,
  errorComponent: RouteErrorFallback,
});

const helpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/help',
  component: HelpPage,
  errorComponent: RouteErrorFallback,
});

const modelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/models',
  beforeLoad: requireAdmin,
  component: ModelsPage,
  errorComponent: RouteErrorFallback,
});

const toolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/tools',
  beforeLoad: requireAdmin,
  component: ToolsPage,
  errorComponent: RouteErrorFallback,
});

const pluginsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/plugins',
  beforeLoad: requireAdmin,
  component: PluginsPage,
  errorComponent: RouteErrorFallback,
});

const typeMakerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/type-maker',
  beforeLoad: requireAdmin,
  component: TypeMakerPage,
  errorComponent: RouteErrorFallback,
});

const templatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/templates',
  beforeLoad: requireAdmin,
  component: TemplatesPage,
  errorComponent: RouteErrorFallback,
});

const webhooksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/webhooks',
  beforeLoad: requireAdmin,
  component: WebhooksPage,
  errorComponent: RouteErrorFallback,
});

const learningRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/learning',
  beforeLoad: requireAdmin,
  component: LearningPage,
  errorComponent: RouteErrorFallback,
});

const videoEditorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/video-editor',
  beforeLoad: requireAdmin,
  component: VideoEditorPage,
  errorComponent: RouteErrorFallback,
});

const fontsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/fonts',
  beforeLoad: requireAdmin,
  component: FontsPage,
  errorComponent: RouteErrorFallback,
});

const mgPreviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/mg-preview',
  beforeLoad: requireAdmin,
  component: MgPreviewPage,
  errorComponent: RouteErrorFallback,
});

const subtitleToolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/subtitle-tools',
  beforeLoad: requireAdmin,
  component: SubtitleToolsPage,
  errorComponent: RouteErrorFallback,
});

const preprocessRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/preprocess',
  beforeLoad: requireAdmin,
  component: PreprocessPage,
  errorComponent: RouteErrorFallback,
});

const pipelineAdminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pipeline-admin',
  beforeLoad: requireAdmin,
  component: PipelineAdminPage,
  errorComponent: RouteErrorFallback,
});

const voiceRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/voice',
  component: VoicePage,
  errorComponent: RouteErrorFallback,
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  beforeLoad: requireSession,
  component: ProjectsPage,
  errorComponent: RouteErrorFallback,
});

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: LoginPage,
  errorComponent: RouteErrorFallback,
});

const marketRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/market',
  component: MarketPage,
  errorComponent: RouteErrorFallback,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  editorRoute,
  settingsRoute,
  exportRoute,
  personaRoute,
  personaDetailRoute,
  personaForgeRoute,
  helpRoute,
  modelsRoute,
  toolsRoute,
  pluginsRoute,
  typeMakerRoute,
  templatesRoute,
  webhooksRoute,
  learningRoute,
  videoEditorRoute,
  fontsRoute,
  mgPreviewRoute,
  subtitleToolsRoute,
  preprocessRoute,
  pipelineAdminRoute,
  voiceRoute,
  projectsRoute,
  loginRoute,
  marketRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
