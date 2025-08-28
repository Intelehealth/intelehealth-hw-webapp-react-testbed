import * as Sentry from '@sentry/react';

// Initialize Sentry with performance optimizations
export const initSentry = () => {
  // Only initialize in production and when DSN is available
  if (import.meta.env.PROD && import.meta.env.VITE_SENTRY_DSN) {
    Sentry.init({
      dsn: import.meta.env.VITE_SENTRY_DSN,
      environment: import.meta.env.MODE,

      // Performance monitoring with reduced sampling for better performance
      tracesSampleRate: 0.1, // Reduced from 1.0 for better performance

      // Reduced profiling for better performance
      profilesSampleRate: 0.05,

      // Reduced session replay for better performance
      replaysSessionSampleRate: 0.05,
      replaysOnErrorSampleRate: 0.5,

      // Performance optimizations
      maxBreadcrumbs: 50, // Reduced from default 100
      attachStacktrace: false, // Disabled for better performance

      // Before send function to filter sensitive data
      beforeSend(event) {
        // Remove sensitive information
        if (event.request?.headers) {
          delete event.request.headers['authorization'];
          delete event.request.headers['cookie'];
        }

        // Filter out health check errors
        if (event.message?.includes('health check')) {
          return null;
        }

        return event;
      },

      // Ignore specific errors
      ignoreErrors: [
        // Network errors
        'Network Error',
        'Failed to fetch',
        'Network request failed',

        // Browser errors
        'ResizeObserver loop limit exceeded',
        'Script error.',

        // React errors
        'React does not recognize the',
        'Warning: ReactDOM.render is no longer supported',
      ],
    });
  }
};

// Lazy load ErrorBoundary for better performance
export const SentryErrorBoundary = Sentry.ErrorBoundary;

// Performance monitoring - removed startTransaction as it's not available in current Sentry version

// Optimized error reporting
export const captureException = (
  error: Error,
  context?: Record<string, unknown>
) => {
  if (import.meta.env.PROD) {
    Sentry.captureException(error, {
      extra: context,
    });
  }
};

// Optimized message reporting
export const captureMessage = (
  message: string,
  level: Sentry.SeverityLevel = 'info'
) => {
  if (import.meta.env.PROD) {
    Sentry.captureMessage(message, level);
  }
};

// Set user context
export const setUser = (user: {
  id: string;
  email?: string;
  username?: string;
  role?: string;
}) => {
  if (import.meta.env.PROD) {
    Sentry.setUser(user);
  }
};

// Set tags for filtering
export const setTag = (key: string, value: string) => {
  if (import.meta.env.PROD) {
    Sentry.setTag(key, value);
  }
};

// Set context for additional information
export const setContext = (name: string, context: Record<string, unknown>) => {
  if (import.meta.env.PROD) {
    Sentry.setContext(name, context);
  }
};
