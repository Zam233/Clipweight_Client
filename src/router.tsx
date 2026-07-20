import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
} from '@tanstack/react-router';
import { HomePage } from './pages/HomePage';
import { EditorPage } from './pages/EditorPage';
import { SettingsPage } from './pages/SettingsPage';
import { ExportPage } from './pages/ExportPage';
import { PersonaPage } from './pages/PersonaPage';
import { PersonaDetailPage } from './pages/PersonaDetailPage';
import { PersonaForgePage } from './pages/PersonaForgePage';
import { HelpPage } from './pages/HelpPage';
import { ModelsPage } from './pages/admin/ModelsPage';
import { ToolsPage } from './pages/admin/ToolsPage';
import { PluginsPage } from './pages/admin/PluginsPage';
import { TypeMakerPage } from './pages/admin/TypeMakerPage';
import { TemplatesPage } from './pages/admin/TemplatesPage';
import { WebhooksPage } from './pages/admin/WebhooksPage';
import { FontsPage } from './pages/admin/FontsPage';
import { PipelineAdminPage } from './pages/admin/PipelineAdminPage';

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: HomePage,
});

const editorRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/editor',
  component: EditorPage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsPage,
});

const exportRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/export',
  component: ExportPage,
});

const personaRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/persona',
  component: PersonaPage,
});

const personaDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/persona/$personaId',
  component: PersonaDetailPage,
});

const personaForgeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/persona/forge',
  component: PersonaForgePage,
});

const helpRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/help',
  component: HelpPage,
});

const modelsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/models',
  component: ModelsPage,
});

const toolsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/tools',
  component: ToolsPage,
});

const pluginsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/plugins',
  component: PluginsPage,
});

const typeMakerRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/type-maker',
  component: TypeMakerPage,
});

const templatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/templates',
  component: TemplatesPage,
});

const webhooksRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/webhooks',
  component: WebhooksPage,
});

const fontsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/fonts',
  component: FontsPage,
});

const pipelineAdminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/pipeline-admin',
  component: PipelineAdminPage,
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
  fontsRoute,
  pipelineAdminRoute,
]);

export const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
