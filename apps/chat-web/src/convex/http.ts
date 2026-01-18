import { formatConversationHistory, type BtcaChunk, type ThreadMessage } from '@btca/shared';
import { httpRouter } from 'convex/server';
import { z } from 'zod';

import { api } from './_generated/api.js';
import type { Id } from './_generated/dataModel';
import { httpAction, type ActionCtx } from './_generated/server.js';
import { instances } from './apiHelpers';

const usageActions = api.usage;
const instanceActions = instances.actions;
const instanceMutations = instances.mutations;
const instanceQueries = instances.queries;

const http = httpRouter();

const corsAllowedMethods = 'GET, POST, OPTIONS';
const corsMaxAgeSeconds = 60 * 60 * 24;
const defaultAllowedHeaders = 'Content-Type, Authorization, X-Requested-With';

const buildAllowedOrigins = (): Set<string> => {
	const origins = (process.env.CLIENT_ORIGIN ?? '')
		.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean);

	if (origins.length === 0) {
		return new Set(['http://localhost:5173', 'http://localhost:5174', 'http://localhost:5175']);
	}

	return new Set(origins);
};

const allowedOrigins = buildAllowedOrigins();

type SvixHeaders = {
	'svix-id': string;
	'svix-timestamp': string;
	'svix-signature': string;
};

const chatStreamRequestSchema = z.object({
	threadId: z.string().min(1),
	message: z.string().min(1),
	resources: z.array(z.string()).optional()
});

const clerkWebhookSchema = z.object({
	type: z.string(),
	data: z.object({
		id: z.string().min(1)
	})
});

type MessageLike = {
	role: 'user' | 'assistant' | 'system';
	content: string | { type: 'chunks'; chunks: BtcaChunk[] } | { type: 'text'; content: string };
	canceled?: boolean;
};

type ChunkUpdate =
	| { type: 'add'; chunk: BtcaChunk }
	| { type: 'update'; id: string; chunk: Partial<BtcaChunk> };

type BtcaToolState = {
	status?: 'pending' | 'running' | 'completed' | 'error';
};

type BtcaStreamMetaEvent = {
	type: 'meta';
	model?: unknown;
	resources?: string[];
	collection?: { key: string; path: string };
};

type BtcaStreamDoneEvent = {
	type: 'done';
	text: string;
	reasoning: string;
	tools: Array<{ callID: string; tool: string; state?: BtcaToolState }>;
};

type BtcaStreamErrorEvent = {
	type: 'error';
	message?: string;
	tag?: string;
};

type BtcaStreamEvent =
	| BtcaStreamMetaEvent
	| { type: 'text.delta'; delta: string }
	| { type: 'reasoning.delta'; delta: string }
	| {
			type: 'tool.updated';
			callID: string;
			tool: string;
			state?: BtcaToolState;
	  }
	| BtcaStreamDoneEvent
	| BtcaStreamErrorEvent;

type InstanceRecord = {
	_id: Id<'instances'>;
	state: string;
	serverUrl?: string | null;
	sandboxId?: string | null;
};

type StreamEventPayload =
	| { type: 'status'; status: 'starting' | 'ready' }
	| { type: 'error'; error: string }
	| { type: 'done' }
	| ChunkUpdate;

function jsonResponse(payload: unknown, init: ResponseInit = {}): Response {
	const headers = new Headers(init.headers);
	headers.set('Content-Type', 'application/json');
	return new Response(JSON.stringify(payload), { ...init, headers });
}

function isOriginAllowed(origin: string | null): boolean {
	if (!origin) {
		return false;
	}
	if (allowedOrigins.size === 0) {
		return false;
	}
	return allowedOrigins.has(origin);
}

function getCorsHeaders(origin: string | null): HeadersInit {
	if (!isOriginAllowed(origin)) {
		return {};
	}
	const allowedOrigin = origin ?? '';
	return {
		'Access-Control-Allow-Origin': allowedOrigin,
		'Access-Control-Allow-Methods': corsAllowedMethods,
		'Access-Control-Allow-Headers': defaultAllowedHeaders,
		'Access-Control-Allow-Credentials': 'true',
		'Access-Control-Max-Age': String(corsMaxAgeSeconds),
		Vary: 'Origin'
	};
}

