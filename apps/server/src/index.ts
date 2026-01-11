import { Hono } from 'hono';
import type { Context as HonoContext, Next } from 'hono';
import { z } from 'zod';

import { Agent } from './agent/service.ts';
import { Collections } from './collections/service.ts';
import { getCollectionKey } from './collections/types.ts';
import { Config } from './config/index.ts';
import { Context } from './context/index.ts';
import { getErrorMessage, getErrorTag } from './errors.ts';
import { Metrics } from './metrics/index.ts';
import { Resources } from './resources/service.ts';
import { StreamService } from './stream/service.ts';
import type { BtcaStreamMetaEvent } from './stream/types.ts';

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
 */

// ─────────────────────────────────────────────────────────────────────────────
// Request Schemas
// ─────────────────────────────────────────────────────────────────────────────

const QuestionRequestSchema = z.object({
	question: z.string(),
	resources: z.array(z.string()).optional(),
	quiet: z.boolean().optional()
});

type QuestionRequest = z.infer<typeof QuestionRequestSchema>;

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
// Server
// ─────────────────────────────────────────────────────────────────────────────

const start = async () => {
	Metrics.info('server.starting', { port: 8080 });

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

	// ─────────────────────────────────────────────────────────────────────────
	// Create Hono App
	// ─────────────────────────────────────────────────────────────────────────

	const app = new Hono();

	// Request context middleware
	app.use('*', async (c: HonoContext, next: Next) => {
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
	});

	// Error handler
	app.onError((err: Error, c: HonoContext) => {
		Metrics.error('http.error', { error: Metrics.errorInfo(err) });
		const tag = getErrorTag(err);
		const message = getErrorMessage(err);
		const status = tag === 'CollectionError' || tag === 'ResourceError' ? 400 : 500;
		return c.json({ error: message, tag }, status);
	});

	// ─────────────────────────────────────────────────────────────────────────
	// Routes
	// ─────────────────────────────────────────────────────────────────────────

	// GET / - Health check
	app.get('/', (c: HonoContext) => {
		return c.json({
			ok: true,
			service: 'btca-server',
			version: '0.0.1'
		});
	});

	// GET /config
	app.get('/config', (c: HonoContext) => {
		return c.json({
			provider: config.provider,
			model: config.model,
			resourcesDirectory: config.resourcesDirectory,
			collectionsDirectory: config.collectionsDirectory,
			resourceCount: config.resources.length
		});
	});

	// GET /resources
	app.get('/resources', (c: HonoContext) => {
		return c.json({
			resources: config.resources.map((r) => ({
				name: r.name,
				type: r.type,
				url: r.url,
				branch: r.branch,
				searchPath: r.searchPath ?? null,
				specialNotes: r.specialNotes ?? null
			}))
		});
	});

	// POST /question
	app.post('/question', async (c: HonoContext) => {
		const decoded = await decodeJson(c.req.raw, QuestionRequestSchema);
		const resourceNames =
			decoded.resources && decoded.resources.length > 0
				? decoded.resources
				: config.resources.map((r) => r.name);

		const collectionKey = getCollectionKey(resourceNames);
		Metrics.info('question.received', {
			stream: false,
			quiet: decoded.quiet ?? false,
			questionLength: decoded.question.length,
			resources: resourceNames,
			collectionKey
		});

		const collection = await collections.load({ resourceNames, quiet: decoded.quiet });
		Metrics.info('collection.ready', { collectionKey, path: collection.path });

		const result = await agent.ask({ collection, question: decoded.question });
		Metrics.info('question.done', {
			collectionKey,
			answerLength: result.answer.length,
			model: result.model
		});

		return c.json({
			answer: result.answer,
			model: result.model,
			resources: resourceNames,
			collection: { key: collectionKey, path: collection.path }
		});
	});

	// POST /question/stream
	app.post('/question/stream', async (c: HonoContext) => {
		const decoded = await decodeJson(c.req.raw, QuestionRequestSchema);
		const resourceNames =
			decoded.resources && decoded.resources.length > 0
				? decoded.resources
				: config.resources.map((r) => r.name);

		const collectionKey = getCollectionKey(resourceNames);
		Metrics.info('question.received', {
			stream: true,
			quiet: decoded.quiet ?? false,
			questionLength: decoded.question.length,
			resources: resourceNames,
			collectionKey
		});

		const collection = await collections.load({ resourceNames, quiet: decoded.quiet });
		Metrics.info('collection.ready', { collectionKey, path: collection.path });

		const { stream: eventStream, model } = await agent.askStream({
			collection,
			question: decoded.question
		});

		const meta = {
			type: 'meta',
			model,
			resources: resourceNames,
			collection: {
				key: collectionKey,
				path: collection.path
			}
		} satisfies BtcaStreamMetaEvent;

		Metrics.info('question.stream.start', { collectionKey });
		const stream = StreamService.createSseStream({ meta, eventStream });

		return new Response(stream, {
			headers: {
				'content-type': 'text/event-stream',
				'cache-control': 'no-cache',
				connection: 'keep-alive'
			}
		});
	});

	// ─────────────────────────────────────────────────────────────────────────
	// Start Server
	// ─────────────────────────────────────────────────────────────────────────

	Bun.serve({
		port: 8080,
		fetch: app.fetch
	});

	Metrics.info('server.started', { port: 8080 });
};

await start();
