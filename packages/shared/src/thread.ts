// ─────────────────────────────────────────────────────────────────────────────
// Chunk Types - used for streaming assistant responses
// ─────────────────────────────────────────────────────────────────────────────

export interface TextChunk {
	type: 'text';
	id: string;
	text: string;
}

export interface ReasoningChunk {
	type: 'reasoning';
	id: string;
	text: string;
}

export interface ToolChunk {
	type: 'tool';
	id: string;
	toolName: string;
	state: 'pending' | 'running' | 'completed';
}

export interface FileChunk {
	type: 'file';
	id: string;
	filePath: string;
}

export type BtcaChunk = TextChunk | ReasoningChunk | ToolChunk | FileChunk;

// ─────────────────────────────────────────────────────────────────────────────
// Thread Message Types - canonical format for conversation history
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Assistant message content can be:
 * - A plain string (simple text response)
 * - An object with type 'text' (legacy format)
 * - An object with type 'chunks' (streaming format with multiple chunk types)
 */
export type AssistantContent =
	| string
	| { type: 'text'; content: string }
	| { type: 'chunks'; chunks: BtcaChunk[] };

/**
 * A message in a conversation thread.
 * This is the canonical type used for building conversation history.
 *
 * - User messages have string content (the question text)
 * - Assistant messages have AssistantContent (string, text object, or chunks)
 * - System messages have string content (informational messages)
 */
export interface ThreadMessage {
	role: 'user' | 'assistant' | 'system';
	content: string | AssistantContent;
	canceled?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Common State Types
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cancel state for streaming requests.
 * - 'none': No cancel requested
 * - 'pending': User has requested cancel, waiting for confirmation or completion
 */
export type CancelState = 'none' | 'pending';

// ─────────────────────────────────────────────────────────────────────────────
// Helper Functions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extract plain text content from a message, handling all content formats.
 * Returns empty string for non-text content (tools, files, etc.)
 */
export function extractMessageText(message: ThreadMessage): string {
	const { content } = message;

	// Plain string content
	if (typeof content === 'string') {
		return content;
	}

	// Structured content
	if (typeof content === 'object' && 'type' in content) {
		if (content.type === 'text') {
			return content.content;
		}
		if (content.type === 'chunks') {
			return content.chunks
				.filter((c): c is TextChunk => c.type === 'text')
				.map((c) => c.text)
				.join('\n\n');
		}
	}

	return '';
}

/**
 * Format conversation history for LLM context.
 * Uses XML-style tags that modern LLMs understand well.
 *
 * @param messages - Array of thread messages (the conversation history)
 * @param currentQuestion - The current user question
 * @returns Formatted prompt string with history and current question
 *
 * @example
 * // With history:
 * // <conversation_history>
 * // <human>What is React?</human>
 * // <assistant>React is a JavaScript library...</assistant>
 * // </conversation_history>
 * //
 * // <current_message>
 * // How do I use hooks?
 * // </current_message>
 *
 * @example
 * // Without history, just returns the question as-is
 */
export function formatConversationHistory(
	messages: ThreadMessage[],
	currentQuestion: string
): string {
	// Filter to only user/assistant messages, exclude canceled and system
	const relevantMessages = messages.filter(
		(m) => (m.role === 'user' || m.role === 'assistant') && !m.canceled
	);

	if (relevantMessages.length === 0) {
		return currentQuestion;
	}

	const historyParts: string[] = [];

	for (const msg of relevantMessages) {
		const text = extractMessageText(msg).trim();
		if (!text) continue;

		const tag = msg.role === 'user' ? 'human' : 'assistant';
		historyParts.push(`<${tag}>\n${text}\n</${tag}>`);
	}

	if (historyParts.length === 0) {
		return currentQuestion;
	}

	return `<conversation_history>
${historyParts.join('\n\n')}
</conversation_history>

<current_message>
${currentQuestion}
</current_message>`;
}