function withCors(request: Request, response: Response): Response {
	const origin = request.headers.get('Origin');
	const headers = new Headers(response.headers);
	const corsHeaders = getCorsHeaders(origin);

	for (const [key, value] of Object.entries(corsHeaders)) {
		headers.set(key, value);
	}

	return new Response(response.body, {
		status: response.status,
		statusText: response.statusText,
		headers
	});
}

function corsTextResponse(request: Request, message: string, status: number): Response {
	return withCors(request, new Response(message, { status }));
}

const corsPreflight = httpAction(async (_, request) => {
	const origin = request.headers.get('Origin');
	const headers = new Headers();
	const corsHeaders = getCorsHeaders(origin);

	for (const [key, value] of Object.entries(corsHeaders)) {
		headers.set(key, value);
	}

	return new Response(null, {
		status: 204,
		headers
	});
});

const chatStream = httpAction(async (ctx, request) => {
	let rawBody: unknown;
	try {
		rawBody = await request.json();
	} catch {
		return corsTextResponse(request, 'Invalid request body', 400);
	}

	const parseResult = chatStreamRequestSchema.safeParse(rawBody);
	if (!parseResult.success) {
		const issues = parseResult.error.issues
			.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
			.join('; ');
		return corsTextResponse(request, `Invalid request: ${issues}`, 400);
	}

	const identity = await ctx.auth.getUserIdentity();
	if (!identity) {
		return corsTextResponse(request, 'Unauthorized', 401);
	}

	const { threadId, message, resources } = parseResult.data;
	const selectedResources = resources ?? [];
	const resolvedThreadId = threadId as Id<'threads'>;

	const instance = (await ctx.runQuery(instanceQueries.getByClerkId, {})) as InstanceRecord | null;
	if (!instance) {
		return corsTextResponse(request, 'Instance not found', 404);
	}

	const threadWithMessages = await ctx.runQuery(api.threads.getWithMessages, {
		threadId: resolvedThreadId
	});
	if (!threadWithMessages) {
		return corsTextResponse(request, 'Thread not found', 404);
	}

	if (threadWithMessages.instanceId !== instance._id) {
		return corsTextResponse(request, 'Forbidden', 403);
	}

	const threadResources = threadWithMessages.threadResources ?? [];
	const updatedResources = [...new Set([...threadResources, ...selectedResources])];
	const threadMessages: ThreadMessage[] = (threadWithMessages.messages ?? []).map(
		(messageItem: MessageLike) => ({
			role: messageItem.role,
			content: messageItem.content,
			canceled: messageItem.canceled
		})
	);
	const questionWithHistory = formatConversationHistory(threadMessages, message);

	if (!ctx.runAction) {
		return corsTextResponse(request, 'Convex runAction is unavailable in HTTP actions', 500);
	}

	const usageCheck = await ctx.runAction(usageActions.ensureUsageAvailable, {
		instanceId: instance._id,
		question: questionWithHistory,
		resources: updatedResources
	});

	if (!usageCheck?.ok) {
		const reason = (usageCheck as { reason?: string }).reason;
		if (reason === 'subscription_required') {
			return corsTextResponse(
				request,
				'Subscription required to use btca Chat. Visit /pricing to subscribe.',
				402
			);
		}
		return corsTextResponse(
			request,
			'Usage limits reached. Contact support to raise your limits.',
			402
		);
	}

	const usageData = usageCheck as {
		inputTokens?: number;
		sandboxUsageHours?: number;
	};

	await ctx.runMutation(api.messages.addUserMessage, {
		threadId: resolvedThreadId,
		content: message,
		resources: updatedResources
	});

	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			const sendEvent = (payload: StreamEventPayload) => {
				controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
			};
			let assistantMessageId: Id<'messages'> | null = null;

			try {
				assistantMessageId = (await ctx.runMutation(api.messages.addAssistantMessage, {
					threadId: resolvedThreadId,
					content: ''
				})) as Id<'messages'>;
				const serverUrl = await ensureServerUrl(ctx, instance, sendEvent);

				const response = await fetch(`${serverUrl}/question/stream`, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json'
					},
					body: JSON.stringify({
						question: questionWithHistory,
						resources: updatedResources,
						quiet: true
					})
				});

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(errorText || `Server error: ${response.status}`);
				}
				if (!response.body) {
					throw new Error('No response body');
				}

				let chunksById = new Map<string, BtcaChunk>();
				let chunkOrder: string[] = [];
				let outputCharCount = 0;
				let reasoningCharCount = 0;
				let doneEvent: BtcaStreamDoneEvent | null = null;
				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });
					const lines = buffer.split('\n');
					buffer = lines.pop() ?? '';

					let eventData = '';
					for (const line of lines) {
						if (line.startsWith('data: ')) {
							eventData = line.slice(6);
						} else if (line === '' && eventData) {
							let event: BtcaStreamEvent;
							try {
								event = JSON.parse(eventData) as BtcaStreamEvent;
							} catch (error) {
								console.error('Failed to parse event:', error);
								eventData = '';
								continue;
							}

							if (event.type === 'error') {
								throw new Error(event.message ?? 'Stream error');
							}
							if (event.type === 'done') {
								doneEvent = event;
							} else if (event.type === 'meta') {
								// ignore meta events from btca server
							} else {
								if (event.type === 'text.delta') {
									outputCharCount += event.delta.length;
								} else if (event.type === 'reasoning.delta') {
									reasoningCharCount += event.delta.length;
								}
								const update = processStreamEvent(event, chunksById, chunkOrder);
								if (update) {
									sendEvent(update);
								}
							}
							eventData = '';
						}
					}
				}

				reader.releaseLock();

				if (doneEvent) {
					const chunkOrderFromDone: string[] = [];
					const chunksByIdFromDone = new Map<string, BtcaChunk>();
					let textCharCount = 0;
					let reasoningCharCountFromDone = 0;

					if (doneEvent.reasoning) {
						const reasoningChunkId = '__reasoning__';
						chunksByIdFromDone.set(reasoningChunkId, {
							type: 'reasoning',
							id: reasoningChunkId,
							text: doneEvent.reasoning
						});
						chunkOrderFromDone.push(reasoningChunkId);
						reasoningCharCountFromDone = doneEvent.reasoning.length;
					}

					if (doneEvent.tools.length > 0) {
						for (const tool of doneEvent.tools) {
							const toolState =
								tool.state?.status === 'pending'
									? 'pending'
									: tool.state?.status === 'running'
										? 'running'
										: 'completed';
							const toolChunk: BtcaChunk = {
								type: 'tool',
								id: tool.callID,
								toolName: tool.tool,
								state: toolState
							};
							chunksByIdFromDone.set(tool.callID, toolChunk);
							chunkOrderFromDone.push(tool.callID);
						}
					}

					if (doneEvent.text) {
						const textChunkId = '__text__';
						chunksByIdFromDone.set(textChunkId, {
							type: 'text',
							id: textChunkId,
							text: doneEvent.text
						});
						chunkOrderFromDone.push(textChunkId);
						textCharCount = doneEvent.text.length;
					}

					chunksById = chunksByIdFromDone;
					chunkOrder = chunkOrderFromDone;
					outputCharCount = textCharCount;
					reasoningCharCount = reasoningCharCountFromDone;
				}

				const assistantContent = {
					type: 'chunks' as const,
					chunks: chunkOrder
						.map((id) => chunksById.get(id))
						.filter((chunk): chunk is BtcaChunk => chunk !== undefined)
				};

				if (!assistantMessageId) {
					throw new Error('Missing assistant message');
				}
				await ctx.runMutation(api.messages.updateAssistantMessage, {
					messageId: assistantMessageId,
					content: assistantContent
				});
				await ctx.runMutation(instanceMutations.touchActivity, { instanceId: instance._id });

				const outputTokensData = {
					questionTokens: usageData.inputTokens ?? 0,
					outputChars: outputCharCount,
					reasoningChars: reasoningCharCount,
					resources: updatedResources,
					sandboxUsageHours: usageData.sandboxUsageHours ?? 0
				};

				try {
					await ctx.runAction(usageActions.finalizeUsage, {
						instanceId: instance._id,
						...outputTokensData
					});
				} catch (error) {
					console.error('Failed to track usage:', error);
				}

				sendEvent({ type: 'done' });
				controller.close();
			} catch (error) {
				if (assistantMessageId) {
					await ctx.runMutation(api.messages.markCanceled, {
						messageId: assistantMessageId
					});
				}
				const message = error instanceof Error ? error.message : 'Unknown error';
				sendEvent({ type: 'error', error: message });
				controller.close();
			}
		}
	});

	const response = new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});

	return withCors(request, response);
});

