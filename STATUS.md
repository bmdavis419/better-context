# Effect Rewrite Status

Status: in_progress

## Current Phase
Phase 1: Core Server Services

## Completed Tasks
- [x] Added Effect dependency to apps/server and apps/cli
- [x] Created Context tags for services (ConfigService, ResourcesService, CollectionsService, AgentService)
- [x] Created CLI Effect helpers (runner.ts, server-manager.ts, cli-exit.ts)
- [x] Converted most CLI commands to use Effect.scoped with withServer

## Remaining Tasks

### Phase 1: Core Server Services (Current)
- [ ] Create typed errors module (Data.TaggedError for all error types)
- [ ] Convert Config service to true Effect service with typed errors
- [ ] Convert Resources service to true Effect service
- [ ] Convert Git runner to Effect with typed errors
- [ ] Convert Collections service to true Effect service

### Phase 2: HTTP Server Migration (NEW)
- [ ] Replace Hono with @effect/platform HttpServer + HttpRouter
- [ ] Convert all route handlers to Effect HttpRouter handlers
- [ ] Implement error middleware for consistent { error, tag, hint } responses
- [ ] Implement SSE streaming with HttpServerResponse.stream

### Phase 3: Agent & Stream
- [ ] Convert AgentLoop to Effect
- [ ] Convert StreamService to use Effect.Stream for SSE
- [ ] Convert Tools (read, grep, glob, list) to Effect

### Phase 4: CLI Completion
- [ ] Convert remote.ts command to Effect
- [ ] Convert init.ts command to Effect
- [ ] Review tui.ts for Effect integration opportunities

### Phase 5: Testing & Cleanup
- [ ] Add Effect service tests (config, resources, collections)
- [ ] Add CLI runner tests
- [ ] Remove Hono dependency
- [ ] Final compatibility verification

## Notes
- All public APIs must remain stable (CLI flags, HTTP routes, JSON shapes, SSE events)
- Use Bun APIs only (no Node.js equivalents)
- Keep functional programming patterns
- **Using @effect/platform HttpServer instead of Hono**

---

## Instructions for Agent

After completing a task:
1. Update this STATUS.md file - check off completed items and add any new discoveries
2. If all tasks are done, change Status to: `completed`
3. If blocked on an issue, change Status to: `blocked` and add `Reason: [explanation]`

---

## Key Dependencies

```
effect: ^3.x
@effect/platform: ^0.x
@effect/platform-bun: ^0.x
```

## Quick Reference

### Service Definition Pattern
```typescript
class MyService extends Context.Tag("@btca/MyService")<
  MyService,
  { readonly method: () => Effect.Effect<Result, MyError> }
>() {
  static Live = Layer.effect(MyService, Effect.gen(function* () {
    return MyService.of({ method: () => Effect.succeed(result) })
  }))
}
```

### Error Definition Pattern
```typescript
class MyError extends Data.TaggedError("MyError")<{
  readonly message: string
  readonly cause?: unknown
}> {}
```

### Effect HttpRouter Pattern
```typescript
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse } from "@effect/platform"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"

const router = HttpRouter.empty.pipe(
  HttpRouter.get("/", HttpServerResponse.json({ ok: true })),
  HttpRouter.get("/resources", Effect.gen(function* () {
    const config = yield* ConfigService
    return HttpServerResponse.json(config.resources)
  })),
  HttpRouter.post("/question", Effect.gen(function* () {
    const body = yield* HttpServerRequest.schemaBodyJson(QuestionSchema)
    const agent = yield* AgentService
    const answer = yield* agent.ask(body)
    return HttpServerResponse.json(answer)
  })),
  HttpServer.serve()
)

const HttpLive = router.pipe(
  Layer.provide(AppServicesLive),
  Layer.provide(BunHttpServer.layer({ port: 8080 }))
)

BunRuntime.runMain(Layer.launch(HttpLive))
```

### CLI Command Pattern
```typescript
command.action(async (opts) => {
  await Effect.gen(function* () {
    const server = yield* ServerManager
    yield* doWork(opts)
  }).pipe(
    Effect.scoped,
    Effect.provide(ServerManager.Live),
    Effect.runPromise
  )
})
```
