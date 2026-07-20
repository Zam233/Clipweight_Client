import { RouterProvider } from '@tanstack/react-router';
import { Providers } from './providers';
import { router } from './router';
import { ErrorBoundary } from './components/ErrorBoundary';

export function App() {
  return (
    <ErrorBoundary>
      <Providers>
        <RouterProvider router={router} />
      </Providers>
    </ErrorBoundary>
  );
}
