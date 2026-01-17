import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { ConvexHttpClient } from 'convex/browser';
import { api } from '../../../../../convex/_generated/api';
import type { Id } from '../../../../../convex/_generated/dataModel';
import type { BtcaChunk, BtcaStreamEvent } from '$lib/types';
import { formatConversationHistory, type ThreadMessage } from '@btca/shared';
import { z } from 'zod';
import {
	ensureSandboxReady,
	stopOtherSandboxes,
	type ResourceConfig,
	type SandboxStatus
} from '$lib/server/sandbox-service';
import { AutumnService } from '$lib/server/autumn';
import {
	estimateSandboxUsageHours,
	estimateTokensFromChars,
	estimateTokensFromText
} from '$lib/server/usage';
import { SUPPORT_URL } from '$lib/billing/plans';
import { PUBLIC_CONVEX_URL } from '$env/static/public';

// Request body schema - simplified since server fetches thread state from Convex
const ChatRequestSchema = z.object({
	message: z.string().min(1, 'Message is required'),
	resources: z.array(z.string()),
	userId: z.string() // Convex user ID
	// Note: previousMessages removed - server fetches from Convex directly
});

function getConvexClient(): ConvexHttpClient {
	return new ConvexHttpClient(PUBLIC_CONVEX_URL);
}

