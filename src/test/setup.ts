import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, expect } from 'vitest';

// Extend expect with custom matchers
expect.extend({
  // Add custom matchers here if needed
});

// Clean up after each test
afterEach(() => {
  cleanup();
});

// Mock console methods to reduce noise in tests
beforeAll(() => {
  // Suppress console.error for React warnings during tests
  const originalError = console.error;
  console.error = (...args: any[]) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: ReactDOM.render is no longer supported')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };

  // Suppress console.warn for React warnings during tests
  const originalWarn = console.warn;
  console.warn = (...args: any[]) => {
    if (
      typeof args[0] === 'string' &&
      (args[0].includes('Warning:') || args[0].includes('React'))
    ) {
      return;
    }
    originalWarn.call(console, ...args);
  };
});

afterAll(() => {
  // Restore console methods
  console.error = console.error;
  console.warn = console.warn;
});
