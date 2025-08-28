import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from './App';

describe('App', () => {
  it('renders without crashing', () => {
    render(<App />);
    expect(
      screen.getByRole('heading', { name: /vite \+ react/i })
    ).toBeInTheDocument();
  });

  it('displays the correct title', () => {
    render(<App />);
    const heading = screen.getByRole('heading', { name: /vite \+ react/i });
    expect(heading).toBeInTheDocument();
    expect(heading.textContent).toBe('Vite + React');
  });

  it('renders the count button', () => {
    render(<App />);
    expect(
      screen.getByRole('button', { name: /count is 0/i })
    ).toBeInTheDocument();
  });

  it('increments count when button is clicked', () => {
    render(<App />);
    const button = screen.getByRole('button', { name: /count is 0/i });

    // Initial state
    expect(button).toHaveTextContent('count is 0');

    // Click the button
    fireEvent.click(button);

    // Count should increment
    expect(button).toHaveTextContent('count is 1');

    // Click again
    fireEvent.click(button);

    // Count should increment again
    expect(button).toHaveTextContent('count is 2');
  });

  it('renders the edit instruction', () => {
    render(<App />);
    expect(screen.getByText(/edit/i)).toBeInTheDocument();
    expect(screen.getByText(/src\/App\.tsx/i)).toBeInTheDocument();
  });

  it('renders the read the docs text', () => {
    render(<App />);
    expect(
      screen.getByText(/click on the vite and react logos to learn more/i)
    ).toBeInTheDocument();
  });
});
