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

### Testing Scripts

- `yarn test` - Run tests in watch mode
- `yarn test:ui` - Run tests with Vitest UI
- `yarn test:run` - Run tests once
- `yarn test:coverage` - Run tests with coverage report (100% required)
- `yarn test:watch` - Run tests in watch mode

## 🌐 Access

- **Development**: http://localhost:3000 (optimized port)
- **Production**: [To be configured]

## 📁 Project Structure

```
ih-hw-webapp/
├── src/
│   ├── App.tsx          # Main application component (optimized with memo)
│   ├── main.tsx         # Application entry point
│   ├── App.css          # Main application styles
│   ├── assets/          # Static assets
│   ├── config/          # Configuration files
│   ├── utils/           # Utility functions
│   └── test/            # Test utilities and setup
├── public/               # Public assets
├── .vscode/             # VS Code workspace settings
├── package.json          # Dependencies and scripts
├── vite.config.ts        # Vite configuration (optimized)
├── tsconfig.app.json     # TypeScript config (performance optimized)
├── vitest.config.ts      # Vitest configuration
├── env.example           # Environment variables template
└── README.md            # This file
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

## 🔒 Code Quality

### ESLint Rules

- **No Console**: Prevents console.log in production
- **TypeScript Strict**: Full type safety
- **React Best Practices**: Hooks and component rules
- **Prettier Integration**: Consistent formatting

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
