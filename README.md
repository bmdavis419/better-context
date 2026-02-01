# btca

<a href="https://www.npmjs.com/package/btca"><img alt="npm" src="https://img.shields.io/npm/v/btca?style=flat-square" /></a>

https://btca.dev

Ask your AI agent questions about libraries and frameworks by searching the actual source code, not outdated docs.

## Install

```bash
bun add -g btca opencode-ai
btca config model --provider opencode --model claude-haiku-4-5
```

## Usage

```bash
# Ask a question
btca ask --resource svelte --question "How does the $state rune work?"

# Launch the TUI
btca
```

## Project Setup

Paste this into your AI coding agent to set up btca for your project:

```
Set up btca for this project: scan package.json for major dependencies (frameworks, libraries, tools), suggest adding each as a btca resource with sensible defaults, then create a btca.config.jsonc file in the project root and update AGENTS.md with usage instructions. Ask me to confirm each resource before adding.
```

See the full [Getting Started guide](https://btca.dev/getting-started) for more details.

## Development

This is a Bun monorepo using Turborepo. **Only use `bun`** - never npm/yarn.

### Quick Start

```bash
bun install
bun run dev:web   # Start web app with Convex
bun run dev:cli   # Start CLI in watch mode
bun run server    # Start server in watch mode
bun run cli       # Run CLI (no watch)
```

### Scripts

All scripts use Turborepo for caching. Run from the repository root.

#### Build

| Command             | Description                  |
| ------------------- | ---------------------------- |
| `bun run build:all` | Build all packages           |
| `bun run build:cli` | Build CLI (creates binaries) |
| `bun run build:web` | Build web app                |

#### Type Check

| Command                 | Description               |
| ----------------------- | ------------------------- |
| `bun run check:all`     | Type check all packages   |
| `bun run check:cli`     | Type check CLI            |
| `bun run check:web`     | Type check web app        |
| `bun run check:server`  | Type check server         |
| `bun run check:sandbox` | Type check sandbox        |
| `bun run check:shared`  | Type check shared package |

#### Format

| Command                  | Description           |
| ------------------------ | --------------------- |
| `bun run format:all`     | Format all packages   |
| `bun run format:cli`     | Format CLI            |
| `bun run format:web`     | Format web app        |
| `bun run format:server`  | Format server         |
| `bun run format:sandbox` | Format sandbox        |
| `bun run format:shared`  | Format shared package |

#### Test

| Command               | Description      |
| --------------------- | ---------------- |
| `bun run test:all`    | Run all tests    |
| `bun run test:server` | Run server tests |

#### Other

| Command                         | Description                                       |
| ------------------------------- | ------------------------------------------------- |
| `bun run clean`                 | Remove node_modules, .svelte-kit, .turbo, .vercel |
| `bun run analytics-proxy:build` | Build analytics proxy Docker image                |
| `bun run analytics-proxy:run`   | Run analytics proxy locally                       |

### Packages

| Package                 | Path                   | Description                  |
| ----------------------- | ---------------------- | ---------------------------- |
| `btca`                  | `apps/cli`             | CLI tool                     |
| `btca-server`           | `apps/server`          | API server                   |
| `@btca/web`             | `apps/web`             | Web app (SvelteKit + Convex) |
| `btca-sandbox`          | `apps/sandbox`         | Sandbox environment          |
| `@btca/shared`          | `packages/shared`      | Shared utilities             |
| `@btca/analytics-proxy` | `apps/analytics-proxy` | PostHog analytics proxy      |

## model recs...

**openai**

- "gpt-5.2-codex"

**opencode**

- "claude-sonnet-4-5"
- "claude-haiku-4-5"
- "gemini-3-flash"
- "minimax-m2.1"
