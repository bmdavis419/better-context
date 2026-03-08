import { formatConversationHistory, type BtcaChunk, type ThreadMessage } from '@btca/shared';
import type { FunctionReference } from 'convex/server';
import { httpRouter } from 'convex/server';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { Result } from 'better-result';

import { api, internal } from './_generated/api.js';
import type { Id } from './_generated/dataModel.js';
import { httpAction, type ActionCtx } from './_generated/server.js';
import { AnalyticsEvents } from './analyticsEvents.js';
import { instances } from './apiHelpers.js';
import { getAppInfo, getInstallationSnapshot } from './githubApp.js';
import { withPrivateApiKey } from './privateWrappers.js';
import {
	INSTANCE_DISK_FULL_MESSAGE,
	getInstanceErrorKind,
	getUserFacingInstanceError
} from '../lib/instanceErrors';
import { getWebSandboxModel } from '../lib/models/webSandboxModels.ts';
import { WebConfigMissingError, WebUnhandledError, type WebError } from '../lib/result/errors';
import { withInstanceRuntimeConfigLock } from './runtimeConfigLock.js';

type HttpFlowResult<T> = Result<T, WebError>;

const usageActions = api.usage;
const instanceActions = instances.actions;
const instanceMutations = instances.mutations;
const instanceQueries = instances.queries;
const githubConnectionsInternal = internal as unknown as {
	githubConnections: {
		upsertForInstance: FunctionReference<
			'mutation',
			'internal',
			{
				instanceId: Id<'instances'>;
				clerkUserId: string;
				installationId: number;
				accountLogin: string;
				accountType: 'User' | 'Organization';
				targetType: 'User' | 'Organization';
				repositorySelection: 'all' | 'selected';
				repositoryIds: number[];
				repositoryNames: string[];
				contentsPermission?: string;
				metadataPermission?: string;
				htmlUrl?: string;
				status: 'active' | 'suspended' | 'deleted';
				connectedAt: number;
				lastSyncedAt: number;
				suspendedAt?: number;
			},
			Id<'githubInstallations'>
		>;
		getByInstallationId: FunctionReference<
			'query',
			'internal',
			{ installationId: number },
			Array<{
				instanceId: Id<'instances'>;
				clerkUserId: string;
				installationId: number;
			}>
		>;
		markDeletedByInstallationId: FunctionReference<
			'mutation',
			'internal',
			{ installationId: number },
			null
		>;
	};
};

const http = httpRouter();

const corsAllowedMethods = 'GET, POST, OPTIONS';
const corsMaxAgeSeconds = 60 * 60 * 24;
const defaultAllowedHeaders = 'Content-Type, Authorization, X-Requested-With';
const localDevHosts = new Set(['localhost', '127.0.0.1']);

const buildAllowedOrigins = (): Set<string> => {
	const origins = (process.env.CLIENT_ORIGIN ?? '')
		.split(',')
		.map((origin) => origin.trim())
		.filter(Boolean);

	if (origins.length === 0) {
		return new Set();
	}

	return new Set(origins);
};

const allowedOrigins = buildAllowedOrigins();
const githubConnectStateLifetimeMs = 10 * 60 * 1000;

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

const daytonaWebhookSchema = z.object({
	event: z.string(),
	id: z.string().min(1),
	newState: z.string().optional(),
	oldState: z.string().optional(),
	organizationId: z.string().optional(),
	timestamp: z.string().optional(),
	updatedAt: z.string().optional()
});

type MessageLike = {
	role: 'user' | 'assistant' | 'system';
	content: string | { type: 'chunks'; chunks: BtcaChunk[] } | { type: 'text'; content: string };
	canceled?: boolean;
};

