# Feature Extract - Common Patterns Guide

## Pattern 1: React Context for Global State

**When to use**: Theme, auth, user preferences

**Structure**:
```
context/
├── provider.tsx    # Context provider component
├── hook.ts         # Custom hook to access context
└── types.ts        # Type definitions
```

**Example**: Dark mode, authentication, settings

## Pattern 2: Custom Hooks for Logic

**When to use**: Reusable logic, data fetching, animations

**Naming**: `use[Feature]` (useTheme, useAuth, useAnimation)

**Structure**:
```typescript
export function useFeature() {
  // State
  // Effects
  // Handlers
  return { data, loading, error, actions }
}
```

## Pattern 3: Component Composition

**When to use**: Complex UI components (forms, modals, cards)

**Structure**:
```
Component/
├── index.tsx       # Main component
├── parts.tsx       # Sub-components
├── types.ts        # Types
└── utils.ts        # Helpers
```

**Example**: Form (Form, Field, Label, Error), Card (Card, Header, Content, Footer)

## Pattern 4: Feature-Based Organization

**When to use**: Large features with multiple files

**Structure**:
```
features/
├── auth/
│   ├── components/   # UI components
│   ├── hooks/        # Custom hooks
│   ├── lib/          # Utilities
│   ├── types.ts      # Types
│   └── index.ts      # Public API
```

## Pattern 5: Animation Variants

**When to use**: Framer Motion animations

**Structure**:
```typescript
// lib/animations.ts
export const fadeIn = {
  hidden: { opacity: 0 },
  visible: { opacity: 1 }
}

export const staggerContainer = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.1
    }
  }
}
```

**Usage**:
```tsx
<motion.div variants={fadeIn} initial="hidden" animate="visible" />
```

## Pattern 6: Form Handling

**When to use**: Forms with validation

**Structure**:
```
Form/
├── index.tsx       # Form component
├── schema.ts       # Validation schema (zod/yup)
├── fields.tsx      # Field components
└── types.ts        # Form types
```

**Libraries**: react-hook-form + zod (common pattern)

## Pattern 7: Responsive Design

**When to use**: Mobile-first responsive layouts

**Approach**:
- Use Tailwind responsive prefixes: `sm:`, `md:`, `lg:`, `xl:`
- Mobile-first: base styles for mobile, enhance for larger screens
- Container queries for component-level responsiveness

## Pattern 8: Dark Mode with CSS Variables

**When to use**: Theme switching

**Structure**:
```css
/* globals.css */
:root {
  --background: 0 0% 100%;
  --foreground: 222.2 84% 4.9%;
}

.dark {
  --background: 222.2 84% 4.9%;
  --foreground: 210 40% 98%;
}
```

```tsx
// Usage
<div className="bg-background text-foreground" />
```

## Pattern 9: Data Fetching with SWR/React Query

**When to use**: API data fetching

**Structure**:
```typescript
// hooks/use-data.ts
export function useData() {
  return useSWR('/api/data', fetcher)
}

// Usage
const { data, error, isLoading } = useData()
```

## Pattern 10: Error Boundaries

**When to use**: Graceful error handling

**Structure**:
```typescript
// components/error-boundary.tsx
export class ErrorBoundary extends React.Component {
  // Error handling logic
  // Fallback UI
}
```