const clerkWebhook = httpAction(async (ctx, request) => {
	const secret = process.env.CLERK_WEBHOOK_SECRET;
	if (!secret) {
		const response = jsonResponse({ error: 'Missing Clerk webhook secret' }, { status: 500 });
		return withCors(request, response);
	}

	const payload = await request.text();
	const headers = getSvixHeaders(request);
	if (!headers) {
		const response = jsonResponse({ error: 'Missing Svix headers' }, { status: 400 });
		return withCors(request, response);
	}

	const verifiedPayload = await verifySvixSignature(payload, headers, secret);
	if (!verifiedPayload) {
		const response = jsonResponse({ error: 'Invalid webhook signature' }, { status: 400 });
		return withCors(request, response);
	}

	const parsedPayload = clerkWebhookSchema.safeParse(verifiedPayload);
	if (!parsedPayload.success) {
		const issues = parsedPayload.error.issues
			.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
			.join('; ');
		const response = jsonResponse({ error: `Invalid webhook payload: ${issues}` }, { status: 400 });
		return withCors(request, response);
	}

	if (parsedPayload.data.type === 'user.created') {
		const clerkId = parsedPayload.data.data.id;
		if (ctx.runAction) {
			await ctx.runAction(instanceActions.ensureInstanceExists, { clerkId });
		}
	}

	const response = jsonResponse({ received: true });
	return withCors(request, response);
});

