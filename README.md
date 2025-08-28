# Intelehealth Health Worker Webapp

A modern, high-performance web application built for health workers, providing an intuitive interface for managing healthcare workflows and patient interactions.

## 🚀 Tech Stack

- **Frontend Framework**: React 19 with TypeScript
- **Build Tool**: Vite 7.1.3 (optimized for performance)
- **Package Manager**: Yarn
- **Language**: TypeScript (strict mode enabled)
- **Styling**: CSS with modern design principles
- **Testing**: Vitest + React Testing Library (100% coverage required)
- **State Management**: React useReducer with centralized reducers
- **Code Quality**: ESLint + Prettier + Husky pre-commit hooks

## 🛠️ Development Setup

### Prerequisites

- Node.js (version 18 or higher)
- Yarn package manager
- VS Code (recommended editor)

### Installation

```bash
# Clone the repository
git clone <repository-url>
cd ih-hw-webapp

# Install dependencies
yarn install

# Start development server
yarn dev
```

### Available Scripts

- `yarn dev` - Start development server with hot reload
- `yarn build` - Build for production (optimized)
- `yarn lint` - Run ESLint for code quality
- `yarn lint:fix` - Auto-fix ESLint issues
- `yarn format` - Format code with Prettier
- `yarn format:check` - Check code formatting
- `yarn preview` - Preview production build locally
- `yarn analyze` - Analyze bundle size and composition (generates visual report)
- `yarn type-check` - Run TypeScript type checking
- `yarn pre-commit` - Run all pre-commit checks manually (formatting, linting, type-check, tests, build)

### Testing Scripts

- `yarn test` - Run tests in watch mode
- `yarn test:ui` - Run tests with Vitest UI
- `yarn test:run` - Run tests once
- `yarn test:coverage` - Run tests with coverage report (100% required)
- `yarn test:watch` - Run tests in watch mode

### Git Hooks & Quality Assurance

This project uses **Husky** to enforce code quality standards before each commit. The pre-commit hook automatically runs:

1. **Code Formatting & Linting** - Formats and lints staged files using ESLint and Prettier
2. **Type Checking** - Runs TypeScript type checking (`yarn type-check`)
3. **Tests** - Executes all tests (`yarn test:run`)
4. **Build Verification** - Ensures the project builds successfully (`yarn build`)

**Benefits:**

- ✅ Prevents broken code from being committed
- ✅ Ensures consistent code style
- ✅ Catches type errors early
- ✅ Maintains test coverage
- ✅ Guarantees build success

**Note:** All checks must pass before a commit is allowed. If any check fails, the commit will be blocked until issues are resolved.

## 🌐 Access

- **Development**: http://localhost:3000 (optimized port)
- **Production**: [To be configured]

## 🔧 Environment Configuration

Create a `.env` file based on `.env.example`:

```bash
# Development
VITE_API_URL=http://localhost:3000
VITE_APP_ENV=development

# Production
VITE_API_URL=https://api.production.com
VITE_SENTRY_DSN=your_production_dsn
VITE_APP_ENV=production
```

**Environment Variables:**

- `VITE_API_URL` - Backend API endpoint
- `VITE_SENTRY_DSN` - Sentry error tracking DSN (production only)
- `VITE_APP_ENV` - Application environment (development/staging/production)

**Note:** `VITE_SENTRY_DSN` is only required in production. Sentry is automatically disabled in development for better performance.

## 📁 Project Structure

```
ih-hw-webapp/
├── src/
│   ├── App.tsx                    # Main application component (optimized with memo)
│   ├── main.tsx                   # Application entry point
│   ├── App.css                    # Main application styles
│   ├── assets/                    # Static assets
│   ├── components/                # Reusable UI components
│   ├── config/                    # Configuration files
│   ├── services/                  # HTTP and API services
│   ├── hooks/                     # Custom React hooks
│   ├── types/                     # Common TypeScript types
│   ├── reducers/                  # Common state reducers
│   ├── utils/                     # Utility functions (storage, etc.)
│   ├── test/                      # Test utilities and setup
│   ├── examples/                  # Development examples and patterns
│   │   ├── http-examples.tsx      # HTTP service usage examples
│   │   ├── redux-concepts.tsx     # Redux-like state management
│   │   ├── api-examples.tsx       # API service usage examples
│   │   ├── index.ts               # Examples exports
│   │   └── CODING_GUIDELINES.md   # Project coding standards
│   └── modules/                   # Feature-based modules (future use)
├── public/                        # Public assets
├── .husky/                        # Git hooks for quality assurance
├── .vscode/                       # VS Code workspace settings
├── package.json                   # Dependencies and scripts
├── vite.config.ts                 # Vite configuration (optimized)
├── tsconfig.app.json              # TypeScript config (performance optimized)
├── vitest.config.ts               # Vitest configuration
├── env.example                    # Environment variables template
└── README.md                     # This file
```

