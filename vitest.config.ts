import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'dist/',
        'coverage/',
        '**/*.d.ts',
        '**/*.config.*',
        '**/test/**',
        '**/__tests__/**',
        '**/*.test.*',
        '**/*.spec.*',
      ],
      // 100% coverage requirements
      thresholds: {
        global: {
          branches: 100,
          functions: 100,
          lines: 100,
          statements: 100,
        },
      },
      // Detailed coverage info
      all: true,
      include: ['src/**/*.{ts,tsx}'],
    },
    // Test timeout
    testTimeout: 10000,
    // Hook timeout
    hookTimeout: 10000,
  },
});