type ChunkUpdate =
	| { type: 'add'; chunk: BtcaChunk }
	| { type: 'update'; id: string; chunk: Partial<BtcaChunk> }
	| { type: 'append'; id: string; chunkType: 'text' | 'reasoning'; delta: string };

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
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		reasoningTokens?: number;
		totalTokens?: number;
		cachedTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	};
	metrics?: {
		timing?: { totalMs?: number; genMs?: number };
		throughput?: { outputTokensPerSecond?: number; totalTokensPerSecond?: number };
		pricing?: {
			source: 'models.dev';
			modelKey?: string;
			ratesUsdPerMTokens?: {
				input?: number;
				output?: number;
				reasoning?: number;
				cacheRead?: number;
				cacheWrite?: number;
			};
			costUsd?: { input?: number; output?: number; reasoning?: number; total?: number };
		};
	};
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
	errorKind?: 'disk_full' | 'generic';
	serverUrl?: string | null;
	sandboxId?: string | null;
};

type InstanceServerAccess = {
	serverUrl: string;
	previewToken?: string;
};

type StreamEventPayload =
	| { type: 'status'; status: 'starting' | 'ready' }
	| { type: 'session'; sessionId: string }
	| { type: 'error'; error: string }
	| { type: 'done' }
	| ChunkUpdate;

const toMessageStats = (doneEvent: BtcaStreamDoneEvent | null) => {
	if (!doneEvent) return undefined;

	const inputTokens = doneEvent.usage?.inputTokens;
	const outputTokens =
		doneEvent.usage?.outputTokens != null || doneEvent.usage?.reasoningTokens != null
			? (doneEvent.usage?.outputTokens ?? 0) + (doneEvent.usage?.reasoningTokens ?? 0)
			: undefined;
	const cachedTokens =
		doneEvent.usage?.cachedTokens ??
		(doneEvent.usage?.cacheReadTokens != null || doneEvent.usage?.cacheWriteTokens != null
			? (doneEvent.usage?.cacheReadTokens ?? 0) + (doneEvent.usage?.cacheWriteTokens ?? 0)
			: undefined);
	const durationMs = doneEvent.metrics?.timing?.totalMs ?? doneEvent.metrics?.timing?.genMs;
	const totalTokensFromParts = [inputTokens, outputTokens, cachedTokens].reduce<number>(
		(sum, value) => sum + (value ?? 0),
		0
	);
	const totalTokens =
		doneEvent.usage?.totalTokens ?? (totalTokensFromParts > 0 ? totalTokensFromParts : undefined);
	const tokensPerSecond =
		doneEvent.metrics?.throughput?.totalTokensPerSecond ??
		doneEvent.metrics?.throughput?.outputTokensPerSecond ??
		(durationMs && totalTokens ? totalTokens / (durationMs / 1000) : undefined);
	const totalPriceUsd = doneEvent.metrics?.pricing?.costUsd?.total;

	if (
		durationMs == null &&
		inputTokens == null &&
		outputTokens == null &&
		cachedTokens == null &&
		totalTokens == null &&
		tokensPerSecond == null &&
		totalPriceUsd == null
	) {
		return undefined;
	}

	return {
		durationMs,
		inputTokens,
		outputTokens,
		cachedTokens,
		totalTokens,
		tokensPerSecond,
		totalPriceUsd
	};
};

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
		try {
			const parsed = new URL(origin);
			return localDevHosts.has(parsed.hostname);
		} catch {
			return false;
		}
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

const getClientOrigin = (request: Request) => {
	const origin = request.headers.get('Origin');
	if (origin && isOriginAllowed(origin)) {
		return origin;
	}

	return [...allowedOrigins][0] ?? 'http://localhost:5173';
};

const getGitHubStateSecret = () => {
	const secret = process.env.GITHUB_APP_CLIENT_SECRET;
	if (!secret) {
		throw new WebConfigMissingError({
			message: 'GITHUB_APP_CLIENT_SECRET is not set in the Convex environment',
			config: 'GITHUB_APP_CLIENT_SECRET'
		});
	}
	return secret;
};

