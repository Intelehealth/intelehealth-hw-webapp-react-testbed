import { memo, useCallback, useState } from 'react';
import './App.css';
import reactLogo from './assets/react.svg';
import viteLogo from '/vite.svg';

// Memoized button component for better performance
const CounterButton = memo(
  ({ count, onIncrement }: { count: number; onIncrement: () => void }) => (
    <button onClick={onIncrement} className="counter-button">
      count is {count}
    </button>
  )
);

CounterButton.displayName = 'CounterButton';

function App() {
  const [count, setCount] = useState(0);

  // Memoized callback to prevent unnecessary re-renders
  const handleIncrement = useCallback(() => {
    setCount(prevCount => prevCount + 1);
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="logo-container">
          <a href="https://vite.dev" target="_blank" rel="noopener noreferrer">
            <img src={viteLogo} className="logo" alt="Vite logo" />
          </a>
          <a href="https://react.dev" target="_blank" rel="noopener noreferrer">
            <img src={reactLogo} className="logo react" alt="React logo" />
          </a>
        </div>
        <h1>Vite + React</h1>
      </header>

      <main className="app-main">
        <div className="card">
          <CounterButton count={count} onIncrement={handleIncrement} />
          <p>
            Edit <code>src/App.tsx</code> and save to test HMR
          </p>
        </div>
        <p className="read-the-docs">
          Click on the Vite and React logos to learn more
        </p>
      </main>
    </div>
  );
}

export default App;
