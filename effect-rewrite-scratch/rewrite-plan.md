# Effect Rewrite Plan (CLI + Server)

## Goals
- Keep all public APIs stable (CLI flags/output, HTTP routes, JSON shapes, SSE events, config file behavior).
- Increase robustness via Effect primitives: typed errors, Layers, resource safety, and structured concurrency.
- Keep Bun runtime (no Node-only APIs). No changes to web app.
- **Use @effect/platform HttpServer instead of Hono** for full Effect integration.

## High-Level Architecture

### Server
- Convert core services to Effect services (Context tags + Layers):
  - `ConfigService`, `ResourcesService`, `CollectionsService`, `AgentService`, `StreamService`, `MetricsService`, `Clock`/`Random` if needed.
- Encapsulate side effects with `Effect.tryPromise` and `Effect.acquireRelease`.
- Replace async/throw control flow with `Effect` + tagged errors (`Data.TaggedError` or custom classes).
- **Use @effect/platform HttpRouter + HttpServer** for all HTTP handling (replacing Hono).
- SSE is backed by `Effect.Stream` to model streaming events, converted via `HttpServerResponse.stream`.

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

- `apps/server/src/effect/Router.ts`
  - **HttpRouter** with all routes defined using `@effect/platform`.
  - Error middleware for consistent `{ error, tag, hint }` responses.

- `apps/server/src/index.ts`
  - `startServer` becomes Effect program that builds Layers and launches HttpServer.
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
- **HTTP**: `HttpRouter`, `HttpServer`, `HttpServerRequest`, `HttpServerResponse` from `@effect/platform`.

---

## Migration Steps (Implementation Order)

1) **Add Effect dependency**
   - Add `effect`, `@effect/platform`, `@effect/platform-bun` to `apps/server/package.json` and `apps/cli/package.json`.

2) **Server core layers**
   - Implement `Metrics`, `Config`, `Resources`, `Collections` as Effect services.
   - Provide adapters that expose same API signatures to existing modules.

3) **Agent + Stream services**
   - Wrap `AgentLoop` in `Effect`.
   - Keep SSE format identical, move to `Stream`.

4) **HTTP Server migration (Replace Hono)**
   - Create `HttpRouter` with all existing routes.
   - Implement error middleware for `{ error, tag, hint }` responses.
   - Use `BunHttpServer.layer` for the server.
   - Remove Hono dependency.

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
- HTTP route paths + response JSON shapes.
- SSE event types + payloads.
- Error tags + hints in error responses.
- Config file search paths and migration rules.

---

# Code Examples & Patterns

## 1. Service Definition Pattern

The modern pattern for defining Effect services:

```typescript
import { Context, Effect, Layer } from "effect"

interface ConfigService {
  readonly resources: ReadonlyArray<Resource>
  readonly model: string
  readonly provider: string
  readonly getResource: (name: string) => Effect.Effect<Resource, ResourceNotFoundError>
  readonly updateModel: (provider: string, model: string) => Effect.Effect<void, ConfigError>
}

class ConfigService extends Context.Tag("@btca/ConfigService")<
  ConfigService,
  ConfigService
>() {
  static Live = Layer.effect(
    ConfigService,
    Effect.gen(function* () {
      const configData = yield* loadConfigFromDisk()
      
      return ConfigService.of({
        resources: configData.resources,
        model: configData.model,
        provider: configData.provider,
        getResource: (name) =>
          Effect.fromNullable(
            configData.resources.find((r) => r.name === name)
          ).pipe(
            Effect.mapError(() => new ResourceNotFoundError({ name }))
          ),
        updateModel: (provider, model) =>
          Effect.gen(function* () {
            configData.provider = provider
            configData.model = model
            yield* persistConfig(configData)
          })
      })
    })
  )
}
```

## 2. Service with Dependencies

When a service depends on other services:

```typescript
class ResourcesService extends Context.Tag("@btca/ResourcesService")<
  ResourcesService,
  {
    readonly load: (name: string, opts: { quiet?: boolean }) => Effect.Effect<BtcaFsResource, ResourceError>
  }
>() {
  static Live = Layer.effect(
    ResourcesService,
    Effect.gen(function* () {
      const config = yield* ConfigService
      const git = yield* GitRunner
      
      return ResourcesService.of({
        load: (name, opts) =>
          Effect.gen(function* () {
            const resource = yield* config.getResource(name)
            if (resource.type === "git") {
              yield* git.cloneOrUpdate(resource, opts)
            }
            return createFsResource(resource)
          })
      })
    })
  ).pipe(
    Layer.provide(ConfigService.Live),
    Layer.provide(GitRunner.Live)
  )
}
```

## 3. Typed Errors with Data.TaggedError

```typescript
import { Data } from "effect"

class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

class ResourceError extends Data.TaggedError("ResourceError")<{
  readonly name: string
  readonly message: string
  readonly hint?: string
}> {}

class GitCloneError extends Data.TaggedError("GitCloneError")<{
  readonly url: string
  readonly branch?: string
  readonly stderr: string
}> {
  get message() {
    return `Failed to clone ${this.url}: ${this.stderr}`
  }
  get hint() {
    if (this.stderr.includes("not found")) {
      return "Check that the repository URL is correct and accessible"
    }
    if (this.stderr.includes("Authentication failed")) {
      return "Check your git credentials"
    }
    return undefined
  }
}

class PathEscapeError extends Data.TaggedError("PathEscapeError")<{
  readonly path: string
  readonly root: string
}> {
  get message() {
    return `Path "${this.path}" escapes sandbox root "${this.root}"`
  }
}
```

## 4. Wrapping Async Code with Effect.tryPromise

```typescript
const loadConfigFromDisk = (path: string) =>
  Effect.tryPromise({
    try: async () => {
      const file = Bun.file(path)
      const text = await file.text()
      return parseJsonc(text)
    },
    catch: (error) =>
      new ConfigError({
        message: `Failed to load config from ${path}`,
        cause: error
      })
  })

const writeFile = (path: string, content: string) =>
  Effect.tryPromise({
    try: () => Bun.write(path, content),
    catch: (error) =>
      new ConfigError({
        message: `Failed to write to ${path}`,
        cause: error
      })
  })
```

## 5. Resource Management with acquireRelease

```typescript
const createServer = (port: number) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const server = Bun.serve({
        port,
        fetch: (req) => handleRequest(req)
      })
      return server
    }),
    (server, exit) =>
      Effect.sync(() => {
        server.stop()
        if (Exit.isFailure(exit)) {
          console.error("Server stopped due to error")
        }
      })
  )

const withServer = <A, E, R>(
  effect: Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* createServer(0)
      return yield* effect
    })
  )
```

## 6. Retry with Schedule

```typescript
import { Effect, Schedule } from "effect"

const healthCheck = (url: string) =>
  Effect.tryPromise({
    try: () => fetch(`${url}/`).then((r) => r.ok),
    catch: () => new Error("Health check failed")
  })

const waitForServer = (url: string) =>
  healthCheck(url).pipe(
    Effect.retry(
      Schedule.exponential("100 millis", 2).pipe(
        Schedule.jittered(),
        Schedule.intersect(Schedule.recurs(10)),
        Schedule.whileInput((error: Error) => 
          error.message.includes("Health check failed")
        )
      )
    ),
    Effect.timeout("30 seconds"),
    Effect.mapError(() => new Error("Server failed to start within timeout"))
  )
```

## 7. SSE with Effect.Stream

```typescript
import { Stream, Effect } from "effect"

interface AgentEvent {
  type: "text.delta" | "reasoning.delta" | "tool.updated" | "done"
  data: unknown
}

const createSseStream = (events: AsyncIterable<AgentEvent>) =>
  Stream.fromAsyncIterable(events, (e) => new Error(String(e))).pipe(
    Stream.mapEffect((event) =>
      Effect.try(() => formatSseEvent(event))
    ),
    Stream.catchAll((error) =>
      Stream.make(formatSseEvent({ type: "error", data: { message: error.message } }))
    )
  )

const formatSseEvent = (event: AgentEvent): string => {
  const data = JSON.stringify(event.data)
  return `event: ${event.type}\ndata: ${data}\n\n`
}

const toReadableStream = (stream: Stream.Stream<string, never, never>) =>
  Stream.toReadableStream(stream)
```