const sanitizeReturnTo = (value: string | null) =>
	value && value.startsWith('/') && !value.startsWith('//') ? value : '/app/settings/resources';

const toHex = (bytes: Uint8Array) =>
	[...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');

const toBase64Url = (value: string) =>
	btoa(String.fromCharCode(...new TextEncoder().encode(value)))
		.replace(/\+/g, '-')
		.replace(/\//g, '_')
		.replace(/=+$/g, '');

const fromBase64Url = (value: string) => {
	const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
	const padding = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
	const binary = atob(`${normalized}${padding}`);
	return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
};

const signHmacSha256 = async (secret: string, payload: string) => {
	const key = await crypto.subtle.importKey(
		'raw',
		new TextEncoder().encode(secret),
		{ name: 'HMAC', hash: 'SHA-256' },
		false,
		['sign']
	);
	const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
	return toHex(new Uint8Array(signature));
};

const encodeGitHubConnectState = async (payload: {
	clerkId: string;
	returnTo: string;
	issuedAt: number;
}) => {
	const body = toBase64Url(JSON.stringify(payload));
	const signature = await signHmacSha256(getGitHubStateSecret(), body);
	return `${body}.${signature}`;
};

const decodeGitHubConnectState = async (state: string) => {
	const [body, signature] = state.split('.', 2);
	if (!body || !signature) {
		return null;
	}

	const expectedSignature = await signHmacSha256(getGitHubStateSecret(), body);
	if (signature !== expectedSignature) {
		return null;
	}

	try {
		const parsed = JSON.parse(fromBase64Url(body)) as {
			clerkId?: string;
			returnTo?: string;
			issuedAt?: number;
		};
		if (!parsed.clerkId || typeof parsed.issuedAt !== 'number') {
			return null;
		}
		if (Date.now() - parsed.issuedAt > githubConnectStateLifetimeMs) {
			return null;
		}

		return {
			clerkId: parsed.clerkId,
			returnTo: sanitizeReturnTo(parsed.returnTo ?? null),
			issuedAt: parsed.issuedAt
		};
	} catch {
		return null;
	}
};

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
	const projectId = threadWithMessages.projectId ?? undefined;
	const project = projectId
		? await ctx.runQuery(internal.projects.getInternal, { projectId })
		: null;
	const modelId =
		project && project.instanceId === instance._id
			? getWebSandboxModel(project.model).id
			: getWebSandboxModel().id;
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
		resources: updatedResources,
		projectId
	});

	if (!usageCheck?.ok) {
		const reason = (usageCheck as { reason?: string }).reason;
		if (reason === 'subscription_required') {
			await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
				distinctId: identity.subject,
				event: AnalyticsEvents.SUBSCRIPTION_REQUIRED_SHOWN,
				properties: { instanceId: instance._id }
			});
			return corsTextResponse(
				request,
				'Subscription required to use btca Chat. Visit /pricing to subscribe.',
				402
			);
		}
		if (reason === 'free_limit_reached') {
			await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
				distinctId: identity.subject,
				event: AnalyticsEvents.USAGE_LIMIT_REACHED,
				properties: { instanceId: instance._id, limitType: 'free_messages' }
			});
			return corsTextResponse(
				request,
				"You've used all 5 free messages. Upgrade to Pro for $8/month to continue.",
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
		requiredBudgetMicros?: number;
		modelId?: string;
	};

	const streamStartedAt = Date.now();

	await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
		distinctId: identity.subject,
		event: AnalyticsEvents.STREAM_STARTED,
		properties: {
			instanceId: instance._id,
			threadId: resolvedThreadId,
			resourceCount: updatedResources.length,
			resources: updatedResources,
			inputTokens: usageData.inputTokens ?? 0,
			modelId: usageData.modelId ?? modelId,
			requiredBudgetMicros: usageData.requiredBudgetMicros ?? 0
		}
	});

	await ctx.runMutation(api.messages.addUserMessage, {
		threadId: resolvedThreadId,
		content: message,
		resources: updatedResources
	});

	const sessionId = nanoid();
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

				await ctx.runMutation(api.streamSessions.create, {
					threadId: resolvedThreadId,
					messageId: assistantMessageId,
					sessionId
				});

				sendEvent({ type: 'session', sessionId } as StreamEventPayload);

				await withInstanceRuntimeConfigLock(instance._id.toString(), async () => {
					const serverAccessResult = await ensureServerUrlResult(
						ctx,
						instance,
						projectId,
						sendEvent
					);
					if (Result.isError(serverAccessResult)) {
						throw serverAccessResult.error;
					}
					const serverAccess = serverAccessResult.value;

					const response = await fetch(`${serverAccess.serverUrl}/question/stream`, {
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							...(serverAccess.previewToken
								? { 'x-daytona-preview-token': serverAccess.previewToken }
								: {})
						},
						body: JSON.stringify({
							question: questionWithHistory,
							resources: updatedResources,
							quiet: true
						})
					});

					if (!response.ok) {
						const errorText = await response.text();
						throw new WebUnhandledError({
							message: errorText || `Server error: ${response.status}`,
							cause: new Error(errorText || `Server error: ${response.status}`)
						});
					}
					if (!response.body) {
						throw new WebUnhandledError({ message: 'No response body' });
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
									throw new WebUnhandledError({
										message: event.message ?? 'Stream error',
										cause: new Error(event.message ?? 'Stream error')
									});
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
						throw new WebUnhandledError({ message: 'Missing assistant message' });
					}
					await ctx.runMutation(api.messages.updateAssistantMessage, {
						messageId: assistantMessageId,
						content: assistantContent,
						stats: toMessageStats(doneEvent)
					});
					await ctx.runMutation(
						instanceMutations.touchActivity,
						withPrivateApiKey({ instanceId: instance._id })
					);

					const actualUsage = doneEvent?.usage;

					let chargedBudgetMicros = 0;
					try {
						const finalizeResult = await ctx.runAction(usageActions.finalizeUsage, {
							instanceId: instance._id,
							modelId: usageData.modelId ?? modelId,
							inputTokens: actualUsage?.inputTokens ?? usageData.inputTokens ?? 0,
							outputTokens: actualUsage?.outputTokens ?? 0,
							reasoningTokens: actualUsage?.reasoningTokens ?? 0,
							cacheReadTokens: actualUsage?.cacheReadTokens ?? 0,
							cacheWriteTokens: actualUsage?.cacheWriteTokens ?? 0,
							chargedBudgetMicros:
								doneEvent?.metrics?.pricing?.costUsd?.total != null
									? Math.max(0, Math.round(doneEvent.metrics.pricing.costUsd.total * 1_000_000))
									: undefined
						});
						chargedBudgetMicros = finalizeResult.chargedBudgetMicros ?? 0;
					} catch (error) {
						console.error('Failed to track usage:', error);
					}

					await ctx.runMutation(
						instanceMutations.scheduleSyncSandboxStatus,
						withPrivateApiKey({ instanceId: instance._id })
					);

					await ctx.runMutation(api.streamSessions.complete, withPrivateApiKey({ sessionId }));

					const streamDurationMs = Date.now() - streamStartedAt;
					const toolsUsed = chunkOrder
						.map((id) => chunksById.get(id))
						.filter((c): c is BtcaChunk => c?.type === 'tool')
						.map((c) => (c as { toolName: string }).toolName);

					await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
						distinctId: identity.subject,
						event: AnalyticsEvents.STREAM_COMPLETED,
						properties: {
							instanceId: instance._id,
							threadId: resolvedThreadId,
							durationMs: streamDurationMs,
							outputChars: outputCharCount,
							reasoningChars: reasoningCharCount,
							toolsUsed,
							toolCount: toolsUsed.length,
							resourcesUsed: updatedResources,
							resourceCount: updatedResources.length,
							modelId: usageData.modelId ?? modelId,
							inputTokens: actualUsage?.inputTokens ?? usageData.inputTokens ?? 0,
							outputTokens: actualUsage?.outputTokens ?? 0,
							reasoningTokens: actualUsage?.reasoningTokens ?? 0,
							chargedBudgetMicros
						}
					});
				});

				sendEvent({ type: 'done' });
				controller.close();
			} catch (error) {
				const errorMessage = error instanceof Error ? error.message : 'Unknown error';
				if (getInstanceErrorKind(error) === 'disk_full') {
					await ctx.runMutation(
						instanceMutations.setError,
						withPrivateApiKey({
							instanceId: instance._id,
							errorKind: 'disk_full',
							errorMessage: getUserFacingInstanceError(error, errorMessage)
						})
					);
				}
				const streamDurationMs = Date.now() - streamStartedAt;

				await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
					distinctId: identity.subject,
					event: AnalyticsEvents.STREAM_FAILED,
					properties: {
						instanceId: instance._id,
						threadId: resolvedThreadId,
						error: errorMessage,
						durationMs: streamDurationMs
					}
				});

				await ctx.runMutation(
					api.streamSessions.fail,
					withPrivateApiKey({ sessionId, error: errorMessage })
				);

				if (assistantMessageId) {
					await ctx.runMutation(api.messages.markCanceled, {
						messageId: assistantMessageId
					});
				}
				sendEvent({ type: 'error', error: errorMessage });
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
		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: 'webhook_system',
			event: AnalyticsEvents.WEBHOOK_VERIFICATION_FAILED,
			properties: { webhookType: 'clerk', reason: 'missing_svix_headers' }
		});
		const response = jsonResponse({ error: 'Missing Svix headers' }, { status: 400 });
		return withCors(request, response);
	}

	const verifiedPayload = await verifySvixSignature(payload, headers, secret);
	if (!verifiedPayload) {
		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: 'webhook_system',
			event: AnalyticsEvents.WEBHOOK_VERIFICATION_FAILED,
			properties: { webhookType: 'clerk', reason: 'invalid_signature' }
		});
		const response = jsonResponse({ error: 'Invalid webhook signature' }, { status: 400 });
		return withCors(request, response);
	}

	const parsedPayload = clerkWebhookSchema.safeParse(verifiedPayload);
	if (!parsedPayload.success) {
		const issues = parsedPayload.error.issues
			.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
			.join('; ');
		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: 'webhook_system',
			event: AnalyticsEvents.WEBHOOK_VERIFICATION_FAILED,
			properties: { webhookType: 'clerk', reason: 'invalid_payload', issues }
		});
		const response = jsonResponse({ error: `Invalid webhook payload: ${issues}` }, { status: 400 });
		return withCors(request, response);
	}

	if (parsedPayload.data.type === 'user.created') {
		const clerkId = parsedPayload.data.data.id;
		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: clerkId,
			event: AnalyticsEvents.USER_SIGNED_UP,
			properties: { timestamp: Date.now() }
		});
		if (ctx.runAction) {
			await ctx.runAction(
				instanceActions.ensureInstanceExistsPrivate,
				withPrivateApiKey({ clerkId })
			);
		}
	}

	const response = jsonResponse({ received: true });
	return withCors(request, response);
});

