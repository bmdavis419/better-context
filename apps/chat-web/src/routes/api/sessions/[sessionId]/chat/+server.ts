import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	getSession,
	updateSessionMessages,
	updateSessionResources
} from '$lib/server/session-manager';
import type { Message, BtcaChunk, BtcaStreamEvent } from '$lib/types';
import { nanoid } from 'nanoid';

// POST /api/sessions/:sessionId/chat - Send a message and stream response
export const POST: RequestHandler = async ({ params, request }) => {
	const session = getSession(params.sessionId);
	if (!session) {
		throw error(404, 'Session not found');
	}

	if (session.status !== 'active') {
		throw error(400, `Session is not active: ${session.status}`);
	}

	const body = (await request.json()) as {
		message: string;
		resources: string[];
	};

	const { message, resources } = body;

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
	const updatedMessages = [...session.messages, userMessage];
	updateSessionMessages(params.sessionId, updatedMessages);

	// Build conversation history
	const history = buildConversationHistory(session.messages);
	const questionWithHistory = history
		? `=== CONVERSATION HISTORY ===\n${history}\n=== END HISTORY ===\n\nCurrent question: ${message}`
		: message;

	// Create streaming response
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			try {
				// Make request to btca server
				const response = await fetch(`${session.serverUrl}/question/stream`, {
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
						chunks: chunkOrder.map((id) => chunksById.get(id)!)
					}
				};

				// Update session with assistant message
				const currentSession = getSession(params.sessionId);
				if (currentSession) {
					updateSessionMessages(params.sessionId, [...currentSession.messages, assistantMessage]);
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

function buildConversationHistory(messages: Message[]): string {
	const historyParts: string[] = [];

	for (const msg of messages) {
		if (msg.role === 'user') {
			const userText = msg.content.replace(/@\w+/g, '').trim();
			if (userText) {
				historyParts.push(`User: ${userText}`);
			}
		} else if (msg.role === 'assistant' && !msg.canceled) {
			if (msg.content.type === 'text') {
				historyParts.push(`Assistant: ${msg.content.content}`);
			} else if (msg.content.type === 'chunks') {
				const textChunks = msg.content.chunks.filter((c) => c.type === 'text');
				const text = textChunks.map((c) => (c as { text: string }).text).join('\n\n');
				if (text) {
					historyParts.push(`Assistant: ${text}`);
				}
			}
		}
	}

	return historyParts.join('\n\n');
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
