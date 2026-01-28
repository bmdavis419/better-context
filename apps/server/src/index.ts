import { Hono } from 'hono';
import type { Context as HonoContext, Next } from 'hono';
import { z } from 'zod';
import { Effect } from 'effect';

import { Agent } from './agent/service.ts';
import { Collections } from './collections/service.ts';
import { getCollectionKey } from './collections/types.ts';
import { Config } from './config/index.ts';
import { Context } from './context/index.ts';
import { getErrorMessage, getErrorTag, getErrorHint } from './errors.ts';
import { Metrics } from './metrics/index.ts';
import { Resources } from './resources/service.ts';
import { GitResourceSchema, LocalResourceSchema } from './resources/schema.ts';
import { StreamService } from './stream/service.ts';
import type { BtcaStreamMetaEvent } from './stream/types.ts';
import { LIMITS, normalizeGitHubUrl } from './validation/index.ts';
import {
	getAgentService,
	getCollectionsService,
	getConfigService,
	runWithServerServices
} from './effect/services.ts';

/**
 * BTCA Server API
 *
 * Endpoints:
 *
 * GET  /                  - Health check, returns { ok, service, version }
 * GET  /config            - Returns current configuration (provider, model, directories)
 * GET  /resources         - Lists all configured resources
 * POST /question          - Ask a question (non-streaming)
 * POST /question/stream   - Ask a question (streaming SSE response)
 * POST /opencode          - Get OpenCode instance URL for a collection
 */

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_PORT = 8080;
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : DEFAULT_PORT;

// ─────────────────────────────────────────────────────────────────────────────
// Request Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resource name pattern: must start with a letter, alphanumeric and hyphens only.
 */
