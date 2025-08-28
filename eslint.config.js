import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import { globalIgnores } from 'eslint/config';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // Prevent console.log statements (important for production)
      'no-console': 'error',
      // Allow console.warn and console.error for legitimate logging
      'no-restricted-syntax': [
        'error',
        {
          selector:
            'CallExpression[callee.object.name="console"][callee.property.name="log"]',
          message:
            'console.log is not allowed. Use proper logging or remove for production.',
        },
      ],
    },
  },
  {
    files: [
      '**/*.test.{ts,tsx}',
      '**/*.spec.{ts,tsx}',
      'src/test/**/*.{ts,tsx}',
    ],
    rules: {
      // Allow console statements in test files for debugging
      'no-console': 'off',
      'no-restricted-syntax': 'off',
    },
  },
]);