const githubConnectStart = httpAction(async (ctx, request) => {
	try {
		const identity = await ctx.auth.getUserIdentity();
		if (!identity) {
			return corsTextResponse(request, 'Unauthorized', 401);
		}

		const url = new URL(request.url);
		const returnTo = sanitizeReturnTo(url.searchParams.get('returnTo'));
		const state = await encodeGitHubConnectState({
			clerkId: identity.subject,
			returnTo,
			issuedAt: Date.now()
		});
		const appInfo = await getAppInfo();
		const response = jsonResponse({
			url: `https://github.com/apps/${appInfo.slug}/installations/new?state=${encodeURIComponent(state)}`
		});
		return withCors(request, response);
	} catch (error) {
		const message = error instanceof Error ? error.message : 'Failed to start GitHub connect flow';
		return withCors(request, jsonResponse({ error: message }, { status: 500 }));
	}
});

const githubConnectCallback = httpAction(async (ctx, request) => {
	const url = new URL(request.url);
	const state = await decodeGitHubConnectState(url.searchParams.get('state') ?? '');
	const clientOrigin = getClientOrigin(request);
	const redirectUrl = new URL(state?.returnTo ?? '/app/settings/resources', clientOrigin);

	if (!state) {
		redirectUrl.searchParams.set('github', 'error');
		redirectUrl.searchParams.set('github_error', 'invalid_state');
		return Response.redirect(redirectUrl.toString(), 302);
	}

	const installationIdValue = Number(url.searchParams.get('installation_id'));
	if (!Number.isFinite(installationIdValue) || installationIdValue <= 0) {
		redirectUrl.searchParams.set('github', 'error');
		redirectUrl.searchParams.set('github_error', 'missing_installation');
		return Response.redirect(redirectUrl.toString(), 302);
	}

	const instance = await ctx.runQuery(instances.internalQueries.getByClerkIdInternal, {
		clerkId: state.clerkId
	});
	if (!instance) {
		redirectUrl.searchParams.set('github', 'error');
		redirectUrl.searchParams.set('github_error', 'missing_instance');
		return Response.redirect(redirectUrl.toString(), 302);
	}

	const snapshot = await getInstallationSnapshot(installationIdValue);
	if (!snapshot) {
		redirectUrl.searchParams.set('github', 'error');
		redirectUrl.searchParams.set('github_error', 'missing_installation');
		return Response.redirect(redirectUrl.toString(), 302);
	}

	await ctx.runMutation(githubConnectionsInternal.githubConnections.upsertForInstance, {
		instanceId: instance._id,
		clerkUserId: state.clerkId,
		installationId: snapshot.installationId,
		accountLogin: snapshot.accountLogin,
		accountType: snapshot.accountType,
		targetType: snapshot.targetType,
		repositorySelection: snapshot.repositorySelection,
		repositoryIds: snapshot.repositoryIds,
		repositoryNames: snapshot.repositoryNames,
		contentsPermission: snapshot.contentsPermission,
		metadataPermission: snapshot.metadataPermission,
		htmlUrl: snapshot.htmlUrl,
		status: snapshot.status,
		connectedAt: snapshot.connectedAt,
		lastSyncedAt: snapshot.lastSyncedAt,
		suspendedAt: snapshot.suspendedAt
	});

	redirectUrl.searchParams.set('github', 'connected');
	const setupAction = url.searchParams.get('setup_action');
	if (setupAction) {
		redirectUrl.searchParams.set('setup_action', setupAction);
	}
	return Response.redirect(redirectUrl.toString(), 302);
});

