# Effect Rewrite Task

You are continuing the Effect rewrite of the btca CLI and Server.

## Context Files

Read these files to understand the current state:

- `STATUS.md` - Current progress and task list
- `effect-rewrite-scratch/rewrite-plan.md` - Overall architecture plan with code examples
- `effect-rewrite-scratch/api-surface.md` - Public APIs that must remain stable
- `effect-rewrite-scratch/first-pass-state.md` - Initial implementation notes

## Your Task

1. **Read STATUS.md** to see what's been done and what remains
2. **Pick ONE task** from the remaining tasks list - choose what you think is most important or foundational
3. **Implement that task** following the patterns in rewrite-plan.md
4. **Run type checks** after changes: `bun run check:server` or `bun run check:cli`
5. **Update STATUS.md** - check off completed items, add notes if needed

## Rules

- Only use `bun` (never npm/yarn)
- Never run dev/build commands
- Keep all public APIs stable (no changes to CLI flags, HTTP routes, JSON shapes)
- Use functional programming patterns
- No comments unless asked
- Prefer editing existing files over creating new ones
- **Use @effect/platform HttpServer instead of Hono**

## When Done

After completing your chosen task and updating STATUS.md, stop. The loop will continue with the next iteration.

If you encounter a blocking issue you cannot resolve, update STATUS.md with:

```
Status: blocked
Reason: [explain the issue]
```

If all tasks in STATUS.md are complete, update it with:

```
Status: completed
```

---

## Quick Reference: Effect Patterns

(MAKE SURE YOU REFERENCE THE FULL effect-patterns-reference.md file)

### Service Definition (Modern Pattern)

```typescript
import { Context, Effect, Layer } from 'effect';

class MyService extends Context.Tag('@btca/MyService')<
	MyService,
	{
		readonly doSomething: (input: string) => Effect.Effect<Result, MyError>;
	}
>() {
	static Live = Layer.effect(
		MyService,
		Effect.gen(function* () {
			const dep = yield* SomeDependency;
			return MyService.of({
				doSomething: (input) =>
					Effect.gen(function* () {
						const result = yield* dep.process(input);
						return result;
					})
			});
		})
	).pipe(Layer.provide(SomeDependency.Live));
}
```

### Typed Errors

```typescript
import { Data } from 'effect';

class ConfigError extends Data.TaggedError('ConfigError')<{
	readonly message: string;
	readonly cause?: unknown;
}> {}

class ResourceError extends Data.TaggedError('ResourceError')<{
	readonly name: string;
	readonly message: string;
	readonly hint?: string;
}> {}
```

### Wrapping Async Code

```typescript
const loadFile = (path: string) =>
	Effect.tryPromise({
		try: () => Bun.file(path).text(),
		catch: (error) => new ConfigError({ message: `Failed to read ${path}`, cause: error })
	});
```

### Resource Management

```typescript
const withServer = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	Effect.scoped(
		Effect.gen(function* () {
			const server = yield* Effect.acquireRelease(
				Effect.sync(() => startServer()),
				(srv) => Effect.sync(() => srv.stop())
			);
			return yield* effect;
		})
	);
```

### Retry with Schedule

```typescript
const withRetry = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
	effect.pipe(
		Effect.retry(
			Schedule.exponential('100 millis', 2).pipe(
				Schedule.jittered(),
				Schedule.intersect(Schedule.recurs(5))
			)
		)
	);
```

### SSE with Stream

```typescript
const createSseStream = (events: AsyncIterable<Event>) =>
	Stream.fromAsyncIterable(events, (e) => new Error(String(e))).pipe(
		Stream.mapEffect((event) => Effect.try(() => formatSse(event))),
		Stream.catchAll((error) => Stream.make(formatError(error)))
	);
```

### Process Spawning

```typescript
import * as Command from '@effect/platform/Command';

const runGit = (args: string[]) =>
	Command.make('git', ...args).pipe(
		Command.exitCode(),
		Effect.flatMap((code) => (code === 0 ? Effect.void : Effect.fail(new GitError({ args, code }))))
	);
```

### Effect HttpServer (NOT Hono)

```typescript
import { HttpRouter, HttpServer, HttpServerRequest, HttpServerResponse, HttpMiddleware } from '@effect/platform';
import { BunHttpServer, BunRuntime } from '@effect/platform-bun';
import { Effect, Layer } from 'effect';

const router = HttpRouter.empty.pipe(
	HttpRouter.get('/', HttpServerResponse.json({ ok: true, service: 'btca-server' })),
	HttpRouter.get('/resources', Effect.gen(function* () {
		const config = yield* ConfigService;
		return HttpServerResponse.json(config.resources);
	})),
	HttpRouter.post('/question', Effect.gen(function* () {
		const body = yield* HttpServerRequest.schemaBodyJson(QuestionSchema);
		const agent = yield* AgentService;
		const answer = yield* agent.ask(body);
		return HttpServerResponse.json(answer);
	})),
	HttpRouter.post('/question/stream', Effect.gen(function* () {
		const body = yield* HttpServerRequest.schemaBodyJson(QuestionSchema);
		const agent = yield* AgentService;
		const sseStream = yield* agent.askStream(body);
		return HttpServerResponse.stream(Stream.toReadableStream(sseStream), {
			contentType: 'text/event-stream',
			headers: { 'Cache-Control': 'no-cache' }
		});
	})),
	HttpServer.serve(HttpMiddleware.logger)
);

const HttpLive = router.pipe(
	Layer.provide(AppServicesLive),
	Layer.provide(BunHttpServer.layer({ port: 8080 }))
);

BunRuntime.runMain(Layer.launch(HttpLive));
```

### CLI Command

```typescript
command.action(async (opts) => {
	await Effect.gen(function* () {
		const server = yield* ServerManager;
		yield* processCommand(opts);
	}).pipe(Effect.scoped, Effect.provide(ServerManager.Live), BunRuntime.runMain);
});
```

### Layer Composition

```typescript
const AppLive = Layer.mergeAll(
	ConfigService.Live,
	ResourcesService.Live.pipe(Layer.provide(ConfigService.Live)),
	AgentService.Live.pipe(Layer.provide(ConfigService.Live), Layer.provide(ResourcesService.Live))
);
```
