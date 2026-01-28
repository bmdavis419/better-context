# Effect Patterns Reference

Comprehensive reference for Effect patterns used in the btca rewrite. All examples are based on the Effect.ts monorepo.

---

## Table of Contents
1. [Service Definition](#1-service-definition)
2. [Typed Errors](#2-typed-errors)
3. [Wrapping Async/Sync Code](#3-wrapping-asyncsync-code)
4. [Resource Management](#4-resource-management)
5. [Retry & Schedule](#5-retry--schedule)
6. [Stream & SSE](#6-stream--sse)
7. [Process Spawning](#7-process-spawning)
8. [HTTP Server](#8-http-server)
9. [CLI with @effect/cli](#9-cli-with-effectcli)
10. [Bun Platform Integration](#10-bun-platform-integration)
11. [Effect.gen vs pipe](#11-effectgen-vs-pipe)
12. [Layer Composition](#12-layer-composition)
13. [Edge Cases & Gotchas](#13-edge-cases--gotchas)

---

## 1. Service Definition

### Basic Service Pattern

```typescript
import { Context, Effect, Layer } from "effect"

interface TodoService {
  readonly create: (todo: TodoData) => Effect.Effect<Todo, Error>
  readonly findById: (id: number) => Effect.Effect<Todo, Error>
}

class TodoService extends Context.Tag("@app/TodoService")<
  TodoService,
  TodoService
>() {
  static Live = Layer.effect(
    TodoService,
    Effect.gen(function* () {
      return TodoService.of({
        create: (todo) => Effect.succeed({ id: 1, ...todo }),
        findById: (id) => Effect.succeed({ id, title: "test" })
      })
    })
  )
}
```

### Service with Dependencies

```typescript
class UserRepository extends Context.Tag("@app/UserRepository")<
  UserRepository,
  { readonly findById: (id: number) => Effect.Effect<User, Error> }
>() {
  static Live = Layer.effect(
    UserRepository,
    Effect.gen(function* () {
      const db = yield* DatabaseService
      return UserRepository.of({
        findById: (id) => db.query(`SELECT * FROM users WHERE id = ${id}`)
      })
    })
  ).pipe(Layer.provide(DatabaseService.Live))
}
```

### Service with Scoped Resources

```typescript
class DatabasePool extends Context.Tag("@app/DatabasePool")<
  DatabasePool,
  { readonly query: (sql: string) => Effect.Effect<unknown, Error> }
>() {
  static Live = Layer.scoped(
    DatabasePool,
    Effect.acquireRelease(
      Effect.sync(() => createPool()),
      (pool) => Effect.sync(() => pool.close())
    )
  )
}
```

### Using Layer.succeed for Static Values

```typescript
class Config extends Context.Tag("@app/Config")<
  Config,
  { readonly apiUrl: string; readonly timeout: number }
>() {
  static Live = Layer.succeed(
    Config,
    Config.of({ apiUrl: "https://api.example.com", timeout: 5000 })
  )
}
```

---

## 2. Typed Errors

### Basic TaggedError

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
      return "Check that the repository URL is correct"
    }
    return undefined
  }
}
```

### Schema-Based TaggedError

```typescript
import { Schema } from "effect"

class MyError extends Schema.TaggedError<MyError>()("MyError", {
  id: Schema.Number,
  message: Schema.String,
  cause: Schema.optional(Schema.Defect)
}) {}
```

### Error Hierarchies

```typescript
class ShipExistsError extends Data.TaggedError("ShipExistsError")<{
  readonly name: string
}> {}

class ShipNotFoundError extends Data.TaggedError("ShipNotFoundError")<{
  readonly name: string
}> {}

class CoordinatesOccupiedError extends Data.TaggedError("CoordinatesOccupiedError")<{
  readonly name: string
  readonly x: number
  readonly y: number
}> {}

type ShipError = ShipExistsError | ShipNotFoundError | CoordinatesOccupiedError
```

### Catching Specific Errors

```typescript
const effect: Effect.Effect<void, ShipExistsError | ShipNotFoundError> = ...

const recovered = effect.pipe(
  Effect.catchTag("ShipNotFoundError", (error) =>
    Effect.log(`Ship not found: ${error.name}`)
  )
)

const recoveredAll = effect.pipe(
  Effect.catchTags({
    ShipExistsError: (e) => Effect.log(`Ship exists: ${e.name}`),
    ShipNotFoundError: (e) => Effect.log(`Ship not found: ${e.name}`)
  })
)
```

### Mapping Errors

```typescript
const mapped = effect.pipe(
  Effect.mapError((error) =>
    new ApplicationError({ cause: error, context: "Operation failed" })
  )
)
```

---

## 3. Wrapping Async/Sync Code

### Effect.try - Synchronous with Errors

```typescript
const parseJson = (input: string) =>
  Effect.try({
    try: () => JSON.parse(input),
    catch: (error) => new ParseError({ message: `Failed to parse: ${error}` })
  })

const parseJsonSimple = (input: string) =>
  Effect.try(() => JSON.parse(input))
```

### Effect.sync - Synchronous without Errors

```typescript
const log = (message: string) =>
  Effect.sync(() => console.log(message))

const getCurrentTime = () =>
  Effect.sync(() => Date.now())
```

### Effect.tryPromise - Async with Errors

```typescript
const fetchData = (url: string) =>
  Effect.tryPromise({
    try: () => fetch(url).then((r) => r.json()),
    catch: (error) => new FetchError({ url, cause: error })
  })

const fetchWithSignal = (url: string) =>
  Effect.tryPromise({
    try: (signal: AbortSignal) =>
      fetch(url, { signal }).then((r) => r.json()),
    catch: (error) => new FetchError({ url, cause: error })
  })
```

### Effect.promise - Async without Errors

```typescript
const delay = (ms: number) =>
  Effect.promise(() => new Promise((resolve) => setTimeout(resolve, ms)))
```

---

## 4. Resource Management

### Basic acquireRelease

```typescript
const openFile = (path: string) =>
  Effect.acquireRelease(
    Effect.tryPromise(() => Bun.file(path).text()),
    () => Effect.sync(() => console.log("File closed"))
  )
```

### With Exit Status

```typescript
const createConnection = () =>
  Effect.acquireRelease(
    Effect.sync(() => new Connection()),
    (conn, exit) =>
      Effect.sync(() => {
        if (Exit.isSuccess(exit)) {
          conn.close()
        } else {
          conn.forceClose()
          console.error("Connection closed due to error")
        }
      })
  )
```

### Composing Multiple Resources

```typescript
const application = Effect.gen(function* () {
  const db = yield* acquireDatabase()
  const cache = yield* acquireCache()
  const server = yield* acquireServer()
  return { db, cache, server }
})

Effect.runPromise(Effect.scoped(application))
```

### Server Lifecycle

```typescript
const createServer = (port: number) =>
  Effect.acquireRelease(
    Effect.sync(() => {
      const server = Bun.serve({ port, fetch: handleRequest })
      return server
    }),
    (server) =>
      Effect.sync(() => {
        server.stop()
      })
  )

const withServer = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
  Effect.scoped(
    Effect.gen(function* () {
      yield* createServer(8080)
      return yield* effect
    })
  )
```

---

## 5. Retry & Schedule

### Schedule.spaced - Fixed Delay

```typescript
const policy = Schedule.spaced("100 millis")
const retried = Effect.retry(task, policy)
```

### Schedule.exponential - Exponential Backoff

```typescript
const policy = Schedule.exponential("100 millis", 2)
const retried = Effect.retry(task, policy)
```

### Schedule.recurs - Max Retries

```typescript
const policy = Schedule.recurs(5)
const retried = Effect.retry(task, policy)
```

### Combined: Exponential + Max Retries + Jitter

```typescript
const policy = Schedule.exponential("100 millis", 2).pipe(
  Schedule.jittered(),
  Schedule.intersect(Schedule.recurs(5))
)
const retried = Effect.retry(task, policy)
```

### Retry Only Specific Errors

```typescript
const policy = Schedule.spaced("100 millis").pipe(
  Schedule.whileInput((error: AppError) => error._tag === "TemporaryError")
)

const retried = Effect.retryOrElse(
  task,
  policy,
  (error) => Effect.succeed("fallback")
)
```

### Complete Retry Pattern

```typescript
const resilientFetch = (url: string) =>
  Effect.tryPromise({
    try: () => fetch(url).then((r) => r.json()),
    catch: (e) => new FetchError({ url, cause: e })
  }).pipe(
    Effect.retry(
      Schedule.exponential("100 millis", 2).pipe(
        Schedule.jittered(),
        Schedule.intersect(Schedule.recurs(5)),
        Schedule.whileInput((e: FetchError) => !e.cause?.message?.includes("404"))
      )
    ),
    Effect.timeout("30 seconds"),
    Effect.catchAll((e) => Effect.succeed({ error: e.message }))
  )
```

---

## 6. Stream & SSE

### Create Stream from AsyncIterable

```typescript
const stream = Stream.fromAsyncIterable(
  asyncGenerator(),
  (error) => new Error(String(error))
)
```

### Transform with mapEffect

```typescript
const transformed = stream.pipe(
  Stream.mapEffect((event) =>
    Effect.try(() => JSON.stringify(event))
  )
)

const parallel = stream.pipe(
  Stream.mapEffect((event) => processEvent(event), { concurrency: 5 })
)
```

### Error Handling in Streams

```typescript
const safe = stream.pipe(
  Stream.catchAllCause(() => Stream.make({ type: "error", data: "Stream failed" })),
  Stream.ensuring(Effect.log("Stream completed"))
)

const withRecovery = stream.pipe(
  Stream.catchTags({
    NetworkError: () => Stream.make({ type: "retry" }),
    ParseError: (e) => Stream.fail(e)
  })
)
```

### Convert to ReadableStream

```typescript
const readable = Stream.toReadableStream(stream)

const readableWithStrategy = Stream.toReadableStream(stream, {
  strategy: { highWaterMark: 10 }
})
```

### SSE Stream Pattern

```typescript
interface SseEvent {
  type: string
  data: unknown
}

const formatSse = (event: SseEvent): string =>
  `event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`

const createSseStream = (events: AsyncIterable<SseEvent>) =>
  Stream.fromAsyncIterable(events, (e) => new Error(String(e))).pipe(
    Stream.mapEffect((event) => Effect.try(() => formatSse(event))),
    Stream.catchAll((error) =>
      Stream.make(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`)
    )
  )

const sseResponse = (events: AsyncIterable<SseEvent>) =>
  new Response(Stream.toReadableStream(createSseStream(events)), {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive"
    }
  })
```

---

## 7. Process Spawning

### Basic Command Execution

```typescript
import * as Command from "@effect/platform/Command"

const output = Command.make("echo", "Hello").pipe(Command.string())

const lines = Command.make("ls", "-la").pipe(Command.lines())

const exitCode = Command.make("test", "-f", "file.txt").pipe(Command.exitCode())
```

### Streaming Output

```typescript
const streamOutput = Command.make("tail", "-f", "/var/log/syslog").pipe(
  Command.stream()
)

const streamLines = Command.make("cat", "file.txt").pipe(
  Command.streamLines("utf-8")
)
```

### Process Management

```typescript
const managed = Effect.gen(function* () {
  const process = yield* Command.make("sleep", "10").pipe(Command.start())
  
  console.log("PID:", process.pid)
  const running = yield* process.isRunning
  
  yield* process.kill()
  
  const code = yield* process.exitCode
  return code
}).pipe(Effect.scoped)
```

### Git Operations

```typescript
const gitClone = (url: string, dest: string, branch?: string) =>
  Effect.gen(function* () {
    const args = ["clone", "--depth", "1"]
    if (branch) args.push("--branch", branch)
    args.push(url, dest)
    
    const code = yield* Command.make("git", ...args).pipe(Command.exitCode())
    
    if (code !== 0) {
      const stderr = yield* Command.make("git", ...args).pipe(
        Command.stderr({ encoding: "utf-8" })
      )
      yield* Effect.fail(new GitCloneError({ url, branch, stderr }))
    }
  })

const gitFetch = (repoPath: string) =>
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

### Command Configuration

```typescript
const configured = Command.make("bash", "-c", "echo $MY_VAR").pipe(
  Command.env({ MY_VAR: "secret" }),
  Command.workingDirectory("/tmp"),
  Command.string()
)

const withInput = Command.make("cat").pipe(
  Command.feed("Hello from stdin"),
  Command.string()
)

const piped = pipe(
  Command.make("echo", "3\n1\n2"),
  Command.pipeTo(Command.make("sort")),
  Command.lines()
)
```

---

## 8. HTTP Server

### Basic Server with Bun

```typescript
import { HttpServer, HttpServerResponse } from "@effect/platform"
import { BunHttpServer, BunRuntime } from "@effect/platform-bun"
import { Layer } from "effect"

const HttpLive = HttpServer.serve(HttpServerResponse.text("Hello World")).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3000 }))
)

BunRuntime.runMain(Layer.launch(HttpLive))
```

### Router with Routes

```typescript
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse, HttpMiddleware } from "@effect/platform"

const router = HttpRouter.empty.pipe(
  HttpRouter.get("/", HttpServerResponse.text("Hello")),
  
  HttpRouter.get("/users/:id", Effect.gen(function* () {
    const params = yield* HttpRouter.RouteContext
    return HttpServerResponse.json({ id: params.path.id })
  })),
  
  HttpRouter.post("/users", Effect.gen(function* () {
    const body = yield* HttpServerRequest.schemaBodyJson(UserSchema)
    return HttpServerResponse.json(body, { status: 201 })
  })),
  
  HttpRouter.get("/health", HttpServerResponse.text("ok").pipe(
    HttpMiddleware.withLoggerDisabled
  )),
  
  HttpServer.serve(HttpMiddleware.logger)
)
```

### Response Types

```typescript
HttpServerResponse.text("Hello")
HttpServerResponse.json({ data: "value" })
HttpServerResponse.html("<h1>Hello</h1>")
HttpServerResponse.empty()
HttpServerResponse.file("./path/to/file.txt")
HttpServerResponse.redirect("https://example.com", { status: 301 })

HttpServerResponse.json({ data: "test" }).pipe(
  HttpServerResponse.setCookie("session", "value", {
    httpOnly: true,
    secure: true
  })
)
```

### Request Handling

```typescript
const handler = Effect.gen(function* () {
  const req = yield* HttpServerRequest.HttpServerRequest
  
  const method = req.method
  const url = req.url
  const headers = req.headers
  
  const params = yield* HttpServerRequest.searchParams
  const json = yield* HttpServerRequest.schemaBodyJson(MySchema)
  const form = yield* HttpServerRequest.schemaBodyForm(FormSchema)
  
  return HttpServerResponse.json({ received: json })
})
```

### Middleware

```typescript
const authMiddleware = (app: HttpApp.Default) =>
  Effect.gen(function* () {
    const req = yield* HttpServerRequest.HttpServerRequest
    const auth = req.headers.get("authorization")
    
    if (!auth) {
      return HttpServerResponse.json({ error: "Unauthorized" }, { status: 401 })
    }
    
    return yield* app
  })

const withMiddleware = router.pipe(
  authMiddleware,
  HttpServer.serve(HttpMiddleware.logger)
)
```

---

## 9. CLI with @effect/cli

### Basic Command

```typescript
import { Args, Command, Options } from "@effect/cli"
import { BunContext, BunRuntime } from "@effect/platform-bun"
import { Effect } from "effect"

const greet = Command.make("greet", {
  name: Args.text({ name: "name" }),
  verbose: Options.boolean("verbose").pipe(Options.withAlias("v"))
}, ({ name, verbose }) =>
  Effect.gen(function* () {
    yield* Effect.log(`Hello, ${name}!`)
    if (verbose) {
      yield* Effect.log("Verbose mode enabled")
    }
  })
)
```

### Subcommands

```typescript
const parent = Command.make("app", {
  config: Options.text("config").pipe(Options.withDefault("default.json"))
})

const child1 = Command.make("init", {}, () =>
  Effect.log("Initializing...")
)

const child2 = Command.make("run", {
  port: Options.integer("port").pipe(Options.withDefault(3000))
}, ({ port }) =>
  Effect.log(`Running on port ${port}`)
)

const app = parent.pipe(
  Command.withSubcommands([child1, child2])
)
```

### Running the CLI

```typescript
const cli = Command.run(app, {
  name: "My CLI",
  version: "1.0.0"
})

Effect.suspend(() => cli(process.argv)).pipe(
  Effect.provide(BunContext.layer),
  BunRuntime.runMain
)
```

### Args Types

```typescript
Args.text({ name: "filename" })
Args.integer({ name: "count" })
Args.file({ name: "file" })
Args.directory({ name: "dir" })
Args.text({ name: "name" }).pipe(Args.optional)
Args.text({ name: "files" }).pipe(Args.repeated)
```

### Options Types

```typescript
Options.boolean("verbose").pipe(Options.withAlias("v"))
Options.text("output").pipe(Options.withAlias("o"))
Options.integer("port").pipe(Options.withDefault(3000))
Options.choice("format", ["json", "yaml", "xml"])
Options.keyValueMap("config")
```

---

## 10. Bun Platform Integration

### BunRuntime & BunContext

```typescript
import { BunRuntime, BunContext } from "@effect/platform-bun"
import { Effect } from "effect"

const program = Effect.gen(function* () {
  yield* Effect.log("Hello from Bun!")
})

program.pipe(
  Effect.provide(BunContext.layer),
  BunRuntime.runMain
)
```

### File System Operations

```typescript
import { FileSystem } from "@effect/platform"
import { BunContext } from "@effect/platform-bun"

const fileOps = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  
  const content = yield* fs.readFileString("./package.json")
  yield* fs.writeFileString("./output.txt", "Hello")
  const exists = yield* fs.exists("./output.txt")
  yield* fs.remove("./output.txt")
  const files = yield* fs.readDirectory("./")
  const stats = yield* fs.stat("./package.json")
  yield* fs.makeDirectory("./new-dir")
})

fileOps.pipe(Effect.provide(BunContext.layer), BunRuntime.runMain)
```

### HTTP Client

```typescript
import { FetchHttpClient, HttpClient, HttpClientRequest } from "@effect/platform"

const fetchTodo = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const response = yield* client.get("https://jsonplaceholder.typicode.com/todos/1")
  return yield* response.json
})

fetchTodo.pipe(
  Effect.provide(FetchHttpClient.layer),
  BunRuntime.runMain
)
```

---

## 11. Effect.gen vs pipe

### When to Use Effect.gen

```typescript
Effect.gen(function* () {
  const user = yield* getUser()
  const profile = yield* getProfile(user.id)
  
  for (const item of profile.items) {
    if (item.active) {
      yield* processItem(item)
    }
  }
  
  return { user, profile }
})
```

### When to Use pipe

```typescript
pipe(
  Effect.succeed(5),
  Effect.map((n) => n * 2),
  Effect.flatMap((n) => validateNumber(n)),
  Effect.tap((n) => Effect.log(`Result: ${n}`))
)
```

### Hybrid Approach (Recommended)

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

### Key Combinators

```typescript
Effect.map((a) => transform(a))

Effect.flatMap((a) => effectReturningFunction(a))

Effect.tap((a) => sideEffect(a))

Effect.tapBoth({
  onSuccess: (a) => logSuccess(a),
  onFailure: (e) => logError(e)
})

Effect.tapError((e) => logError(e))
```

---

## 12. Layer Composition

### Layer.provide - Inject Dependencies

```typescript
const UserServiceLive = UserService.Live.pipe(
  Layer.provide(DatabaseService.Live)
)
```

### Layer.merge - Combine Independent Layers

```typescript
const AppLive = Layer.merge(
  ConfigService.Live,
  LoggerService.Live
)

const AppLive2 = Layer.mergeAll(
  ConfigService.Live,
  LoggerService.Live,
  MetricsService.Live
)
```

### Effect.provide - Run Effect with Layer

```typescript
const result = await Effect.runPromise(
  myEffect.pipe(Effect.provide(AppLive))
)
```

### Layer.launch - Run Layer as Application

```typescript
const ServerLive = HttpServer.serve(handler).pipe(
  Layer.provide(BunHttpServer.layer({ port: 3000 }))
)

BunRuntime.runMain(Layer.launch(ServerLive))
```

### Full Application Stack

```typescript
const ConfigLive = ConfigService.Live

const DatabaseLive = DatabaseService.Live.pipe(
  Layer.provide(ConfigLive)
)

const UserServiceLive = UserService.Live.pipe(
  Layer.provide(DatabaseLive)
)

const AppLive = Layer.mergeAll(
  ConfigLive,
  DatabaseLive,
  UserServiceLive
)

const ServerLive = createServer().pipe(
  Layer.provide(AppLive),
  Layer.provide(BunHttpServer.layer({ port: 8080 }))
)

BunRuntime.runMain(Layer.launch(ServerLive))
```

---

## 13. Edge Cases & Gotchas

### Scoped Resources Must Be Consumed

```typescript
const resource = Effect.acquireRelease(acquire, release)

const bad = resource
const good = Effect.scoped(resource)
```

### Cleanup Order

Resources are cleaned up in **reverse** order of acquisition.

### AbortSignal in tryPromise

```typescript
Effect.tryPromise({
  try: (signal: AbortSignal) => fetch(url, { signal }),
  catch: (e) => new Error(String(e))
})
```

### Exit Parameter in Release

```typescript
Effect.acquireRelease(
  acquire,
  (resource, exit) => {
    if (Exit.isSuccess(exit)) {
      return normalCleanup(resource)
    }
    return errorCleanup(resource)
  }
)
```

### Defects vs Failures

- **Failure**: Expected, recoverable (`Effect.fail`)
- **Defect**: Unexpected, unrecoverable (`Effect.die`)

```typescript
const failure = Effect.fail(new ExpectedError())
const defect = Effect.die(new Error("Should never happen"))
```

### Stream Errors Don't Propagate Automatically

```typescript
const stream = myStream.pipe(
  Stream.catchAll((error) =>
    Stream.make({ type: "error", data: error.message })
  )
)
```

### Layer.launch Never Returns

```typescript
BunRuntime.runMain(Layer.launch(ServerLive))
```

### Effect.provide vs Layer.provide

```typescript
effect.pipe(Effect.provide(layer))

layer.pipe(Layer.provide(dependencyLayer))
```
