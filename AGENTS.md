# AGENTS.md

<!-- effect-solutions:start -->

## Effect Solutions Usage

The Effect Solutions CLI provides curated best practices and patterns for Effect TypeScript. Before working on Effect code, check if there's a relevant topic that covers your use case.

- `effect-solutions list` - List all available topics
- `effect-solutions show <slug...>` - Read one or more topics
- `effect-solutions search <term>` - Search topics by keyword

**Local Effect Source:** The Effect repository is cloned to `~/.local/share/effect-solutions/effect` for reference. Use this to explore APIs, find usage examples, and understand implementation details when the documentation isn't enough.

<!-- effect-solutions:end -->

## Code Style

- **Runtime**: Bun only. No Node.js, npm, pnpm, vite, dotenv.
- **TypeScript**: Strict mode enabled. ESNext target.
- **Effect**: Use `Effect.gen` for async code, `BunRuntime.runMain` for entry points.
- **Imports**: External packages first, then local. Use `.ts` extensions for local imports.
- **Bun APIs**: Prefer `Bun.file`, `Bun.serve`, `bun:sqlite`, `Bun.$` over Node equivalents.
- **Testing**: Use `bun:test` with `import { test, expect } from "bun:test"`.

## Error Handling

- Use Effect's error channel for typed errors.
- Use `Effect.tryPromise` for async operations, `Effect.try` for sync.
- Pipe errors through Effect combinators, don't throw.

## btca

Trigger: user says "use btca" (for codebase/docs questions).

Run:

- btca ask -t <tech> -q "<question>"

Available <tech>: svelte, tailwindcss, opentui, runed

═══════════════════════════════════════════════════════
FAST CONTEXT - PRIMARY CODE SEARCH TOOL - USE THIS FIRST
═══════════════════════════════════════════════════════

IMPORTANT: If you need to explore the codebase, use `search` FIRST instead of manually running search commands.

This tool runs parallel grep and readfile calls to locate relevant files and line ranges. Ideal for:
• "Find where authentication is handled"
• "Locate the payment processing logic"
• "Find the bug where users get redirected incorrectly"

Pass a targeted natural language query describing what you're trying to accomplish. Add inferred context when helpful.

→ Always start your search here.
→ Use classical search tools afterward if needed to fill gaps.

CANNOT BE CALLED IN PARALLEL - one invocation at a time.