## 8. Process Spawning with @effect/platform

```typescript
import * as Command from "@effect/platform/Command"
import { Effect, Stream } from "effect"

const runGitClone = (url: string, dest: string, branch?: string) =>
  Effect.gen(function* () {
    const args = ["clone", "--depth", "1"]
    if (branch) args.push("--branch", branch)
    args.push(url, dest)
    
    const result = yield* Command.make("git", ...args).pipe(
      Command.exitCode()
    )
    
    if (result !== 0) {
      const stderr = yield* Command.make("git", ...args).pipe(
        Command.stderr({ encoding: "utf-8" })
      )
      yield* Effect.fail(new GitCloneError({ url, branch, stderr }))
    }
  })

const runGitFetch = (repoPath: string) =>
  Command.make("git", "fetch", "--all").pipe(
    Command.workingDirectory(repoPath),
    Command.exitCode(),
    Effect.flatMap((code) =>
      code === 0
        ? Effect.void
        : Effect.fail(new GitFetchError({ path: repoPath }))
    )
  )
```

## 9. Effect HttpServer Pattern (Replacing Hono)

```typescript
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse, HttpMiddleware } from "@effect/platform"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Effect, Layer, Schema } from "effect"

const QuestionSchema = Schema.Struct({
  question: Schema.String,
  resources: Schema.optional(Schema.Array(Schema.String)),
  quiet: Schema.optional(Schema.Boolean)
})

const mapErrorToResponse = (error: AppError) => {
  const tag = error._tag
  const hint = "hint" in error ? error.hint : undefined
  
  const status = 
    tag === "ConfigError" ? 500 :
    tag === "ResourceError" ? 404 :
    tag === "PathEscapeError" ? 400 :
    500
  
  return HttpServerResponse.json(
    { error: error.message, tag, hint },
    { status }
  )
}

const withErrorHandling = <A, E extends AppError, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catchAll((error) => Effect.succeed(mapErrorToResponse(error)))
  )

const router = HttpRouter.empty.pipe(
  HttpRouter.get("/", 
    HttpServerResponse.json({ ok: true, service: "btca-server", version: "0.0.1" })
  ),
  
  HttpRouter.get("/config",
    withErrorHandling(
      Effect.gen(function* () {
        const config = yield* ConfigService
        return HttpServerResponse.json({
          provider: config.provider,
          model: config.model,
          resourceCount: config.resources.length
        })
      })
    )
  ),
  
  HttpRouter.get("/resources",
    withErrorHandling(
      Effect.gen(function* () {
        const config = yield* ConfigService
        return HttpServerResponse.json(config.resources)
      })
    )
  ),
  
  HttpRouter.put("/config/model",
    withErrorHandling(
      Effect.gen(function* () {
        const body = yield* HttpServerRequest.schemaBodyJson(
          Schema.Struct({ provider: Schema.String, model: Schema.String })
        )
        const config = yield* ConfigService
        yield* config.updateModel(body.provider, body.model)
        return HttpServerResponse.json({ provider: body.provider, model: body.model })
      })
    )
  ),
  
  HttpRouter.post("/config/resources",
    withErrorHandling(
      Effect.gen(function* () {
        const body = yield* HttpServerRequest.schemaBodyJson(ResourceSchema)
        const config = yield* ConfigService
        yield* config.addResource(body)
        return HttpServerResponse.json(body, { status: 201 })
      })
    )
  ),
  
  HttpRouter.delete("/config/resources",
    withErrorHandling(
      Effect.gen(function* () {
        const body = yield* HttpServerRequest.schemaBodyJson(
          Schema.Struct({ name: Schema.String })
        )
        const config = yield* ConfigService
        yield* config.removeResource(body.name)
        return HttpServerResponse.json({ removed: body.name })
      })
    )
  ),
  
  HttpRouter.get("/providers",
    withErrorHandling(
      Effect.gen(function* () {
        const agent = yield* AgentService
        const providers = yield* agent.listProviders()
        return HttpServerResponse.json(providers)
      })
    )
  ),
  
  HttpRouter.post("/question",
    withErrorHandling(
      Effect.gen(function* () {
        const body = yield* HttpServerRequest.schemaBodyJson(QuestionSchema)
        const agent = yield* AgentService
        const answer = yield* agent.ask(body)
        return HttpServerResponse.json(answer)
      })
    )
  ),
  
  HttpRouter.post("/question/stream",
    withErrorHandling(
      Effect.gen(function* () {
        const body = yield* HttpServerRequest.schemaBodyJson(QuestionSchema)
        const agent = yield* AgentService
        const sseStream = yield* agent.askStream(body)
        return HttpServerResponse.stream(
          Stream.toReadableStream(sseStream),
          {
            contentType: "text/event-stream",
            headers: {
              "Cache-Control": "no-cache",
              "Connection": "keep-alive"
            }
          }
        )
      })
    )
  ),
  
  HttpRouter.post("/clear",
    withErrorHandling(
      Effect.gen(function* () {
        const config = yield* ConfigService
        const cleared = yield* config.clearResources()
        return HttpServerResponse.json({ cleared })
      })
    )
  ),
  
  HttpServer.serve(HttpMiddleware.logger),
  HttpServer.withLogAddress
)
```

