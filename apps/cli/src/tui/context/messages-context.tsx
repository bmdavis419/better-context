import {
	createContext,
	createSignal,
	useContext,
	type Accessor,
	type Component,
	type ParentProps
} from 'solid-js';
import type { Message, InputState, CancelState, BtcaChunk } from '../types.ts';
import { formatConversationHistory, type ThreadMessage } from '@btca/shared';
import { services, type ChunkUpdate } from '../services.ts';
import { copyToClipboard } from '../clipboard.ts';

type MessagesState = {
	// Message history
	messages: Accessor<Message[]>;
	addSystemMessage: (content: string) => void;
	clearMessages: () => void;

	// Thread resources - accumulates @mentions across the conversation
	threadResources: Accessor<string[]>;

	// Streaming state
	isStreaming: Accessor<boolean>;
	cancelState: Accessor<CancelState>;

	// Actions
	send: (input: InputState, newResources: string[]) => Promise<void>;
	requestCancel: () => void;
	confirmCancel: () => Promise<void>;
};

const MessagesContext = createContext<MessagesState>();

export const useMessagesContext = () => {
	const context = useContext(MessagesContext);
	if (!context) throw new Error('useMessagesContext must be used within MessagesProvider');
	return context;
};

const defaultMessageHistory: Message[] = [
	{
		role: 'system',
		content:
			"Welcome to btca! Ask anything about the library/framework you're interested in (make sure you @ it first)"
	}
];

export const MessagesProvider: Component<ParentProps> = (props) => {
	const [messages, setMessages] = createSignal<Message[]>(defaultMessageHistory);
	const [threadResources, setThreadResources] = createSignal<string[]>([]);
	const [isStreaming, setIsStreaming] = createSignal(false);
	const [cancelState, setCancelState] = createSignal<CancelState>('none');

	// Internal helpers for message updates
	const addMessage = (message: Message) => setMessages((prev) => [...prev, message]);

	const addChunkToLastAssistant = (chunk: BtcaChunk) => {
		setMessages((prev) => {
			const newHistory = [...prev];
			for (let i = newHistory.length - 1; i >= 0; i--) {
				const msg = newHistory[i];
				if (
					msg?.role === 'assistant' &&
					typeof msg.content === 'object' &&
					msg.content.type === 'chunks'
				) {
					newHistory[i] = {
						role: 'assistant',
						content: { type: 'chunks', chunks: [...msg.content.chunks, chunk] }
					};
					break;
				}
			}
			return newHistory;
		});
	};

	const updateChunkInLastAssistant = (id: string, updates: Partial<BtcaChunk>) => {
		setMessages((prev) => {
			const newHistory = [...prev];
			for (let i = newHistory.length - 1; i >= 0; i--) {
				const msg = newHistory[i];
				if (
					msg?.role === 'assistant' &&
					typeof msg.content === 'object' &&
					msg.content.type === 'chunks'
				) {
					const updatedChunks = msg.content.chunks.map((c: BtcaChunk): BtcaChunk => {
						if (c.id !== id) return c;
						if (c.type === 'text' && 'text' in updates) {
							return { ...c, text: updates.text as string };
						}
						if (c.type === 'reasoning' && 'text' in updates) {
							return { ...c, text: updates.text as string };
						}
						if (c.type === 'tool' && 'state' in updates) {
							return { ...c, state: updates.state as 'pending' | 'running' | 'completed' };
						}
						return c;
					});
					newHistory[i] = {
						role: 'assistant',
						content: { type: 'chunks', chunks: updatedChunks }
					};
					break;
				}
			}
			return newHistory;
		});
	};

	const markLastAssistantMessageCanceled = () => {
		setMessages((prev) => {
			const newHistory = [...prev];
			for (let i = newHistory.length - 1; i >= 0; i--) {
				const msg = newHistory[i];
				if (msg?.role === 'assistant') {
					newHistory[i] = { ...msg, canceled: true };
					break;
				}
			}
			return newHistory;
		});
	};

	const handleChunkUpdate = (update: ChunkUpdate) => {
		if (update.type === 'add') {
			addChunkToLastAssistant(update.chunk);
		} else {
			updateChunkInLastAssistant(update.id, update.chunk);
		}
	};

	/**
	 * Convert local TUI messages to ThreadMessage format for history building.
	 * The TUI uses InputState for user messages, which needs to be flattened to string.
	 */
	const convertToThreadMessages = (): ThreadMessage[] => {
		return messages()
			.filter(
				(m): m is Exclude<Message, { role: 'system' }> =>
					m.role === 'user' || m.role === 'assistant'
			)
			.map((m): ThreadMessage => {
				if (m.role === 'user') {
					// Flatten InputState segments to plain string
					return {
						role: 'user',
						content: m.content.map((s) => s.content).join('')
					};
				}
				// Assistant messages - content is already compatible with ThreadMessage
				return {
					role: 'assistant',
					content: m.content,
					canceled: m.canceled
				};
			});
	};

	// Main send method
	const send = async (input: InputState, newResources: string[]) => {
		// Keep @mentions in the question - they provide context about what the user is asking about
		const question = input
			.map((s) => s.content)
			.join('')
			.trim()
			.replace(/\s+/g, ' ');

		// Accumulate new resources into thread resources
		const currentResources = threadResources();
		const updatedResources = [...new Set([...currentResources, ...newResources])];
		setThreadResources(updatedResources);

		// Convert messages to thread format for history building (before adding new message)
		const threadMessages = convertToThreadMessages();

		// Add user message
		addMessage({ role: 'user', content: input });

		// Add placeholder assistant message
		addMessage({ role: 'assistant', content: { type: 'chunks', chunks: [] } });

		setIsStreaming(true);
		setCancelState('none');

		// Build the full question with history using shared formatting
		const questionWithHistory = formatConversationHistory(threadMessages, question);

		try {
			const finalChunks = await services.askQuestion(
				updatedResources,
				questionWithHistory,
				handleChunkUpdate
			);

			// Check if canceled during streaming
			if (cancelState() === 'pending') return;

			const textChunks = finalChunks.filter((c) => c.type === 'text');
			const fullResponse = textChunks.map((c) => c.text).join('\n\n');

			if (fullResponse) {
				await copyToClipboard(fullResponse);
				addMessage({ role: 'system', content: 'Answer copied to clipboard!' });
			}
		} catch (error) {
			if (cancelState() !== 'pending') {
				addMessage({ role: 'system', content: `Error: ${error}` });
			}
		} finally {
			setIsStreaming(false);
			setCancelState('none');
		}
	};

	const requestCancel = () => {
		if (cancelState() === 'none') {
			setCancelState('pending');
		}
	};

	const confirmCancel = async () => {
		await services.cancelCurrentRequest();
		markLastAssistantMessageCanceled();
		addMessage({ role: 'system', content: 'Request canceled.' });
		setIsStreaming(false);
		setCancelState('none');
	};

	const clearMessages = () => {
		setMessages(defaultMessageHistory);
		setThreadResources([]);
	};

	const state: MessagesState = {
		messages,
		addSystemMessage: (content) => addMessage({ role: 'system', content }),
		clearMessages,
		threadResources,
		isStreaming,
		cancelState,
		send,
		requestCancel,
		confirmCancel
	};

	return <MessagesContext.Provider value={state}>{props.children}</MessagesContext.Provider>;
};
