import * as Sentry from '@sentry/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureException,
  captureMessage,
  initSentry,
  setContext,
  setTag,
  setUser,
} from './sentry';

// Mock Sentry
vi.mock('@sentry/react', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  captureMessage: vi.fn(),
  setUser: vi.fn(),
  setTag: vi.fn(),
  setContext: vi.fn(),
  ErrorBoundary: vi.fn(),
}));

describe('Sentry Configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  describe('Sentry utility functions', () => {
    it('should have all required functions exported', () => {
      expect(captureException).toBeDefined();
      expect(captureMessage).toBeDefined();
      expect(setUser).toBeDefined();
      expect(setTag).toBeDefined();
      expect(setContext).toBeDefined();
    });

    it('should have ErrorBoundary exported', () => {
      expect(Sentry.ErrorBoundary).toBeDefined();
    });

    it('should have initSentry function exported', () => {
      expect(initSentry).toBeDefined();
      expect(typeof initSentry).toBe('function');
    });
  });
});
