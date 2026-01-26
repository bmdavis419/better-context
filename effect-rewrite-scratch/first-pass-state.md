# First Pass State (Effect Rewrite)

## Implemented
- Added Effect dependency to `apps/server` and `apps/cli`.
- Server:
  - Added `apps/server/src/effect/services.ts` (Context tags + service provisioning).
  - Rewrote all route handlers in `apps/server/src/index.ts` to run via Effect, with service lookup and effectful metrics/logging.
- CLI:
  - Added Effect helpers: `apps/cli/src/effect/runner.ts`, `apps/cli/src/effect/server-manager.ts`, `apps/cli/src/effect/cli-exit.ts`.
  - Converted commands to Effect execution with scoped server lifecycle:
    - `ask`, `add`, `remove`, `clear`, `connect`, `config`, `repl`, `chat`, `serve`.
  - Removed manual `server.stop()` calls where `withServer` handles cleanup.
- Tests:
  - Added `apps/server/src/stream/service.effect.test.ts` to validate SSE output and question stripping.

## Not Yet Converted (Next Steps)
- **HTTP Server**: Replace Hono with @effect/platform HttpServer + HttpRouter
- CLI commands still imperative:
  - `apps/cli/src/commands/remote.ts`
  - `apps/cli/src/commands/init.ts`
  - `apps/cli/src/commands/tui.ts` (kept as-is for now)
- Potential refactor: move remaining CLI helpers to effectful services (prompts, filesystem, remote client).
- Consider adding more tests around Config/Resources/Collections or CLI runner.

## Compatibility Notes
- No changes to HTTP route paths, JSON shapes, or CLI flags.
- SSE event shapes remain unchanged.

---

## Key Packages to Use

```
effect                    - Core Effect library
@effect/platform          - Cross-platform abstractions (FileSystem, Command, HttpClient, HttpServer, HttpRouter)
@effect/platform-bun      - Bun-specific implementations (BunRuntime, BunContext, BunHttpServer)
@effect/cli               - CLI framework (Command, Args, Options)
```

## Package Installation

```bash
bun add effect @effect/platform @effect/platform-bun @effect/cli
```

---

## Implementation Patterns Discovered

### 1. Service Definition Pattern

The modern Effect pattern uses class syntax extending `Context.Tag`:

```typescript
class MyService extends Context.Tag("@btca/MyService")<
  MyService,
  { readonly method: () => Effect.Effect<Result, MyError> }
>() {
  static Live = Layer.effect(
    MyService,
    Effect.gen(function* () {
      return MyService.of({
        method: () => Effect.succeed(result)
      })
    })
  )
}
```

### 2. Error Handling Pattern

Use `Data.TaggedError` for typed errors that preserve tags for HTTP error mapping:

```typescript
class ConfigError extends Data.TaggedError("ConfigError")<{
  readonly message: string
  readonly cause?: unknown
}> {}
```

### 3. Resource Management

Use `Effect.acquireRelease` + `Effect.scoped` for automatic cleanup:

```typescript
const withServer = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      const server = yield* Effect.acquireRelease(
        startServer(),
        (srv) => Effect.sync(() => srv.stop())
      )
      return yield* effect
    })
  )
```

### 4. Retry Pattern

Combine Schedule functions for robust retry logic:

```typescript
const retryPolicy = Schedule.exponential("100 millis", 2).pipe(
  Schedule.jittered(),
  Schedule.intersect(Schedule.recurs(5)),
  Schedule.whileInput((e: Error) => e.message.includes("temporary"))
)
```

### 5. SSE Stream Pattern

Convert AsyncIterable to Effect.Stream for SSE:

```typescript
const createSseStream = (events: AsyncIterable<Event>) =>
  Stream.fromAsyncIterable(events, (e) => new Error(String(e))).pipe(
    Stream.mapEffect((event) => Effect.try(() => formatSse(event))),
    Stream.catchAll((error) => Stream.make(formatError(error)))
  )
```

### 6. Effect HttpServer Pattern (Replacing Hono)

Use @effect/platform HttpRouter + HttpServer:

```typescript
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse, HttpMiddleware } from "@effect/platform"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"

const router = HttpRouter.empty.pipe(
  HttpRouter.get("/", HttpServerResponse.json({ ok: true })),
  HttpRouter.get("/resources", Effect.gen(function* () {
    const config = yield* ConfigService
    return HttpServerResponse.json(config.resources)
  })),
  HttpRouter.post("/question/stream", Effect.gen(function* () {
    const body = yield* HttpServerRequest.schemaBodyJson(QuestionSchema)
    const agent = yield* AgentService
    const sseStream = yield* agent.askStream(body)
    return HttpServerResponse.stream(Stream.toReadableStream(sseStream), {
      contentType: "text/event-stream"
    })
  })),
  HttpServer.serve(HttpMiddleware.logger)
)

const HttpLive = router.pipe(
  Layer.provide(AppServicesLive),
  Layer.provide(BunHttpServer.layer({ port: 8080 }))
)

BunRuntime.runMain(Layer.launch(HttpLive))
```

### 7. CLI Command Pattern

Keep Commander for parsing, wrap actions in Effect:

```typescript
command.action(async (opts) => {
  await Effect.gen(function* () {
    const server = yield* ServerManager
    yield* processCommand(opts)
  }).pipe(
    Effect.scoped,
    Effect.provide(ServerManager.Live),
    BunRuntime.runMain
  )
})
```

---

## Edge Cases to Handle

### 1. AbortSignal in tryPromise
The `try` function receives an AbortSignal for cancellation support:
```typescript
Effect.tryPromise({
  try: (signal) => fetch(url, { signal }),
  catch: (e) => new FetchError({ cause: e })
})
```

### 2. Exit Parameter in Release
The release function receives the exit status:
```typescript
Effect.acquireRelease(
  acquire,
  (resource, exit) =>
    Exit.isSuccess(exit) ? normalCleanup(resource) : errorCleanup(resource)
)
```

### 3. Defects vs Failures
- **Failure**: Expected, recoverable errors (use `Effect.fail`)
- **Defect**: Unexpected, unrecoverable errors (use `Effect.die`)

### 4. Layer.launch vs Layer.provide
- `Layer.launch`: Run a layer as an application (never returns)
- `Layer.provide`: Compose layers together
- `Effect.provide`: Run an effect with a layer

### 5. Stream Error Handling
Errors in streams don't propagate automatically - use `Stream.catchAll`:
```typescript
stream.pipe(
  Stream.catchAll((error) => Stream.make({ type: "error", data: error.message }))
)
```

### 6. Cleanup Order
Resources are cleaned up in **reverse** order of acquisition.

### 7. HttpRouter Error Handling
Always wrap route handlers with error handling:
```typescript
const withErrorHandling = <A, E extends AppError, R>(
  effect: Effect.Effect<HttpServerResponse.HttpServerResponse, E, R>
) =>
  effect.pipe(
    Effect.catchAll((error) => Effect.succeed(mapErrorToResponse(error)))
  )
```

---

## Files to Reference

- `effect-rewrite-scratch/rewrite-plan.md` - Full architecture and code examples
- `effect-rewrite-scratch/effect-patterns-reference.md` - Comprehensive pattern reference
- `effect-rewrite-scratch/api-surface.md` - Public APIs that must remain stable
