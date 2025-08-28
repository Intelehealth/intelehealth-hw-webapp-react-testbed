# Intelehealth Health Worker Webapp

A modern, high-performance web application built for health workers, providing an intuitive interface for managing healthcare workflows and patient interactions.

## 🚀 Tech Stack

- **Frontend Framework**: React 19 with TypeScript
- **Build Tool**: Vite 7.1.3 (optimized for performance)
- **Package Manager**: Yarn
- **Language**: TypeScript (strict mode enabled)
- **Styling**: CSS with modern design principles
- **Testing**: Vitest + React Testing Library (100% coverage required)

## ⚡ Performance Features

- **Code Splitting**: Vendor chunks separated
- **Bundle Optimization**: ESBuild minification with ES2020 target
- **TypeScript Incremental Builds**: Faster compilation
- **Optimized Dependencies**: Selective dependency optimization
- **Production Build**: Optimized for minimal bundle size

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

### VS Code Setup (Recommended)

This project includes VS Code workspace settings to ensure consistent development experience across all team members.

1. **Install VS Code Extensions**: When you open the project in VS Code, you'll be prompted to install recommended extensions. Click "Install All" to get:
   - Prettier (Code formatter)
   - ESLint (Linting)
   - TypeScript support
   - Auto Rename Tag
   - Path Intellisense
   - And more...

2. **Workspace Settings**: The project includes `.vscode/settings.json` with:
   - Auto-formatting on save
   - ESLint auto-fix on save
   - Consistent code formatting rules
   - TypeScript preferences
   - File nesting patterns
   - Git integration settings

3. **Benefits**:
   - Consistent code style across the team
   - Automatic formatting and linting
   - Better TypeScript support
   - Improved development workflow

### Available Scripts

- `yarn dev` - Start development server with hot reload
- `yarn build` - Build for production (optimized)
- `yarn lint` - Run ESLint for code quality
- `yarn lint:fix` - Auto-fix ESLint issues
- `yarn format` - Format code with Prettier
- `yarn format:check` - Check code formatting
- `yarn preview` - Preview production build locally
- `yarn analyze` - Analyze bundle size and composition (generates visual report)

### Testing Scripts

- `yarn test` - Run tests in watch mode
- `yarn test:ui` - Run tests with Vitest UI
- `yarn test:run` - Run tests once
- `yarn test:coverage` - Run tests with coverage report (100% required)
- `yarn test:watch` - Run tests in watch mode

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
│   ├── config/                    # Configuration files
│   ├── services/                  # HTTP and API services
│   ├── hooks/                     # Custom React hooks
│   ├── utils/                     # Utility functions (storage, etc.)
│   ├── test/                      # Test utilities and setup
│   └── modules/                   # Feature-based modules
│       ├── auth/                  # Authentication module
│       │   ├── login.component.ts # Login component
│       │   ├── auth.service.ts    # Authentication service
│       │   ├── auth.hook.ts       # Authentication hooks
│       │   └── auth.types.ts      # Authentication type definitions
│       ├── dashboard/             # Dashboard module
│       │   ├── dashboard.component.ts # Dashboard component
│       │   ├── dashboard.service.ts    # Dashboard service
│       │   └── dashboard.hook.ts       # Dashboard hooks
│       └── patients/              # Patients module
│           ├── patient-list.component.ts # Patient list component
│           ├── patient.service.ts        # Patient service
│           └── patient.hook.ts           # Patient hooks
├── public/                        # Public assets
├── .vscode/                       # VS Code workspace settings
├── package.json                   # Dependencies and scripts
├── vite.config.ts                 # Vite configuration (optimized)
├── tsconfig.app.json              # TypeScript config (performance optimized)
├── vitest.config.ts               # Vitest configuration
├── env.example                    # Environment variables template
└── README.md                     # This file
```

### 📝 File Naming Convention

The project follows a consistent naming convention for different file types:

- **Components**: `.component.ts` (e.g., `login.component.ts`, `dashboard.component.ts`)
- **Services**: `.service.ts` (e.g., `auth.service.ts`, `patient.service.ts`)
- **Hooks**: `.hook.ts` (e.g., `auth.hook.ts`, `patient.hook.ts`)
- **Types**: `.types.ts` (e.g., `auth.types.ts`, `patient.types.ts`)
- **Utilities**: `.util.ts` (e.g., `storage.util.ts`, `validation.util.ts`)
- **Constants**: `.constant.ts` (e.g., `api.constant.ts`, `routes.constant.ts`)

### 🏗️ Module Structure

Each module follows a consistent structure:

```
modules/
└── [feature-name]/
    ├── [feature-name].component.ts    # Main component
    ├── [feature-name].service.ts      # Business logic
    ├── [feature-name].hook.ts         # Custom hooks
    ├── [feature-name].types.ts        # Type definitions
    ├── [feature-name].constant.ts     # Module constants
    ├── [feature-name].util.ts         # Module utilities
    └── [feature-name].test.ts         # Module tests