## 10. CLI Command Pattern

```typescript
import { Command } from "commander"
import { Effect } from "effect"
import { BunRuntime, BunContext } from "@effect/platform-bun"

const askCommand = new Command("ask")
  .option("-q, --question <text>", "Question to ask")
  .option("-r, --resource <name...>", "Resources to use")
  .action(async (opts) => {
    const program = Effect.gen(function* () {
      const server = yield* ServerManager
      const client = yield* HttpClient
      
      const response = yield* client.post("/question/stream", {
        question: opts.question,
        resources: opts.resource
      })
      
      yield* Stream.fromReadableStream(
        () => response.body,
        (e) => new Error(String(e))
      ).pipe(
        Stream.decodeText(),
        Stream.runForEach((chunk) => Effect.sync(() => process.stdout.write(chunk)))
      )
    })
    
    await program.pipe(
      Effect.provide(BunContext.layer),
      Effect.provide(ServerManager.Live),
      BunRuntime.runMain
    )
  })
```

## 11. Layer Composition for Full Application

```typescript
import { Layer, Effect } from "effect"
import { BunHttpServer, BunRuntime, BunContext } from "@effect/platform-bun"

const ConfigLive = ConfigService.Live

const GitRunnerLive = GitRunner.Live.pipe(
  Layer.provide(BunContext.layer)
)

const ResourcesLive = ResourcesService.Live.pipe(
  Layer.provide(ConfigLive),
  Layer.provide(GitRunnerLive)
)

const CollectionsLive = CollectionsService.Live.pipe(
  Layer.provide(ConfigLive),
  Layer.provide(ResourcesLive)
)

const AgentLive = AgentService.Live.pipe(
  Layer.provide(ConfigLive),
  Layer.provide(CollectionsLive)
)

const AppServicesLive = Layer.mergeAll(
  ConfigLive,
  ResourcesLive,
  CollectionsLive,
  AgentLive
)

const ServerLive = BunHttpServer.layer({ port: 8080 })

const HttpLive = router.pipe(
  Layer.provide(AppServicesLive),
  Layer.provide(ServerLive)
)

BunRuntime.runMain(Layer.launch(HttpLive))
```

## 12. Complete Server Entry Point

```typescript
import { HttpRouter, HttpServer, HttpServerResponse, HttpMiddleware } from "@effect/platform"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Effect, Layer } from "effect"

export const startServer = (options: { port?: number } = {}) => {
  const port = options.port ?? 8080
  
  const ServerLive = BunHttpServer.layer({ port })
  
  const HttpLive = router.pipe(
    Layer.provide(AppServicesLive),
    Layer.provide(ServerLive)
  )
  
  return Layer.launch(HttpLive)
}

if (import.meta.main) {
  const port = Number(process.env.PORT) || 8080
  BunRuntime.runMain(startServer({ port }))
}
```