### 📏 **File Structure Rules:**

- **Maximum 200 lines per file** (preferably 150-180 lines)
- **Single responsibility** - each file demonstrates one concept
- **Clean imports** - minimal dependencies
- **Clear naming** - descriptive file names
- **Examples folder** - contains focused, reusable example components

### 📝 File Naming Convention

The project follows a consistent naming convention for different file types:

- **Components**: `.component.ts` (e.g., `login.component.ts`, `dashboard.component.ts`)
- **Services**: `.service.ts` (e.g., `auth.service.ts`, `patient.service.ts`)
- **Hooks**: `.hook.ts` (e.g., `auth.hook.ts`, `patient.hook.ts`)
- **Types**: `.types.ts` (e.g., `auth.types.ts`, `patient.types.ts`)
- **Reducers**: `.reducer.ts` (e.g., `auth.reducer.ts`, `patient.reducer.ts`)
- **Utilities**: `.util.ts` (e.g., `storage.util.ts`, `validation.util.ts`)
- **Constants**: `.constant.ts` (e.g., `api.constant.ts`, `routes.constant.ts`)

### 🏗️ Module Structure

Each module follows a consistent structure and can include sub-modules for complex features:

```
modules/
├── [feature-name]/                    # Main feature module
│   ├── [feature-name].component.ts    # Main component
│   ├── [feature-name].service.ts      # Business logic
│   ├── [feature-name].hook.ts         # Custom hooks
│   ├── [feature-name].types.ts        # Type definitions
│   ├── [feature-name].constant.ts     # Module constants
│   ├── [feature-name].util.ts         # Module utilities
│   ├── [feature-name].test.ts         # Module tests
│   └── [sub-feature]/                 # Sub-module for complex features
│       ├── [sub-feature].component.ts # Sub-feature component
│       ├── [sub-feature].service.ts   # Sub-feature service
│       ├── [sub-feature].hook.ts      # Sub-feature hooks
│       └── [sub-feature].types.ts     # Sub-feature types
└── [another-feature]/                 # Another main feature
    ├── [another-feature].component.ts
    ├── [another-feature].service.ts
    └── [another-feature].types.ts
```

**Example Structure:**

```
modules/
├── auth/                              # Authentication module
│   ├── auth.component.ts              # Main auth component
│   ├── auth.service.ts                # Auth service
│   ├── auth.hook.ts                   # Auth hooks
│   ├── auth.types.ts                  # Auth types
│   ├── login/                         # Login sub-module
│   │   ├── login.component.ts         # Login component
│   │   ├── login.service.ts           # Login service
│   │   └── login.types.ts             # Login types
│   └── register/                      # Register sub-module
│       ├── register.component.ts      # Register component
│       └── register.service.ts        # Register service
└── patients/                          # Patients module
    ├── patients.component.ts          # Main patients component
    ├── patients.service.ts            # Patients service
    ├── patients.types.ts              # Patients types
    ├── list/                          # Patient list sub-module
    │   ├── patient-list.component.ts  # List component
    │   └── patient-list.hook.ts       # List hooks
    └── details/                       # Patient details sub-module
        ├── patient-details.component.ts # Details component
        └── patient-details.service.ts   # Details service
```

## 🚀 Build Optimizations

- **Target**: ES2020 for modern browsers
- **Minification**: ESBuild with aggressive optimization
- **Code Splitting**: Vendor chunks separated
- **Source Maps**: Disabled in production
- **TypeScript**: Incremental builds with strict mode
- **Bundle Analysis**: Visual reports with `yarn analyze`

## 🧪 Testing

### Coverage Requirements

- **Statements**: 100%
- **Branches**: 100%
- **Functions**: 100%
- **Lines**: 100%

### Test Commands

```bash
# Run all tests with coverage
yarn test:coverage

# Interactive testing
yarn test:ui

# Watch mode for development
yarn test:watch
```

### Test Structure

- **Unit Tests**: Component and utility testing
- **Integration Tests**: API and state management
- **E2E Tests**: [Future implementation]

## 🔒 Code Quality

### ESLint Rules

- **No Console**: Prevents console.log in production
- **TypeScript Strict**: Full type safety
- **React Best Practices**: Hooks and component rules
- **Prettier Integration**: Consistent formatting

### Web API Usage

**⚠️ IMPORTANT: Never use web APIs directly in your code!**

Always use the utility functions and services provided by the project. This includes but is not limited to:

- **localStorage/sessionStorage** - Use storage utilities
- **fetch/XMLHttpRequest** - Use HTTP service
- **cookies** - Use cookie utilities
- **IndexedDB** - Use database utilities
- **WebSocket** - Use WebSocket service
- **File API** - Use file handling utilities
- **Geolocation API** - Use location service
- **Notification API** - Use notification service