http.route({
	path: '/chat/stream',
	method: 'POST',
	handler: chatStream
});

http.route({
	path: '/chat/stream',
	method: 'OPTIONS',
	handler: corsPreflight
});

http.route({
	path: '/webhooks/clerk',
	method: 'POST',
	handler: clerkWebhook
});

http.route({
	path: '/webhooks/clerk',
	method: 'OPTIONS',
	handler: corsPreflight
});

export default http;

function getSvixHeaders(request: Request): SvixHeaders | null {
	const svixId = request.headers.get('svix-id');
	const svixTimestamp = request.headers.get('svix-timestamp');
	const svixSignature = request.headers.get('svix-signature');

	if (!svixId || !svixTimestamp || !svixSignature) {
		return null;
	}

	return {
		'svix-id': svixId,
		'svix-timestamp': svixTimestamp,
		'svix-signature': svixSignature
	};
}

async function verifySvixSignature(
	payload: string,
	headers: SvixHeaders,
	secret: string
): Promise<Record<string, unknown> | null> {
	const normalized = secret.startsWith('whsec_') ? secret.slice(6) : secret;
	let secretBytes: Uint8Array;

	try {
		secretBytes = Uint8Array.from(atob(normalized), (char) => char.charCodeAt(0));
	} catch {
		secretBytes = new TextEncoder().encode(normalized);
	}

	const data = new TextEncoder().encode(
		`${headers['svix-id']}.${headers['svix-timestamp']}.${payload}`
	);
	const keyMaterial = secretBytes.buffer.slice(
		secretBytes.byteOffset,
		secretBytes.byteOffset + secretBytes.byteLength
	) as ArrayBuffer;
	const key = await crypto.subtle.importKey(
		'raw',
		keyMaterial as BufferSource,
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, data);
	const signatureBytes = new Uint8Array(signature as ArrayBuffer);
	const signatureBase64 = btoa(String.fromCharCode(...signatureBytes));

	const candidates = headers['svix-signature']
		.split(' ')
		.map((entry) => entry.trim())
		.filter(Boolean)
		.map((entry) => entry.split(',', 2)[1])
		.filter((value): value is string => Boolean(value));

	const normalizedSignature = signatureBase64.replace(/=+$/, '');
	const matches = candidates.some(
		(candidate) => candidate.replace(/=+$/, '') === normalizedSignature
	);
	if (!matches) {
		return null;
	}

	try {
		return JSON.parse(payload) as Record<string, unknown>;
	} catch {
		return null;
	}
}

