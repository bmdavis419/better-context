import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getSession,
	updateSessionMessages,
	updateSessionResources,
	initializeSandbox
} from '$lib/server/session-manager';
import type { Message, BtcaChunk, BtcaStreamEvent, ChatSession } from '$lib/types';
import { formatConversationHistory, type ThreadMessage } from '@btca/shared';
import { nanoid } from 'nanoid';
import { z } from 'zod';

// Request body schema
const ChatRequestSchema = z.object({
	message: z.string().min(1, 'Message is required'),
	resources: z.array(z.string())
});

// POST /api/sessions/:sessionId/chat - Send a message and stream response
export const POST: RequestHandler = async ({ params, request }) => {
	let session = getSession(params.sessionId);
	if (!session) {
		throw error(404, 'Session not found');
	}

	// Validate request body
	const rawBody = await request.json();
	const parseResult = ChatRequestSchema.safeParse(rawBody);
	if (!parseResult.success) {
		throw error(
			400,
			`Invalid request: ${parseResult.error.issues.map((i) => i.message).join(', ')}`
		);
	}

	const { message, resources } = parseResult.data;

	// Build conversation history BEFORE adding the new user message
	const previousMessages = session.messages;
	// Convert to ThreadMessage format for shared history builder
	const threadMessages: ThreadMessage[] = previousMessages.map((m) => ({
		role: m.role,
		content: m.role === 'user' ? m.content : m.content,
		canceled: m.role === 'assistant' ? m.canceled : undefined
	}));
	const questionWithHistory = formatConversationHistory(threadMessages, message);

	// Add user message
	const userMessage: Message = {
		id: nanoid(),
		role: 'user',
		content: message,
		resources
	};

	// Merge resources into thread
	const updatedResources = [...new Set([...session.threadResources, ...resources])];
	updateSessionResources(params.sessionId, updatedResources);

	// Add messages to session
	const updatedMessages = [...previousMessages, userMessage];
	updateSessionMessages(params.sessionId, updatedMessages);

	// Create streaming response
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			try {
				// If session is pending, initialize sandbox first with status updates
				if (session!.status === 'pending') {
					const sendStatus = (status: ChatSession['status']) => {
						controller.enqueue(
							encoder.encode(`data: ${JSON.stringify({ type: 'status', status })}\n\n`)
						);
					};

					session = await initializeSandbox(params.sessionId, sendStatus);
				}

				// Check if session is now active
				if (session!.status !== 'active') {
					throw new Error(`Session is not active: ${session!.status}`);
				}

				// Make request to btca server
				const response = await fetch(`${session!.serverUrl}/question/stream`, {
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
					const errorData = (await response.json()) as { error?: string };
					throw new Error(errorData.error ?? `Server error: ${response.status}`);
				}

				if (!response.body) {
					throw new Error('No response body');
				}

				// Track chunks for the assistant message
				const chunksById = new Map<string, BtcaChunk>();
				const chunkOrder: string[] = [];

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

				// Create final assistant message with chunks
				const assistantMessage: Message = {
					id: nanoid(),
					role: 'assistant',
					content: {
						type: 'chunks',
						chunks: chunkOrder
							.map((id) => chunksById.get(id))
							.filter((c): c is BtcaChunk => c !== undefined)
					}
				};

				// Update session with assistant message using the messages we already have
				// This avoids race conditions from re-fetching the session
				updateSessionMessages(params.sessionId, [...updatedMessages, assistantMessage]);

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