// POST /api/threads/:threadId/chat - Send a message and stream response
export const POST: RequestHandler = async ({ params, request }) => {
	const threadId = params.threadId as Id<'threads'>;

	// Validate request body
	let rawBody: unknown;
	try {
		const text = await request.text();
		rawBody = JSON.parse(text);
	} catch {
		throw error(400, 'Invalid request body: could not parse JSON');
	}

	const parseResult = ChatRequestSchema.safeParse(rawBody);
	if (!parseResult.success) {
		const issues = parseResult.error.issues
			.map((i) => `${i.path.join('.')}: ${i.message}`)
			.join('; ');
		throw error(400, `Invalid request: ${issues}`);
	}

	const { message, resources, userId } = parseResult.data;

	const convex = getConvexClient();

	// Fetch thread with messages from Convex
	const threadWithMessages = await convex.query(api.threads.getWithMessages, { threadId });
	if (!threadWithMessages) {
		throw error(404, 'Thread not found');
	}

	const threadResources = threadWithMessages.threadResources ?? [];
	const sandboxId = threadWithMessages.sandboxId;

	// Convert previous messages to ThreadMessage format and build history
	const threadMessages: ThreadMessage[] = (threadWithMessages.messages ?? []).map(
		(m: MessageLike) => ({
			role: m.role,
			content: m.content,
			canceled: m.canceled
		})
	);
	const questionWithHistory = formatConversationHistory(threadMessages, message);

	const user = await convex.query(api.users.get, { id: userId as Id<'users'> });
	if (!user) {
		throw error(404, 'User not found');
	}

	const autumn = AutumnService.get();
	const customer = await autumn.getOrCreateCustomer({
		clerkId: user.clerkId,
		email: user.email,
		name: user.name ?? null
	});
	const activeProduct = autumn.getActiveProduct(customer.products);
	if (!activeProduct) {
		throw error(402, 'Subscription required to use btca Chat. Visit /pricing to subscribe.');
	}

	const now = Date.now();
	const inputTokens = estimateTokensFromText(questionWithHistory);

	const availableResources = await convex.query(api.resources.listAvailable, {
		userId: userId as Id<'users'>
	});
	const allResources = [...availableResources.global, ...availableResources.custom];

	// Merge resources
	const updatedResources = [...new Set([...threadResources, ...resources])];

	const sandboxUsageHours =
		updatedResources.length > 0
			? estimateSandboxUsageHours({
					lastActiveAt: user.sandboxLastActiveAt,
					now
				})
			: 0;

	const usageCheck = await autumn.ensureUsageAvailable({
		customerId: customer.id ?? user.clerkId,
		requiredTokensIn: inputTokens > 0 ? inputTokens : undefined,
		requiredTokensOut: 1,
		requiredSandboxHours: sandboxUsageHours > 0 ? sandboxUsageHours : undefined
	});

	if (!usageCheck.ok) {
		throw error(402, `Monthly usage limit reached. Contact ${SUPPORT_URL} to raise limits.`);
	}

	if (updatedResources.length > 0) {
		await convex.mutation(api.users.updateSandboxActivity, {
			userId: userId as Id<'users'>,
			timestamp: now
		});
	}

	// Add user message to Convex
	await convex.mutation(api.messages.addUserMessage, {
		threadId,
		content: message,
		resources
	});

	// Create streaming response
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			try {
				// Stop other sandboxes (enforce 1 active rule)
				await stopOtherSandboxes(userId as Id<'users'>, threadId);

				// Build resource configs for the resources being used
				const resourceConfigs: ResourceConfig[] = [];
				for (const name of updatedResources) {
					const resource = allResources.find((r) => r.name === name);
					if (resource) {
						resourceConfigs.push({
							name: resource.name,
							type: 'git',
							url: resource.url,
							branch: resource.branch,
							searchPath: resource.searchPath,
							specialNotes: resource.specialNotes
						});
					}
				}

				// Ensure sandbox is ready
				const sendStatus = (status: SandboxStatus) => {
					controller.enqueue(
						encoder.encode(`data: ${JSON.stringify({ type: 'status', status })}\n\n`)
					);
				};

				const activeServerUrl = await ensureSandboxReady(
					threadId,
					sandboxId,
					resourceConfigs,
					sendStatus
				);

				// Make request to btca server
				const response = await fetch(`${activeServerUrl}/question/stream`, {
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
					console.error('[chat] btca server error response:', errorText);
					let errorMessage = `Server error: ${response.status}`;
					try {
						const errorData = JSON.parse(errorText) as { error?: string };
						errorMessage = errorData.error ?? errorMessage;
					} catch {
						errorMessage = errorText || errorMessage;
					}
					throw new Error(errorMessage);
				}

				if (!response.body) {
					throw new Error('No response body');
				}

				// Track chunks for the assistant message
				const chunksById = new Map<string, BtcaChunk>();
				const chunkOrder: string[] = [];
				let outputCharCount = 0;
				let reasoningCharCount = 0;

				const reader = response.body.getReader();
				const decoder = new TextDecoder();
				let buffer = '';

				while (true) {
					const { done, value } = await reader.read();
					if (done) break;

					buffer += decoder.decode(value, { stream: true });

					// Process complete events from buffer
					const lines = buffer.split('\n');
					buffer = lines.pop() ?? '';

					let eventData = '';

					for (const line of lines) {
						if (line.startsWith('data: ')) {
							eventData = line.slice(6);
						} else if (line === '' && eventData) {
							try {
								const event = JSON.parse(eventData) as BtcaStreamEvent;
								if (event.type === 'text.delta') {
									outputCharCount += event.delta.length;
								} else if (event.type === 'reasoning.delta') {
									reasoningCharCount += event.delta.length;
								}
								const update = processStreamEvent(event, chunksById, chunkOrder);
								if (update) {
									controller.enqueue(encoder.encode(`data: ${JSON.stringify(update)}\n\n`));
								}
							} catch (e) {
								console.error('Failed to parse event:', e);
							}
							eventData = '';
						}
					}
				}

				reader.releaseLock();

				// Create final assistant message content
				const assistantContent = {
					type: 'chunks' as const,
					chunks: chunkOrder
						.map((id) => chunksById.get(id))
						.filter((c): c is BtcaChunk => c !== undefined)
				};

				// Save assistant message to Convex
				await convex.mutation(api.messages.addAssistantMessage, {
					threadId,
					content: assistantContent
				});

				const outputTokens = estimateTokensFromChars(outputCharCount + reasoningCharCount);
				try {
					await autumn.trackUsage({
						customerId: customer.id ?? user.clerkId,
						tokensIn: inputTokens,
						tokensOut: outputTokens,
						sandboxHours: sandboxUsageHours
					});
				} catch (trackError) {
					console.error('Failed to track usage:', trackError);
				}

				// Send done event
				controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'done' })}\n\n`));
				controller.close();
			} catch (err) {
				const errorMessage = err instanceof Error ? err.message : 'Unknown error';
				controller.enqueue(
					encoder.encode(`data: ${JSON.stringify({ type: 'error', error: errorMessage })}\n\n`)
				);
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache',
			Connection: 'keep-alive'
		}
	});
};

/**
 * Type for messages from Convex that need to be converted to ThreadMessage.
 * This matches the shape of messages stored in the Convex database.
 */
interface MessageLike {
	role: 'user' | 'assistant' | 'system';
	content: string | { type: 'chunks'; chunks: BtcaChunk[] } | { type: 'text'; content: string };
	canceled?: boolean;
}

type ChunkUpdate =
	| { type: 'add'; chunk: BtcaChunk }
	| { type: 'update'; id: string; chunk: Partial<BtcaChunk> };

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
			} else {
				const chunk: BtcaChunk = { type: 'text', id: textChunkId, text: event.delta };
				chunksById.set(textChunkId, chunk);
				chunkOrder.push(textChunkId);
				return { type: 'add', chunk };
			}
		}

		case 'reasoning.delta': {
			const reasoningChunkId = '__reasoning__';
			const existing = chunksById.get(reasoningChunkId);
			if (existing && existing.type === 'reasoning') {
				existing.text += event.delta;
				return { type: 'update', id: reasoningChunkId, chunk: { text: existing.text } };
			} else {
				const chunk: BtcaChunk = { type: 'reasoning', id: reasoningChunkId, text: event.delta };
				chunksById.set(reasoningChunkId, chunk);
				chunkOrder.push(reasoningChunkId);
				return { type: 'add', chunk };
			}
		}

		case 'tool.updated': {
			const existing = chunksById.get(event.callID);
			const state =
				event.state.status === 'pending'
					? 'pending'
					: event.state.status === 'running'
						? 'running'
						: 'completed';

			if (existing && existing.type === 'tool') {
				existing.state = state;
				return { type: 'update', id: event.callID, chunk: { state } };
			} else {
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
		}

		default:
			return null;
	}
}
