import React, { useState } from 'react';
import { ApiExamples } from '../examples/api-examples';
import { HttpExamples } from '../examples/http-examples';
import { ReduxConcepts } from '../examples/redux-concepts';

// Main Example Usage Component
export const ExampleUsage: React.FC = () => {
  const [activeExample, setActiveExample] = useState<'http' | 'redux' | 'api'>(
    'http'
  );

  const renderExample = () => {
    switch (activeExample) {
      case 'http':
        return <HttpExamples />;
      case 'redux':
        return <ReduxConcepts />;
      case 'api':
        return <ApiExamples />;
      default:
        return <HttpExamples />;
    }
  };

  return (
    <div className="example-usage">
      <h1>Development Examples</h1>

      {/* Navigation */}
      <div className="example-navigation">
        <button
          className={activeExample === 'http' ? 'active' : ''}
          onClick={() => setActiveExample('http')}
        >
          HTTP Service Examples
        </button>
        <button
          className={activeExample === 'redux' ? 'active' : ''}
          onClick={() => setActiveExample('redux')}
        >
          Redux Concepts
        </button>
        <button
          className={activeExample === 'api' ? 'active' : ''}
          onClick={() => setActiveExample('api')}
        >
          API Service Examples
        </button>
      </div>

      {/* Example Content */}
      <div className="example-content">{renderExample()}</div>

      {/* Instructions */}
      <div className="instructions">
        <h3>How to Use These Examples</h3>
        <ul>
          <li>
            <strong>HTTP Service Examples:</strong> Shows how to use the useHttp
            hook for API calls
          </li>
          <li>
            <strong>Redux Concepts:</strong> Demonstrates Redux-like state
            management using useReducer
          </li>
          <li>
            <strong>API Service Examples:</strong> Shows direct usage of the
            apiService functions
          </li>
        </ul>
        <p>
          These examples demonstrate different patterns you can use in your
          application. Each example is focused on a single concept and kept
          under 200 lines for maintainability.
        </p>
      </div>
    </div>
  );
};