**Storage Management Example:**

Always use the storage utility functions from `src/utils/storage.ts`:

```typescript
// ❌ WRONG - Don't do this
localStorage.setItem('auth_token', token);
const token = localStorage.getItem('auth_token');
sessionStorage.setItem('user_data', JSON.stringify(user));

// ✅ CORRECT - Use storage utility
import { storage } from '../utils/storage';
storage.setAuthToken(token);
const token = storage.getAuthToken();
storage.setUserData(user);
```

**HTTP Requests Example:**

```typescript
// ❌ WRONG - Don't do this
fetch('/api/users')
  .then(response => response.json())
  .then(data => console.log(data));

// ✅ CORRECT - Use HTTP service
import { useHttp } from '../hooks/useHttp';
const { get, data, loading, error } = useHttp();
await get('/api/users');
```

**Available Storage Functions:**

- `storage.getAuthToken()` - Get authentication token
- `storage.setAuthToken(token)` - Set authentication token
- `storage.clearAuthToken()` - Clear all auth tokens
- `storage.get(key)` - Generic getter
- `storage.set(key, value)` - Generic setter
- `storage.remove(key)` - Remove specific key
- `storage.clear()` - Clear all storage
- `storage.setUserData(user)` - Set user data
- `storage.getUserData()` - Get user data

### Prettier Configuration

- **Semi**: Always
- **Single Quotes**: Yes
- **Tab Width**: 2 spaces
- **Print Width**: 80 characters
- **Trailing Comma**: ES5

## 🚀 Performance Best Practices

### React Optimization

- **Memo**: Used for expensive components
- **useCallback**: Prevents unnecessary re-renders
- **Bundle Analysis**: Regular bundle size monitoring

### Mobile-First Design Principles

Since this app is for health workers who may use tablets and mobile devices:

- **Responsive Design**: Mobile-first approach with progressive enhancement
- **Touch-Friendly**: Minimum 44px touch targets for buttons and interactive elements
- **Gesture Support**: Swipe gestures for navigation and actions
- **Fast Loading**: Optimized for slower network conditions in rural areas

### HTTP Service & Hooks

The project includes a centralized HTTP service with custom hooks for API calls:

**HTTP Service (`src/services/http.ts`):**

- Axios-based with interceptors
- Automatic auth token handling
- Error handling for 401 responses
- TypeScript support

**Custom Hooks (`src/hooks/useHttp.ts`):**

- `useHttp<T>()` - General HTTP operations with loading/error states
- Built-in state management for requests
- Type-safe API calls

**API Service (`src/services/api.ts`):**

- Predefined endpoints for common operations
- Simple function-based approach
- No complex class hierarchies

**Usage Example:**

```typescript
import { useHttp } from '../hooks/useHttp';
import { apiService } from '../services/api';

function MyComponent() {
  const { get, data, loading, error } = useHttp();

  const fetchData = async () => {
    await get('/api/endpoint');
  };

  // Or use predefined API functions
  const handleLogin = async () => {
    await apiService.login({ email, password });
  };
}
```

## 📈 Monitoring & Analytics

- **Development**: Hot Module Replacement, Bundle Analyzer, TypeScript checking
- **Production**: Bundle analysis, performance metrics, error tracking (Sentry)
- **Quality**: ESLint + Prettier + Husky pre-commit hooks

## 🤝 Contributing

- **Code Quality**: 100% test coverage required
- **Performance**: Bundle size limits enforced
- **Type Safety**: Strict TypeScript configuration
- **Formatting**: Prettier + ESLint auto-fix
- **Pre-commit**: All checks run automatically via Husky

## 🚀 Deployment & CI/CD

### Deployment Checklist

Before deploying to production, ensure:

- [ ] Environment variables configured
- [ ] Build optimization enabled
- [ ] Performance monitoring active
- [ ] Bundle size within limits
- [ ] All tests passing (100% coverage)
- [ ] Pre-commit checks passing

### Build Commands

```bash
# Production build
yarn build

# Bundle analysis (generates dist/stats.html)
yarn analyze

# Verify bundle size
ls -la dist/assets/
```

### Security Audit

```bash
# Dependency security audit
yarn audit

# Check for known vulnerabilities
npm audit

# Review environment variables
grep -r "VITE_" .env*

# Verify no hardcoded secrets
grep -r "password\|secret\|key" src/ --exclude="*.test.*"
```

## 📚 Additional Resources

- [React 19 Documentation](https://react.dev/)
- [Vite Documentation](https://vite.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vitest Testing Guide](https://vitest.dev/)

## 📞 Support

For technical support or questions, please contact the **webapp team lead**.

---

**Built with ❤️ and ☕ for healthcare workers**

# Test commit for personal account

# Another test for account verification