const RESOURCE_NAME_REGEX = /^@?[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/;

/**
 * Safe name pattern for provider/model names.
 */
const SAFE_NAME_REGEX = /^[a-zA-Z0-9._+\-/:]+$/;

/**
 * Validated resource name field for request schemas.
 */
const ResourceNameField = z
	.string()
	.min(1, 'Resource name cannot be empty')
	.max(LIMITS.RESOURCE_NAME_MAX)
	.regex(RESOURCE_NAME_REGEX, 'Invalid resource name format')
	.refine((name) => !name.includes('..'), 'Resource name must not contain ".."')
	.refine((name) => !name.includes('//'), 'Resource name must not contain "//"')
	.refine((name) => !name.endsWith('/'), 'Resource name must not end with "/"');

const QuestionRequestSchema = z.object({
	question: z
		.string()
		.min(1, 'Question cannot be empty')
		.max(
			LIMITS.QUESTION_MAX,
			`Question too long (max ${LIMITS.QUESTION_MAX.toLocaleString()} chars). This includes conversation history - try starting a new thread or clearing the chat.`
		),
	resources: z
		.array(ResourceNameField)
		.max(
			LIMITS.MAX_RESOURCES_PER_REQUEST,
			`Too many resources (max ${LIMITS.MAX_RESOURCES_PER_REQUEST})`
		)
		.optional(),
	quiet: z.boolean().optional()
});

const OpencodeRequestSchema = z.object({
	resources: z
		.array(ResourceNameField)
		.max(
			LIMITS.MAX_RESOURCES_PER_REQUEST,
			`Too many resources (max ${LIMITS.MAX_RESOURCES_PER_REQUEST})`
		)
		.optional(),
	quiet: z.boolean().optional()
});

const UpdateModelRequestSchema = z.object({
	provider: z
		.string()
		.min(1, 'Provider name cannot be empty')
		.max(LIMITS.PROVIDER_NAME_MAX)
		.regex(SAFE_NAME_REGEX, 'Invalid provider name format'),
	model: z
		.string()
		.min(1, 'Model name cannot be empty')
		.max(LIMITS.MODEL_NAME_MAX)
		.regex(SAFE_NAME_REGEX, 'Invalid model name format')
});

/**
 * Add resource request - uses the full resource schemas for validation.
 * This ensures all security checks (URL, branch, path traversal) are applied.
 */
const AddGitResourceRequestSchema = z.object({
	type: z.literal('git'),
	name: GitResourceSchema.shape.name,
	url: GitResourceSchema.shape.url,
	branch: GitResourceSchema.shape.branch.optional().default('main'),
	searchPath: GitResourceSchema.shape.searchPath,
	searchPaths: GitResourceSchema.shape.searchPaths,
	specialNotes: GitResourceSchema.shape.specialNotes
});

const AddLocalResourceRequestSchema = z.object({
	type: z.literal('local'),
	name: LocalResourceSchema.shape.name,
	path: LocalResourceSchema.shape.path,
	specialNotes: LocalResourceSchema.shape.specialNotes
});

const AddResourceRequestSchema = z.discriminatedUnion('type', [
	AddGitResourceRequestSchema,
	AddLocalResourceRequestSchema
]);

const RemoveResourceRequestSchema = z.object({
	name: ResourceNameField
});

// ─────────────────────────────────────────────────────────────────────────────
// Errors & Helpers
// ─────────────────────────────────────────────────────────────────────────────

class RequestError extends Error {
	readonly _tag = 'RequestError';

	constructor(message: string, cause?: unknown) {
		super(message, cause ? { cause } : undefined);
	}
}

const decodeJson = async <T>(req: Request, schema: z.ZodType<T>): Promise<T> => {
	let body: unknown;
	try {
		body = await req.json();
	} catch (cause) {
		throw new RequestError('Failed to parse request JSON', cause);
	}

	const parsed = schema.safeParse(body);
	if (!parsed.success) throw new RequestError('Invalid request body', parsed.error);
	return parsed.data;
};

// ─────────────────────────────────────────────────────────────────────────────
// App Factory
// ─────────────────────────────────────────────────────────────────────────────

const createApp = (deps: {
	config: Config.Service;
	resources: Resources.Service;
	collections: Collections.Service;
	agent: Agent.Service;
}) => {
	const run = <A>(effect: Effect.Effect<A, unknown, unknown>) =>
		runWithServerServices(deps, effect);

	const app = new Hono()
		// ─────────────────────────────────────────────────────────────────────
		// Middleware
		// ─────────────────────────────────────────────────────────────────────
		.use('*', async (c: HonoContext, next: Next) => {
			const requestId = crypto.randomUUID();
			return Context.run({ requestId, txDepth: 0 }, async () => {
				Metrics.info('http.request', { method: c.req.method, path: c.req.path });
				try {
					await next();
				} finally {
					Metrics.info('http.response', {
						path: c.req.path,
						status: c.res.status
					});
				}
			});
		})
		.onError((err: Error, c: HonoContext) => {
			Metrics.error('http.error', { error: Metrics.errorInfo(err) });
			const tag = getErrorTag(err);
			const message = getErrorMessage(err);
			const hint = getErrorHint(err);
			const status =
				tag === 'RequestError' ||
				tag === 'CollectionError' ||
				tag === 'ResourceError' ||
				tag === 'ConfigError' ||
				tag === 'InvalidProviderError' ||
				tag === 'InvalidModelError' ||
				tag === 'ProviderNotConnectedError'
					? 400
					: 500;
			return c.json({ error: message, tag, ...(hint && { hint }) }, status);
		})

		// ─────────────────────────────────────────────────────────────────────
		// Routes
		// ─────────────────────────────────────────────────────────────────────

		// GET / - Health check
		.get('/', (c: HonoContext) => {
			return c.json({
				ok: true,
				service: 'btca-server',
				version: '0.0.1'
			});
		})

		// GET /config
		.get('/config', async (c: HonoContext) => {
			const body = await run(
				Effect.gen(function* () {
					const config = yield* getConfigService;
					return {
						provider: config.provider,
						model: config.model,
						providerTimeoutMs: config.providerTimeoutMs ?? null,
						resourcesDirectory: config.resourcesDirectory,
						collectionsDirectory: config.collectionsDirectory,
						resourceCount: config.resources.length
					};
				})
			);

			return c.json(body);
		})

		// GET /resources
		.get('/resources', async (c: HonoContext) => {
			const body = await run(
				Effect.gen(function* () {
					const config = yield* getConfigService;
					return {
						resources: config.resources.map((r) => {
							if (r.type === 'git') {
								return {
									name: r.name,
									type: r.type,
									url: r.url,
									branch: r.branch,
									searchPath: r.searchPath ?? null,
									searchPaths: r.searchPaths ?? null,
									specialNotes: r.specialNotes ?? null
								};
							}
							return {
								name: r.name,
								type: r.type,
								path: r.path,
								specialNotes: r.specialNotes ?? null
							};
						})
					};
				})
			);

			return c.json(body);
		})

		// GET /providers
		.get('/providers', async (c: HonoContext) => {
			const body = await run(
				Effect.gen(function* () {
					const agent = yield* getAgentService;
					return yield* Effect.tryPromise(() => agent.listProviders());
				})
			);
			return c.json(body);
		})

		// POST /reload-config - Reload config from disk
		.post('/reload-config', async (c: HonoContext) => {
			await config.reload();
			return c.json({
				ok: true,
				resources: config.resources.map((r) => r.name)
			});
		})

		// POST /question
		.post('/question', async (c: HonoContext) => {
			const body = await run(
				Effect.gen(function* () {
					const config = yield* getConfigService;
					const collections = yield* getCollectionsService;
					const agent = yield* getAgentService;

					const decoded = yield* Effect.tryPromise(() =>
						decodeJson(c.req.raw, QuestionRequestSchema)
					);
					const resourceNames =
						decoded.resources && decoded.resources.length > 0
							? decoded.resources
							: config.resources.map((r) => r.name);

					const collectionKey = getCollectionKey(resourceNames);
					yield* Effect.sync(() =>
						Metrics.info('question.received', {
							stream: false,
							quiet: decoded.quiet ?? false,
							questionLength: decoded.question.length,
							resources: resourceNames,
							collectionKey
						})
					);

					const collection = yield* Effect.tryPromise(() =>
						collections.load({ resourceNames, quiet: decoded.quiet })
					);
					yield* Effect.sync(() =>
						Metrics.info('collection.ready', { collectionKey, path: collection.path })
					);

					const result = yield* Effect.tryPromise(() =>
						agent.ask({ collection, question: decoded.question })
					);
					yield* Effect.sync(() =>
						Metrics.info('question.done', {
							collectionKey,
							answerLength: result.answer.length,
							model: result.model
						})
					);

					return {
						answer: result.answer,
						model: result.model,
						resources: resourceNames,
						collection: { key: collectionKey, path: collection.path }
					};
				})
			);

			return c.json(body);
		})

		// POST /question/stream
		.post('/question/stream', async (c: HonoContext) => {
			const body = await run(
				Effect.gen(function* () {
					const config = yield* getConfigService;
					const collections = yield* getCollectionsService;
					const agent = yield* getAgentService;

					const decoded = yield* Effect.tryPromise(() =>
						decodeJson(c.req.raw, QuestionRequestSchema)
					);
					const resourceNames =
						decoded.resources && decoded.resources.length > 0
							? decoded.resources
							: config.resources.map((r) => r.name);

					const collectionKey = getCollectionKey(resourceNames);
					yield* Effect.sync(() =>
						Metrics.info('question.received', {
							stream: true,
							quiet: decoded.quiet ?? false,
							questionLength: decoded.question.length,
							resources: resourceNames,
							collectionKey
						})
					);

					const collection = yield* Effect.tryPromise(() =>
						collections.load({ resourceNames, quiet: decoded.quiet })
					);
					yield* Effect.sync(() =>
						Metrics.info('collection.ready', { collectionKey, path: collection.path })
					);

					const { stream: eventStream, model } = yield* Effect.tryPromise(() =>
						agent.askStream({
							collection,
							question: decoded.question
						})
					);

					const meta = {
						type: 'meta',
						model,
						resources: resourceNames,
						collection: {
							key: collectionKey,
							path: collection.path
						}
					} satisfies BtcaStreamMetaEvent;

					yield* Effect.sync(() =>
						Metrics.info('question.stream.start', { collectionKey })
					);

					const stream = StreamService.createSseStream({
						meta,
						eventStream,
						question: decoded.question
					});

					return { stream };
				})
			);

			return new Response(body.stream, {
				headers: {
					'content-type': 'text/event-stream',
					'cache-control': 'no-cache',
					connection: 'keep-alive'
				}
			});
		})

		// POST /opencode - Get OpenCode instance URL for a collection
		.post('/opencode', async (c: HonoContext) => {
			const body = await run(
				Effect.gen(function* () {
					const config = yield* getConfigService;
					const collections = yield* getCollectionsService;
					const agent = yield* getAgentService;

					const decoded = yield* Effect.tryPromise(() =>
						decodeJson(c.req.raw, OpencodeRequestSchema)
					);
					const resourceNames =
						decoded.resources && decoded.resources.length > 0
							? decoded.resources
							: config.resources.map((r) => r.name);

					const collectionKey = getCollectionKey(resourceNames);
					yield* Effect.sync(() =>
						Metrics.info('opencode.requested', {
							quiet: decoded.quiet ?? false,
							resources: resourceNames,
							collectionKey
						})
					);

					const collection = yield* Effect.tryPromise(() =>
						collections.load({ resourceNames, quiet: decoded.quiet })
					);
					yield* Effect.sync(() =>
						Metrics.info('collection.ready', { collectionKey, path: collection.path })
					);

					const { url, model, instanceId } = yield* Effect.tryPromise(() =>
						agent.getOpencodeInstance({ collection })
					);
					yield* Effect.sync(() =>
						Metrics.info('opencode.ready', { collectionKey, url, instanceId })
					);

					return {
						url,
						model,
						instanceId,
						resources: resourceNames,
						collection: { key: collectionKey, path: collection.path }
					};
				})
			);

			return c.json(body);
		})

		// GET /opencode/instances - List all active OpenCode instances
		.get('/opencode/instances', async (c: HonoContext) => {
			const body = await run(
				Effect.gen(function* () {
					const agent = yield* getAgentService;
					const instances = agent.listInstances();
					return { instances, count: instances.length };
				})
			);
			return c.json(body);
		})

		// DELETE /opencode/instances - Close all OpenCode instances
		.delete('/opencode/instances', async (c: HonoContext) => {
			const body = await run(
				Effect.gen(function* () {
					const agent = yield* getAgentService;
					return yield* Effect.tryPromise(() => agent.closeAllInstances());
				})
			);
			return c.json(body);
		})

		// DELETE /opencode/:id - Close a specific OpenCode instance
		.delete('/opencode/:id', async (c: HonoContext) => {
			const instanceId = c.req.param('id');
			const result = await run(
				Effect.gen(function* () {
					const agent = yield* getAgentService;
					return yield* Effect.tryPromise(() => agent.closeInstance(instanceId));
				})
			);
			if (!result.closed) {
				return c.json({ error: 'Instance not found', instanceId }, 404);
			}
			return c.json({ closed: true, instanceId });
		})

		// PUT /config/model - Update model configuration
		.put('/config/model', async (c: HonoContext) => {
			const body = await run(
				Effect.gen(function* () {
					const config = yield* getConfigService;
					const decoded = yield* Effect.tryPromise(() =>
						decodeJson(c.req.raw, UpdateModelRequestSchema)
					);
					return yield* Effect.tryPromise(() =>
						config.updateModel(decoded.provider, decoded.model)
					);
				})
			);
			return c.json(body);
		})

		// POST /config/resources - Add a new resource
		// All validation (URL, branch, path traversal, etc.) is handled by the schema
		// GitHub URLs are normalized to their base repository format
		.post('/config/resources', async (c: HonoContext) => {
			const body = await run(
				Effect.gen(function* () {
					const config = yield* getConfigService;
					const decoded = yield* Effect.tryPromise(() =>
						decodeJson(c.req.raw, AddResourceRequestSchema)
					);

					if (decoded.type === 'git') {
						// Normalize GitHub URLs (e.g., /blob/main/file.txt → base repo URL)
						const normalizedUrl = normalizeGitHubUrl(decoded.url);
						const resource = {
							type: 'git' as const,
							name: decoded.name,
							url: normalizedUrl,
							branch: decoded.branch ?? 'main',
							...(decoded.searchPath && { searchPath: decoded.searchPath }),
							...(decoded.searchPaths && { searchPaths: decoded.searchPaths }),
							...(decoded.specialNotes && { specialNotes: decoded.specialNotes })
						};
						const added = yield* Effect.tryPromise(() => config.addResource(resource));
						return { added, status: 201 as const };
					}

					const resource = {
						type: 'local' as const,
						name: decoded.name,
						path: decoded.path,
						...(decoded.specialNotes && { specialNotes: decoded.specialNotes })
					};
					const added = yield* Effect.tryPromise(() => config.addResource(resource));
					return { added, status: 201 as const };
				})
			);

			return c.json(body.added, body.status);
		})

		// DELETE /config/resources - Remove a resource
		.delete('/config/resources', async (c: HonoContext) => {
			const body = await run(
				Effect.gen(function* () {
					const config = yield* getConfigService;
					const decoded = yield* Effect.tryPromise(() =>
						decodeJson(c.req.raw, RemoveResourceRequestSchema)
					);
					yield* Effect.tryPromise(() => config.removeResource(decoded.name));
					return { success: true, name: decoded.name };
				})
			);
			return c.json(body);
		})

		// POST /clear - Clear all locally cloned resources
		.post('/clear', async (c: HonoContext) => {
			const body = await run(
				Effect.gen(function* () {
					const config = yield* getConfigService;
					return yield* Effect.tryPromise(() => config.clearResources());
				})
			);
			return c.json(body);
		});

	return app;
};

// Export app type for Hono RPC client
// We create a dummy app with null deps just to get the type
type AppType = ReturnType<typeof createApp>;
export type { AppType };

// ─────────────────────────────────────────────────────────────────────────────
// Server
// ─────────────────────────────────────────────────────────────────────────────

export interface ServerInstance {
	port: number;
	url: string;
	stop: () => void;
}

export interface StartServerOptions {
	port?: number;
	quiet?: boolean;
}

/**
 * Start the btca server programmatically.
 * Returns a ServerInstance with the port, url, and stop function.
 *
 * If port is 0, a random available port will be assigned by the OS.
 */
export const startServer = async (options: StartServerOptions = {}): Promise<ServerInstance> => {
	if (options.quiet) {
		Metrics.setQuiet(true);
	}

	const requestedPort = options.port ?? PORT;
	Metrics.info('server.starting', { port: requestedPort });

	const config = await Config.load();
	Metrics.info('config.ready', {
		provider: config.provider,
		model: config.model,
		resources: config.resources.map((r) => r.name),
		resourcesDirectory: config.resourcesDirectory,
		collectionsDirectory: config.collectionsDirectory
	});

	const resources = Resources.create(config);
	const collections = Collections.create({ config, resources });
	const agent = Agent.create(config);

	const app = createApp({ config, resources, collections, agent });

	const server = Bun.serve({
		port: requestedPort,
		fetch: app.fetch,
		idleTimeout: 60
	});

	const actualPort = server.port ?? requestedPort;
	Metrics.info('server.started', { port: actualPort });

	return {
		port: actualPort,
		url: `http://localhost:${actualPort}`,
		stop: () => server.stop()
	};
};

// Export all public types and interfaces for consumers
export type { BtcaStreamEvent, BtcaStreamMetaEvent } from './stream/types.ts';

// Auto-start when run directly (not imported)
const isMainModule = import.meta.main;
if (isMainModule) {
	await startServer({ port: PORT });
}