const verifyGitHubWebhookSignature = async (
	payload: string,
	signature: string | null,
	secret: string
) => {
	if (!signature?.startsWith('sha256=')) {
		return false;
	}

	const expected = await signHmacSha256(secret, payload);
	return signature === `sha256=${expected}`;
};

const githubWebhook = httpAction(async (ctx, request) => {
	const secret = process.env.GITHUB_APP_WEBHOOK_SECRET;
	if (!secret) {
		return jsonResponse({ error: 'Missing GitHub webhook secret' }, { status: 500 });
	}

	const payload = await request.text();
	const signature = request.headers.get('x-hub-signature-256');
	const isValid = await verifyGitHubWebhookSignature(payload, signature, secret);
	if (!isValid) {
		return jsonResponse({ error: 'Invalid webhook signature' }, { status: 400 });
	}

	const event = request.headers.get('x-github-event') ?? '';
	let body: {
		action?: string;
		installation?: { id?: number };
	};
	try {
		body = JSON.parse(payload) as {
			action?: string;
			installation?: { id?: number };
		};
	} catch {
		return jsonResponse({ error: 'Invalid webhook payload' }, { status: 400 });
	}
	const installationId = body.installation?.id;

	if (!installationId || !['installation', 'installation_repositories'].includes(event)) {
		return jsonResponse({ received: true });
	}

	if (event === 'installation' && body.action === 'deleted') {
		await ctx.runMutation(githubConnectionsInternal.githubConnections.markDeletedByInstallationId, {
			installationId
		});
		return jsonResponse({ received: true });
	}

	const snapshot = await getInstallationSnapshot(installationId);
	if (!snapshot) {
		await ctx.runMutation(githubConnectionsInternal.githubConnections.markDeletedByInstallationId, {
			installationId
		});
		return jsonResponse({ received: true });
	}

	const linkedInstallations = await ctx.runQuery(
		githubConnectionsInternal.githubConnections.getByInstallationId,
		{ installationId }
	);

	await Promise.all(
		linkedInstallations.map((record) =>
			ctx.runMutation(githubConnectionsInternal.githubConnections.upsertForInstance, {
				instanceId: record.instanceId,
				clerkUserId: record.clerkUserId,
				installationId: snapshot.installationId,
				accountLogin: snapshot.accountLogin,
				accountType: snapshot.accountType,
				targetType: snapshot.targetType,
				repositorySelection: snapshot.repositorySelection,
				repositoryIds: snapshot.repositoryIds,
				repositoryNames: snapshot.repositoryNames,
				contentsPermission: snapshot.contentsPermission,
				metadataPermission: snapshot.metadataPermission,
				htmlUrl: snapshot.htmlUrl,
				status: snapshot.status,
				connectedAt: snapshot.connectedAt,
				lastSyncedAt: snapshot.lastSyncedAt,
				suspendedAt: snapshot.suspendedAt
			})
		)
	);

	return jsonResponse({ received: true });
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

http.route({
	path: '/github/connect/start',
	method: 'GET',
	handler: githubConnectStart
});

http.route({
	path: '/github/connect/start',
	method: 'OPTIONS',
	handler: corsPreflight
});

http.route({
	path: '/github/connect/callback',
	method: 'GET',
	handler: githubConnectCallback
});

http.route({
	path: '/webhooks/github',
	method: 'POST',
	handler: githubWebhook
});

const daytonaWebhook = httpAction(async (ctx, request) => {
	const secret = process.env.DAYTONA_WEBHOOK_SECRET;
	if (!secret) {
		return jsonResponse({ error: 'Missing Daytona webhook secret' }, { status: 500 });
	}

	const payload = await request.text();
	const headers = getSvixHeaders(request);
	if (!headers) {
		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: 'webhook_system',
			event: AnalyticsEvents.WEBHOOK_VERIFICATION_FAILED,
			properties: { webhookType: 'daytona', reason: 'missing_svix_headers' }
		});
		return jsonResponse({ error: 'Missing Svix headers' }, { status: 400 });
	}

	const verifiedPayload = await verifySvixSignature(payload, headers, secret);
	if (!verifiedPayload) {
		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: 'webhook_system',
			event: AnalyticsEvents.WEBHOOK_VERIFICATION_FAILED,
			properties: { webhookType: 'daytona', reason: 'invalid_signature' }
		});
		return jsonResponse({ error: 'Invalid webhook signature' }, { status: 400 });
	}

	const parseResult = daytonaWebhookSchema.safeParse(verifiedPayload);
	if (!parseResult.success) {
		const issues = parseResult.error.issues
			.map((issue) => `${issue.path.join('.')}: ${issue.message}`)
			.join('; ');
		await ctx.scheduler.runAfter(0, internal.analytics.trackEvent, {
			distinctId: 'webhook_system',
			event: AnalyticsEvents.WEBHOOK_VERIFICATION_FAILED,
			properties: { webhookType: 'daytona', reason: 'invalid_payload', issues }
		});
		return jsonResponse({ error: `Invalid webhook payload: ${issues}` }, { status: 400 });
	}

	const { event, id: sandboxId, newState } = parseResult.data;

	if (event === 'sandbox.state.updated' && newState === 'stopped') {
		await ctx.runMutation(instanceMutations.handleSandboxStopped, withPrivateApiKey({ sandboxId }));
	} else if (event === 'sandbox.state.updated' && newState === 'started') {
		await ctx.runMutation(instanceMutations.handleSandboxStarted, withPrivateApiKey({ sandboxId }));
	}

	return jsonResponse({ received: true });
});

