import { describe, expect, it, vi } from 'vitest';

// Mock ReactDOM
vi.mock('react-dom/client', () => ({
  createRoot: vi.fn(() => ({
    render: vi.fn(),
  })),
}));

// Mock App component
vi.mock('./App', () => ({
  default: () => <div data-testid="app">Mocked App</div>,
}));

describe('main.tsx', () => {
  it('renders the app without crashing', async () => {
    // Import and execute main.tsx
    await import('./main');

    // The test passes if no errors are thrown during import
    expect(true).toBe(true);
  });
});