function processStreamEvent(
	event: BtcaStreamEvent,
	chunksById: Map<string, BtcaChunk>,
	chunkOrder: string[]
): ChunkUpdate | null {
	switch (event.type) {
		case 'text.delta': {
			const textChunkId = '__text__';
			const existing = chunksById.get(textChunkId);
			if (existing && existing.type === 'text') {
				existing.text += event.delta;
				return { type: 'update', id: textChunkId, chunk: { text: existing.text } };
			}

			const chunk: BtcaChunk = { type: 'text', id: textChunkId, text: event.delta };
			chunksById.set(textChunkId, chunk);
			chunkOrder.push(textChunkId);
			return { type: 'add', chunk };
		}

		case 'reasoning.delta': {
			const reasoningChunkId = '__reasoning__';
			const existing = chunksById.get(reasoningChunkId);
			if (existing && existing.type === 'reasoning') {
				existing.text += event.delta;
				return { type: 'update', id: reasoningChunkId, chunk: { text: existing.text } };
			}

			const chunk: BtcaChunk = {
				type: 'reasoning',
				id: reasoningChunkId,
				text: event.delta
			};
			chunksById.set(reasoningChunkId, chunk);
			chunkOrder.push(reasoningChunkId);
			return { type: 'add', chunk };
		}

		case 'tool.updated': {
			const existing = chunksById.get(event.callID);
			const status = event.state?.status;
			const state =
				status === 'pending' ? 'pending' : status === 'running' ? 'running' : 'completed';

			if (existing && existing.type === 'tool') {
				existing.state = state;
				return { type: 'update', id: event.callID, chunk: { state } };
			}

			const chunk: BtcaChunk = {
				type: 'tool',
				id: event.callID,
				toolName: event.tool,
				state
			};
			chunksById.set(event.callID, chunk);
			chunkOrder.push(event.callID);
			return { type: 'add', chunk };
		}

		default:
			return null;
	}
}

async function ensureServerUrl(
	ctx: ActionCtx,
	instance: InstanceRecord,
	sendEvent: (payload: StreamEventPayload) => void
): Promise<string> {
	if (instance.state === 'error') {
		throw new Error('Instance is in an error state');
	}

	if (instance.state === 'provisioning' || instance.state === 'unprovisioned') {
		throw new Error('Instance is still provisioning');
	}

	if (instance.state === 'running' && instance.serverUrl) {
		sendEvent({ type: 'status', status: 'ready' });
		return instance.serverUrl;
	}

	if (!instance.sandboxId) {
		throw new Error('Instance does not have a sandbox');
	}

	sendEvent({ type: 'status', status: 'starting' });
	if (!ctx.runAction) {
		throw new Error('Convex runAction is unavailable in HTTP actions');
	}
	const result = await ctx.runAction(instanceActions.wake, { instanceId: instance._id });
	const serverUrl = result.serverUrl;
	if (!serverUrl) {
		throw new Error('Instance did not return a server URL');
	}

	sendEvent({ type: 'status', status: 'ready' });
	return serverUrl;
}
