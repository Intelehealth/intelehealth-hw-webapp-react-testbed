import { lazy, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

// Lazy load Sentry for better initial bundle size
const SentryInitializer = lazy(() =>
  import('./config/sentry').then(module => ({
    default: () => {
      module.initSentry();
      return null;
    },
  }))
);

// Error boundary for Sentry initialization
const SentryWrapper = () => (
  <Suspense fallback={null}>
    <SentryInitializer />
  </Suspense>
);

// Initialize Sentry only in production
if (import.meta.env.PROD) {
  SentryWrapper();
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