http.route({
	path: '/webhooks/daytona',
	method: 'POST',
	handler: daytonaWebhook
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
				return { type: 'append', id: textChunkId, chunkType: 'text', delta: event.delta };
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
				return {
					type: 'append',
					id: reasoningChunkId,
					chunkType: 'reasoning',
					delta: event.delta
				};
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

async function ensureServerUrlResult(
	ctx: ActionCtx,
	instance: InstanceRecord,
	projectId: Id<'projects'> | undefined,
	sendEvent: (payload: StreamEventPayload) => void
): Promise<HttpFlowResult<InstanceServerAccess>> {
	if (instance.state === 'error') {
		return Result.err(
			new WebUnhandledError({
				message:
					instance.errorKind === 'disk_full'
						? INSTANCE_DISK_FULL_MESSAGE
						: 'Instance is in an error state'
			})
		);
	}

	if (instance.state === 'provisioning' || instance.state === 'unprovisioned') {
		return Result.err(new WebUnhandledError({ message: 'Instance is still provisioning' }));
	}

	if (instance.state === 'running' && instance.serverUrl) {
		if (!instance.sandboxId) {
			sendEvent({ type: 'status', status: 'ready' });
			return Result.ok({ serverUrl: instance.serverUrl });
		}

		let shouldWake = false;
		if (projectId) {
			const syncResult = await ctx.runAction(internal.instances.actions.syncResources, {
				instanceId: instance._id,
				projectId,
				includePrivate: true
			});
			if (!syncResult.synced) {
				// Convex state can briefly say "running" after Daytona has already stopped the sandbox.
				// Reuse the wake flow in that case so project chats recover instead of surfacing a false error.
				shouldWake = true;
			}
		}

		if (!shouldWake) {
			const previewAccess = await ctx.runAction(internal.instances.actions.getPreviewAccess, {
				instanceId: instance._id
			});
			sendEvent({ type: 'status', status: 'ready' });
			return Result.ok(previewAccess);
		}
	}

	if (!instance.sandboxId) {
		return Result.err(new WebUnhandledError({ message: 'Instance does not have a sandbox' }));
	}

	sendEvent({ type: 'status', status: 'starting' });
	if (!ctx.runAction) {
		return Result.err(
			new WebUnhandledError({ message: 'Convex runAction is unavailable in HTTP actions' })
		);
	}

	try {
		const result = await ctx.runAction(
			instanceActions.wake,
			withPrivateApiKey({ instanceId: instance._id, projectId })
		);
		const serverUrl = result.serverUrl;
		if (!serverUrl) {
			return Result.err(new WebUnhandledError({ message: 'Instance did not return a server URL' }));
		}
		const previewAccess = await ctx.runAction(internal.instances.actions.getPreviewAccess, {
			instanceId: instance._id
		});

		sendEvent({ type: 'status', status: 'ready' });
		return Result.ok(previewAccess);
	} catch (error) {
		if (error instanceof Error) {
			return Result.err(new WebUnhandledError({ message: error.message, cause: error }));
		}
		return Result.err(new WebUnhandledError({ message: 'Failed to resolve instance URL' }));
	}
}
