# AGENTS.md

## Critical Rules

- **ONLY use `bun`** - never npm/yarn
- **NEVER run dev/build commands** (`bun dev`, `bun build`)

## Source of Truth

When working on this project, apps/docs is the documentation for the server and cli. Make sure when changing something about how an endpoint or command works, you update the documentation in apps/docs. And if you change something that makes it different from the docs, ask me about it. This does not apply to apps/web or apps/sandbox.

## Commands

### Root Commands

- Type check all: `bun run check:all`
- Format all: `bun run format:all`

### Package-Specific Commands

After making changes in a specific package, run its check script:

| Package              | Check Command                 | Format Command                 |
| -------------------- | ----------------------------- | ------------------------------ |
| `apps/cli`           | `bun run check:cli`           | `bun run format:cli`           |
| `apps/remotion`      | `bun run check:remotion`      | `bun run format:remotion`      |
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
