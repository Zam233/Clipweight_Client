import { RouterProvider } from '@tanstack/react-router';
import { Providers } from './providers';
import { router } from './router';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Toaster } from './components/ui/toast';
import { AppOverlayHost } from '@/features/plugins/AppOverlayHost';

export function App() {
  return (
    <ErrorBoundary>
      <Providers>
        <RouterProvider router={router} />
        {/*
          app.overlay 宿主：插件用 ui_slot 贡献声明式浮层（如「动画渲染依赖
          chrome-headless-shell，点击安装」）。宿主本身不认识任何具体依赖，
          新增/卸载插件无需改动这里。
        */}
        <AppOverlayHost />
        <Toaster />
      </Providers>
    </ErrorBoundary>
  );
}