```

## 🚀 Build Optimizations

### Vite Configuration

- **Target**: ES2020 for modern browsers
- **Minification**: ESBuild with aggressive optimization
- **Code Splitting**: Vendor chunks
- **Source Maps**: Disabled in production
- **Dependency Optimization**: Selective include/exclude

### TypeScript Configuration

- **Incremental Builds**: Faster compilation
- **Strict Mode**: Full type safety
- **Build Info**: Optimized build caching
- **Performance**: Optimized for development speed

### Performance Features

- **Memoized Components**: React performance optimization
- **Bundle Analysis**: Chunk size warnings and limits

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

### Test Examples

```typescript
// Example test structure for components
import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import LoginComponent from './login.component';

describe('Login Component', () => {
  it('should render login form', () => {
    render(<LoginComponent />);
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
  });

  it('should handle form submission', async () => {
    // Test implementation
  });
});

// Example test structure for services
describe('Auth Service', () => {
  it('should authenticate user with valid credentials', async () => {
    // Test implementation
  });
});
```

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

### Build Optimization

- **Tree Shaking**: Unused code elimination
- **Minification**: Aggressive code compression
- **Chunk Splitting**: Optimal bundle distribution
- **Dependency Optimization**: Selective bundling

## 📈 Monitoring & Analytics

### Development Tools

- **Hot Module Replacement**: Instant updates
- **Bundle Analyzer**: Size optimization
- **TypeScript**: Real-time type checking
- **ESLint**: Code quality monitoring

### Production Monitoring

- **Bundle Analysis**: Size monitoring
- **Performance Metrics**: Core Web Vitals
- **User Analytics**: [Future implementation]

## 🤝 Contributing

### Development Workflow

1. **Code Quality**: 100% test coverage required
2. **Performance**: Bundle size limits enforced
3. **Type Safety**: Strict TypeScript configuration
4. **Formatting**: Prettier + ESLint auto-fix

## 🚀 Deployment & CI/CD

### Deployment Checklist

Before deploying to production, ensure:

- [ ] Environment variables configured
- [ ] Build optimization enabled
- [ ] Performance monitoring active
- [ ] Bundle size within limits
- [ ] All tests passing (100% coverage)

### Build Optimization

```bash
# Production build
yarn build

# Bundle analysis (generates dist/stats.html)
yarn analyze

# Verify bundle size
ls -la dist/assets/
```

**Bundle Analysis Features:**

- **Visual Report**: Opens `dist/stats.html` in browser automatically
- **Gzip & Brotli**: Shows compressed sizes for optimization
- **Chunk Breakdown**: Detailed view of vendor vs. app code
- **Size Tracking**: Monitor bundle growth over time

### Performance Monitoring

- **Core Web Vitals**: LCP, FID, CLS monitoring
- **Bundle Size**: Regular analysis and optimization
- **Error Tracking**: Sentry integration for production errors
- **User Experience**: Real User Monitoring (RUM)

### Security Audit

Before deployment, complete security checks:

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

**Security Checklist:**

- [ ] No hardcoded API keys or secrets
- [ ] Environment variables properly configured
- [ ] Dependencies updated and secure

### Pull Request Requirements

- All tests passing
- 100% code coverage
- No linting errors
- Proper TypeScript types
- Performance impact documented

## 📚 Additional Resources

- [React 19 Documentation](https://react.dev/)
- [Vite Documentation](https://vite.dev/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)
- [Vitest Testing Guide](https://vitest.dev/)

## 📞 Support

For technical support or questions, please contact the **webapp team lead**.

---

**Built with ❤️ and ☕ for healthcare workers**
