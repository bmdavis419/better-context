import {
	createContext,
	createSignal,
	useContext,
	type Accessor,
	type Component,
	type ParentProps
} from 'solid-js';
import type { Message, InputState, ThreadState, ThreadQuestion, CancelState } from '../types.ts';
import type { BtcaChunk } from '../../core/index.ts';
import { services } from '../services.ts';
import { generateId } from '../../core/thread/types.ts';
import { copyToClipboard } from '../clipboard.ts';

type MessagesState = {
	// Message history
	messages: Accessor<Message[]>;
	addSystemMessage: (content: string) => void;
	clearMessages: () => void;

	// Thread state
	currentThread: Accessor<ThreadState | null>;

	// Streaming state
	isStreaming: Accessor<boolean>;
	cancelState: Accessor<CancelState>;

	// Actions
	send: (input: InputState, newResources: string[], allResources: string[]) => Promise<void>;
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
	const [currentThread, setCurrentThread] = createSignal<ThreadState | null>(null);
	const [lastQuestionId, setLastQuestionId] = createSignal<string | null>(null);
	const [isStreaming, setIsStreaming] = createSignal(false);
	const [cancelState, setCancelState] = createSignal<CancelState>('none');

	// Internal helpers for message updates
	const addMessage = (message: Message) => setMessages((prev) => [...prev, message]);

	const addChunkToLastAssistant = (chunk: BtcaChunk) => {
		setMessages((prev) => {
			const newHistory = [...prev];
			for (let i = newHistory.length - 1; i >= 0; i--) {
				const msg = newHistory[i];
				if (msg?.role === 'assistant' && msg.content.type === 'chunks') {
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
				if (msg?.role === 'assistant' && msg.content.type === 'chunks') {
					const updatedChunks = msg.content.chunks.map((c): BtcaChunk => {
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

	// Thread management
	const initializeThread = async () => {
		if (currentThread()) return;
		const threadId = await services.createThread();
		setCurrentThread({ id: threadId, resources: [], questions: [] });
	};

	const addResourcesToThread = (resources: string[]) => {
		const thread = currentThread();
		if (!thread) return;
		const newResources = [...new Set([...thread.resources, ...resources])].sort();
		setCurrentThread({ ...thread, resources: newResources });
	};

	const addQuestionToThread = (question: Omit<ThreadQuestion, 'id'>): ThreadQuestion => {
		const thread = currentThread();
		if (!thread) throw new Error('No thread initialized');

		const id = generateId();
		const newQuestion: ThreadQuestion = { ...question, id };

		setCurrentThread({
			...thread,
			questions: [...thread.questions, newQuestion]
		});

		return newQuestion;
	};

	// Main send method
	const send = async (input: InputState, newResources: string[], allResources: string[]) => {
		const question = input
			.map((s) => s.content)
			.join('')
			.replace(/@\w+/g, '')
			.trim()
			.replace(/\s+/g, ' ');

		// Initialize thread if needed
		if (!currentThread()) {
			await initializeThread();
		}

		// Add resources to thread
		if (newResources.length > 0) {
			addResourcesToThread(newResources);
		}

		const thread = currentThread()!;
		const threadContext = services.buildThreadContext(thread.questions);

		// Add user message
		addMessage({ role: 'user', content: input });

		// Add placeholder assistant message
		addMessage({ role: 'assistant', content: { type: 'chunks', chunks: [] } });

		setIsStreaming(true);
		setCancelState('none');

		// Add question to in-memory thread
		addQuestionToThread({
			prompt: question,
			answer: '',
			resources: newResources,
			status: 'completed'
		});

		// Persist question to database
		const questionId = await services.persistQuestion(thread.id, {
			resources: newResources,
			prompt: question,
			answer: '',
			status: 'completed'
		});
		setLastQuestionId(questionId);

		try {
			const finalChunks = await services.askQuestion(
				allResources,
				question,
				(update) => {
					if (update.type === 'add') {
						addChunkToLastAssistant(update.chunk);
					} else {
						updateChunkInLastAssistant(update.id, update.chunk);
					}
				},
				threadContext
			);

			// Check if canceled during streaming
			if (cancelState() === 'pending') return;

			const textChunks = finalChunks.filter((c) => c.type === 'text');
			const fullResponse = textChunks.map((c) => c.text).join('\n\n');

			// Update question in database
			await services.updateQuestionAnswer(questionId, fullResponse);

			// Update in-memory thread
			setCurrentThread((prev) => {
				if (!prev) return prev;
				const updatedQuestions = prev.questions.map((q, i) =>
					i === prev.questions.length - 1 ? { ...q, answer: fullResponse } : q
				);
				return { ...prev, questions: updatedQuestions };
			});

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
		const qId = lastQuestionId();
		if (qId) {
			await services.updateQuestionStatus(qId, 'canceled');
		}

		// Update in-memory thread
		setCurrentThread((prev) => {
			if (!prev) return prev;
			const updatedQuestions = prev.questions.map((q, i) =>
				i === prev.questions.length - 1 ? { ...q, status: 'canceled' as const } : q
			);
			return { ...prev, questions: updatedQuestions };
		});

		markLastAssistantMessageCanceled();
		addMessage({ role: 'system', content: 'Request canceled.' });
		setIsStreaming(false);
		setCancelState('none');
	};

	const state: MessagesState = {
		messages,
		addSystemMessage: (content) => addMessage({ role: 'system', content }),
		clearMessages: () => setMessages(defaultMessageHistory),
		currentThread,
		isStreaming,
		cancelState,
		send,
		requestCancel,
		confirmCancel
	};

	return <MessagesContext.Provider value={state}>{props.children}</MessagesContext.Provider>;
};
