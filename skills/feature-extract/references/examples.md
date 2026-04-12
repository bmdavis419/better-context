# Feature Extract - Example Extractions

## Example 1: Dark Mode from shadcn/ui

**Command**:
```bash
feature-extract --from https://github.com/shadcn-ui/ui --feature "dark mode"
```

**Output**:
```markdown
# Feature: Dark Mode System

**Source**: https://github.com/shadcn-ui/ui
**Files**: 6 files

## Summary
**Purpose**: Complete dark mode with theme provider, toggle, and CSS variables
**Architecture**: React Context for state, CSS variables for styling, next-themes for persistence
**Key Patterns**: Context pattern, custom hooks, CSS variables, system preference detection

## Files

### components/theme-provider.tsx (core)
**Description**: React Context provider for theme state

```typescript
import { ThemeProvider as NextThemesProvider } from "next-themes"

export function ThemeProvider({ children, ...props }) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>
}
```

### hooks/use-theme.ts (hook)
**Description**: Custom hook to access theme

```typescript
import { useTheme as useNextTheme } from "next-themes"

export function useTheme() {
  return useNextTheme()
}
```

### components/theme-toggle.tsx (ui)
**Description**: Toggle button component

```typescript
export function ThemeToggle() {
  const { theme, setTheme } = useTheme()
  
  return (
    <button onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
      {theme === "dark" ? <Sun /> : <Moon />}
    </button>
  )
}
```

## Dependencies
- next-themes: Theme management for Next.js
- lucide-react: Icons

## Adaptation Notes
1. Install: `npm install next-themes`
2. Wrap app with ThemeProvider
3. Use useTheme hook in components
4. Add dark: variants in Tailwind
```

## Example 2: Hero Section from Taxonomy

**Command**:
```bash
feature-extract --from https://github.com/shadcn/taxonomy --feature "hero section"
```

**Key Files**:
- `app/page.tsx` - Hero component usage
- `components/hero.tsx` - Hero implementation
- `components/animated-text.tsx` - Typewriter effect
- `lib/animations.ts` - Framer Motion variants

**Patterns**:
- Staggered children animations
- Gradient text effects
- Scroll-triggered effects
- CTA button animations

## Example 3: Navigation from Cal.com

**Command**:
```bash
feature-extract --from https://github.com/calcom/cal.com --feature "navigation"
```

**Key Files**:
- `components/layout.tsx` - Main layout with nav
- `components/sidebar.tsx` - Sidebar navigation
- `components/user-menu.tsx` - User dropdown
- `hooks/use-navigation.ts` - Navigation state

**Patterns**:
- Responsive navigation
- Mobile menu with animation
- User menu dropdown
- Active state management
