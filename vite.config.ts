import react from '@vitejs/plugin-react';
import { visualizer } from 'rollup-plugin-visualizer';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    // Bundle analyzer for production builds
    mode === 'analyze' &&
      visualizer({
        filename: 'dist/stats.html',
        open: true,
        gzipSize: true,
        brotliSize: true,
      }),
  ].filter(Boolean),

  // Build optimizations
  build: {
    target: 'es2020',
    minify: 'esbuild',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          sentry: ['@sentry/react', '@sentry/tracing'],
        },
      },
    },
    chunkSizeWarningLimit: 1000,
  },

  // Development optimizations
  server: {
    port: 3000,
    host: true,
    open: true,
  },

  // CSS optimizations
  css: {
    devSourcemap: false,
  },

  // Optimize dependencies
  optimizeDeps: {
    include: ['react', 'react-dom'],
    exclude: ['@sentry/react', '@sentry/tracing'],
  },
}));
