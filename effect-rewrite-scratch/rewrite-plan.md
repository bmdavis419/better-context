# Effect Rewrite Plan (CLI + Server)

## Goals
- Keep all public APIs stable (CLI flags/output, HTTP routes, JSON shapes, SSE events, config file behavior).
- Increase robustness via Effect primitives: typed errors, Layers, resource safety, and structured concurrency.
- Keep Bun runtime (no Node-only APIs). No changes to web app.

## High-Level Architecture

### Server
- Convert core services to Effect services (Context tags + Layers):
  - `ConfigService`, `ResourcesService`, `CollectionsService`, `AgentService`, `StreamService`, `MetricsService`, `Clock`/`Random` if needed.
- Encapsulate side effects with `Effect.tryPromise` and `Effect.acquireRelease`.
- Replace async/throw control flow with `Effect` + tagged errors (`Data.TaggedError` or custom classes).
- Hono route handlers become thin adapters: `Effect.runPromise(appEffect)`.
- SSE is backed by `Effect.Stream` to model streaming events, then adapted to `ReadableStream`.

### CLI
- Keep Commander for argument parsing (stable UX).
- Wrap each command action in `Effect` program:
  - `Effect.runPromise(program)` in `.action`.
  - Use `Effect.log` for structured logs; stdout/stderr handled via thin console service.
- Convert `ensureServer`, `client`, `remote client`, and interactive prompts to Effect-based modules.
- TUI remains in place but its `services.ts` becomes Effect-powered (or continues to call existing client wrappers that are now Effect-backed).

---

## Proposed Module Map (Server)

**New / rewritten modules** (paths are suggested; adjust during implementation):

- `apps/server/src/effect/Context.ts`
  - `RequestContext` service: requestId, txDepth.
  - Effect-friendly context propagation (replace AsyncLocalStorage usage in handlers).

- `apps/server/src/effect/Metrics.ts`
  - `Metrics` service with `info`, `error`, `span`.
  - Keep JSON log shape identical; respect quiet mode.

- `apps/server/src/effect/Config.ts`
  - `ConfigService` with same API as current `Config.Service`.
  - JSONC parsing, legacy migration, default creation.
  - Use `Effect` for FS + IO.

- `apps/server/src/effect/Resources.ts`
  - `ResourcesService` with `load(name, { quiet })`.
  - Git/local resource logic reworked with `Effect`.

- `apps/server/src/effect/Git.ts`
  - `GitRunner` service to isolate git spawn + stderr parsing.
  - Reuse existing error mapping logic; return typed errors.

- `apps/server/src/effect/Collections.ts`
  - `CollectionsService` using `ResourcesService` and `ConfigService`.
  - Use `Effect.forEach` and `Effect.scoped` for symlink + cleanup safety.

- `apps/server/src/effect/Agent.ts`
  - `AgentService` wrapping `AgentLoop` and OpenCode instance compatibility.
  - Use Effect stream for `askStream` and ensure provider auth errors remain tagged.

- `apps/server/src/effect/Stream.ts`
  - `StreamService` converting `AgentLoop.AgentEvent` → SSE stream.
  - Use `Stream` + `Sink` for event accumulation; keep output format.

- `apps/server/src/effect/Tools/*`
  - `read`, `grep`, `glob`, `list` moved to Effect (still exposed to `AgentLoop`).
  - `Sandbox` becomes Effect-aware but same semantics.

- `apps/server/src/effect/App.ts`
  - `createApp` builds Hono routes, each handler maps request -> Effect pipeline.
  - All validation remains with zod, but errors are mapped into typed errors for consistent tags/hints.

- `apps/server/src/index.ts`
  - `startServer` becomes Effect program that builds Layers and runs Hono server.
  - Exports remain identical.

---

## Proposed Module Map (CLI)

- `apps/cli/src/effect/Console.ts`
  - Minimal service for stdout/stderr writes and exit codes.

- `apps/cli/src/effect/ServerManager.ts`
  - Effect version of `ensureServer` with resource management (auto-stop).
  - Health check uses `Effect.retry` + `Schedule` with timeout.

- `apps/cli/src/effect/Client.ts`
  - Effect wrappers for existing client calls, returning typed errors.

- `apps/cli/src/effect/RemoteClient.ts`
  - Effect wrappers for MCP/remote API.

- `apps/cli/src/commands/*`
  - Each command builds an Effect program and runs it.
  - Keep Commander signature, options, and output unchanged.

- `apps/cli/src/tui/services.ts`
  - Keep API but internally call Effect wrappers.

---

## Error Model
- Convert throw-based errors to `TaggedError` types for Effect, preserving tags used in HTTP error mapping:
  - `RequestError`, `ConfigError`, `ResourceError`, `CollectionError`, `AgentError`, `InvalidProviderError`, `InvalidModelError`, `ProviderNotConnectedError`, `PathEscapeError`.
- Ensure tag strings stay identical to current server (`getErrorTag` mapping expects these).

---

## Effect Patterns to Use
- **Services**: `class X extends Context.Tag("X")<X, XService>() {}`
- **Layers**: `Layer.succeed` / `Layer.effect` / `Layer.merge`.
- **I/O**: `Effect.tryPromise` for Bun/fs, `Effect.async` for streams.
- **Resource safety**: `Effect.acquireRelease`, `Effect.scoped` for server lifecycle and temp resources.
- **Concurrency**: `Effect.forEach`, `Effect.fork`, `Effect.all`.
- **Streams**: `Stream.fromAsyncIterable`, `Stream.mapEffect`, `Stream.runForEach`.

---

## Migration Steps (Implementation Order)

1) **Add Effect dependency**
   - Add `effect` to `apps/server/package.json` and `apps/cli/package.json`.

2) **Server core layers**
   - Implement `Metrics`, `Config`, `Resources`, `Collections` as Effect services.
   - Provide adapters that expose same API signatures to existing modules.

3) **Agent + Stream services**
   - Wrap `AgentLoop` in `Effect`.
   - Keep SSE format identical, move to `Stream`.

4) **Hono integration**
   - Provide helper `runEffect(c, effect)` for request handlers.
   - Maintain error mapping into `{ error, tag, hint }` with status logic.

5) **CLI**
   - Replace `ensureServer` with Effect-managed resource.
   - Convert command actions to run Effects.
   - Provide `Effect` versions of `client/*` and `remote` APIs.

6) **Tests**
   - Add unit tests for Effect services (config parsing, resource load, SSE event mapping).
   - Keep bun:test runner; use `Effect.runPromise` in tests.

---

## Tests to Add (First Pass)
- `apps/server/src/stream/service.effect.test.ts`
  - Verify event translation to SSE, done event includes stripped question.
- `apps/server/src/config/config.effect.test.ts`
  - JSONC parsing + migration behavior preserved.
- `apps/server/src/resources/impls/git.effect.test.ts`
  - Validate error mapping on invalid URL/branch (unit-level, no real git).
- `apps/cli/src/server/manager.effect.test.ts`
  - Health check retry logic (mocked fetch).

---

## Compatibility Checklist (Must Not Change)
- CLI flags, prompts, and stdout formatting.
- Hono route paths + response JSON shapes.
- SSE event types + payloads.
- Error tags + hints in error responses.
- Config file search paths and migration rules.