---

# Edge Cases & Gotchas

## 1. Effect.gen vs pipe - When to Use Each

**Use Effect.gen when:**
- Complex control flow (loops, conditionals)
- Multiple variables needed in scope
- Sequential business logic

**Use pipe when:**
- Simple linear transformations
- Building reusable operators
- Library code

**Hybrid approach (recommended):**
```typescript
const program = Effect.gen(function* () {
  const user = yield* fetchUser()
  const profile = yield* pipe(
    getProfile(user.id),
    Effect.tap(() => Effect.log(`Loaded profile for ${user.name}`)),
    Effect.retry(Schedule.recurs(3))
  )
  return profile
})
```

## 2. Layer.launch vs Layer.provide vs Effect.provide

| Function | Purpose | Use When |
|----------|---------|----------|
| `Layer.launch` | Run layer as application | Entire app is a layer (servers) |
| `Layer.provide` | Compose layers | Layer depends on another layer |
| `Effect.provide` | Run effect with services | Single effect needs services |

## 3. Scoped Resources Must Be Consumed

```typescript
const resource = Effect.acquireRelease(acquire, release)

const bad = resource
const good = Effect.scoped(resource)
```

## 4. Stream Error Handling

```typescript
const stream = Stream.fromAsyncIterable(events, (e) => new Error(String(e))).pipe(
  Stream.mapEffect((event) => processEvent(event)),
  Stream.catchAll((error) =>
    Stream.make({ type: "error", data: error.message })
  ),
  Stream.ensuring(Effect.log("Stream completed"))
)
```

## 5. Cleanup Order in acquireRelease

Resources are cleaned up in **reverse** order of acquisition:

```typescript
Effect.gen(function* () {
  const db = yield* acquireDb()
  const cache = yield* acquireCache()
  const server = yield* acquireServer()
})
```

## 6. AbortSignal in tryPromise

```typescript
const fetchWithCancel = Effect.tryPromise({
  try: (signal: AbortSignal) =>
    fetch(url, { signal }),
  catch: (error) => new FetchError({ cause: error })
})
```

## 7. Exit Parameter in Release

```typescript
Effect.acquireRelease(
  acquire,
  (resource, exit) =>
    Exit.isSuccess(exit)
      ? normalCleanup(resource)
      : errorCleanup(resource, Exit.causeSync(exit))
)
```

## 8. Defects vs Failures

- **Failure**: Expected, recoverable errors (use `Effect.fail`)
- **Defect**: Unexpected, unrecoverable errors (use `Effect.die`)

```typescript
const safeOperation = Effect.try({
  try: () => riskyOperation(),
  catch: (e) => new ExpectedError({ cause: e })
})

const operation = Effect.sync(() => {
  if (impossibleCondition) {
    throw new Error("This should never happen")
  }
})
```

## 9. HttpRouter Error Handling

Always wrap route handlers with error handling to ensure consistent responses:

```typescript
const withErrorHandling = <A, E extends AppError, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
): Effect.Effect<HttpServerResponse.HttpServerResponse, never, R> =>
  effect.pipe(
    Effect.catchAll((error) => Effect.succeed(mapErrorToResponse(error)))
  )

HttpRouter.get("/route", withErrorHandling(
  Effect.gen(function* () {
    const result = yield* someOperation()
    return HttpServerResponse.json(result)
  })
))
```

## 10. SSE Streaming with HttpServerResponse

```typescript
HttpRouter.post("/question/stream",
  withErrorHandling(
    Effect.gen(function* () {
      const body = yield* HttpServerRequest.schemaBodyJson(QuestionSchema)
      const agent = yield* AgentService
      const sseStream = yield* agent.askStream(body)
      
      return HttpServerResponse.stream(
        Stream.toReadableStream(sseStream),
        {
          contentType: "text/event-stream",
          headers: {
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
          }
        }
      )
    })
  )
)
```
