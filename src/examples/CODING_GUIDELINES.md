# Coding Guidelines

## 📏 **Simple Rules**

### **File Size**

- **Max 200 lines** per file
- **Target 150-180 lines** for readability

### **Naming**

- **Files**: `kebab-case.tsx` (e.g., `auth.interface.ts`, `user-profile.component.ts`)
- **Interfaces**: `PascalCase` (e.g., `User`, `PatientState`)
- **Functions**: `camelCase` (e.g., `handleLogin`, `fetchPatients`)
- **Constants**: `UPPER_SNAKE_CASE` (e.g., `API_ENDPOINTS`)

### **Structure**

- **One concept** per file
- **Export everything** you want to reuse
- **Import types** from interfaces folder
- **Keep imports** at the top

### **Code Style**

- **2 spaces** for indentation
- **Single quotes** for strings
- **Semicolons** at the end
- **Trailing commas** in objects/arrays

### **Examples**

```typescript
// ✅ Good
export interface User {
  id: string;
  name: string;
}

export const handleUser = (user: User): void => {
  console.log(user.name);
};

// ❌ Bad
interface user {
  id: string;
  name: string;
}

const handle_user = (user: user) => {
  console.log(user.name);
};
```

## 🎯 **Keep It Simple**

- **Keep it simple - avoid over-engineering**
- **Write clear, readable code**
- **Follow established patterns**
- **Add helpful comments for complex logic**
