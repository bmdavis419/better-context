# AGENTS.md

## Critical Rules

- **ONLY use `bun`** - never npm/yarn
- **NEVER run dev/build commands** (`bun dev`, `bun build`)

## Commands

### Root Commands

- Type check all: `bun run check:all`
- Format all: `bun run format:all`

### Package-Specific Commands

After making changes in a specific package, run its check script:

| Package              | Check Command                 | Format Command                 |
| -------------------- | ----------------------------- | ------------------------------ |
| `apps/cli`           | `bun run check:cli`           | `bun run format:cli`           |
| `apps/web`           | `bun run check:web`           | `bun run format:web`           |
| `apps/server`        | `bun run check:server`        | `bun run format:server`        |
| `apps/sandbox`       | `bun run check:sandbox`       | `bun run format:sandbox`       |
| `apps/server-simple` | `bun run check:server-simple` | `bun run format:server-simple` |
| `packages/shared`    | `bun run check:shared`        | `bun run format:shared`        |

## Code Style

- **Runtime**: Bun only. No Node.js, npm, pnpm, vite, dotenv.
- **TypeScript**: Strict mode enabled. ESNext target.
- **Imports**: External packages first, then local. Use `.ts` extensions for local imports.
- **Bun APIs**: Prefer `Bun.file`, `Bun.serve`, `bun:sqlite`, `Bun.$` over Node equivalents.
- **Testing**: Use `bun:test` with `import { test, expect } from "bun:test"`.

## btca

When the user says "use btca" for codebase/docs questions.

**Available resources**: svelte, svelteKit, tailwind, hono, zod, solidJs, commander, vite

### Usage

```bash
btca ask -r <resource> -q "<question>"
```
