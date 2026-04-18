import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode
} from 'react';
import { formatConversationHistory, type ThreadMessage } from '@btca/shared';
import { Effect } from 'effect';

import type { BtcaChunk, CancelState, InputState, Message } from '../types.ts';
import { services, type ChunkUpdate } from '../services.ts';
import { runCliEffect } from '../../effect/runtime.ts';
import { copyToClipboard } from '../clipboard.ts';
import { formatError } from '../lib/format-error.ts';
import {
	createThread,
	loadThread,
	saveThread,
	type LocalThread,
	type LocalThreadMessage
} from '../thread-store.ts';

const formatUsd = (value: number) => {
	const abs = Math.abs(value);
	const decimals = abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
	const fixed = value.toFixed(decimals);
	return `$${fixed.replace(/\.?0+$/, '')}`;
};

const formatStreamStats = (done: {
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		reasoningTokens?: number;
		totalTokens?: number;
	};
	metrics?: {
		timing?: { totalMs?: number; genMs?: number };
		throughput?: { outputTokensPerSecond?: number; totalTokensPerSecond?: number };
		pricing?: {
			source: 'models.dev';
			modelKey?: string;
			ratesUsdPerMTokens?: { input?: number; output?: number; reasoning?: number };
			costUsd?: { input?: number; output?: number; reasoning?: number; total?: number };
		};
	};
}) => {
	const parts: string[] = [];

	const pricing = done.metrics?.pricing;
	const costUsd =
		pricing?.costUsd?.total ??
		(() => {
			const pieces = pricing?.costUsd;
			if (!pieces) return undefined;
			const input = pieces.input ?? 0;
			const output = pieces.output ?? 0;
			const reasoning = pieces.reasoning ?? 0;
			const hasAny = pieces.input != null || pieces.output != null || pieces.reasoning != null;
			return hasAny ? input + output + reasoning : undefined;
		})();

	const inTok = done.usage?.inputTokens;
	const outTok = done.usage?.outputTokens;
	const rTok = done.usage?.reasoningTokens;
	const totalTok = done.usage?.totalTokens;
	if (inTok != null || outTok != null || rTok != null || totalTok != null) {
		parts.push(
			[
				`tokens in ${inTok?.toLocaleString() ?? '?'}`,
				`out ${outTok?.toLocaleString() ?? '?'}`,
				`reasoning ${rTok?.toLocaleString() ?? '?'}`,
				`tokens total ${totalTok?.toLocaleString() ?? '?'}`,
				costUsd == null ? undefined : `cost ${formatUsd(costUsd)}`
			]
				.filter(Boolean)
				.join(' | ')
		);
	} else if (costUsd != null) {
		parts.push(`cost ${formatUsd(costUsd)}`);
	}

	const genMs = done.metrics?.timing?.genMs;
	const totalMs = done.metrics?.timing?.totalMs;
	if (genMs != null || totalMs != null) {
		const genS = genMs == null ? '?' : (genMs / 1000).toFixed(2);
		const totalS = totalMs == null ? '?' : (totalMs / 1000).toFixed(2);
		parts.push(`time gen ${genS}s | time total ${totalS}s`);
	}

	const outTps = done.metrics?.throughput?.outputTokensPerSecond;
	if (outTps != null) {
		parts.push(`tps ${outTps.toFixed(1)}`);
	}

	return parts.length > 0 ? `Generation stats: ${parts.join(' || ')}` : null;
};

type MessagesState = {
	messages: Message[];
	addSystemMessage: (content: string) => void;
	clearMessages: () => void;
	copyLastMessage: () => Promise<void>;
	copyAllMessages: () => Promise<void>;

	threadResources: string[];

	isStreaming: boolean;
	cancelState: CancelState;

	send: (input: InputState, newResources: string[]) => Promise<void>;
	requestCancel: () => void;
	confirmCancel: () => Promise<void>;
	resumeThread: (threadId: string) => Promise<void>;
};

const MessagesContext = createContext<MessagesState | null>(null);

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

const toStoredMessages = (items: Message[]): LocalThreadMessage[] => {
	const now = Date.now();
	return items.map((message) => {
		if (message.role === 'user') {
			return {
				role: 'user',
				content: message.content.map((s) => s.content).join(''),
				createdAt: now
			};
		}
		if (message.role === 'assistant') {
			return {
				role: 'assistant',
				content: message.content,
				canceled: message.canceled,
				createdAt: now
			};
		}
		return {
			role: 'system',
			content: message.content,
			createdAt: now
		};
	});
};

const toUiMessages = (items: LocalThreadMessage[]): Message[] =>
	items.map((message) => {
		if (message.role === 'user') {
			return {
				role: 'user',
				content: [{ type: 'text', content: String(message.content) }]
			};
		}
		if (message.role === 'assistant') {
			return {
				role: 'assistant',
				content: message.content,
				canceled: message.canceled
			};
		}
		return { role: 'system', content: message.content };
	});

const getUserMessageText = (message: Extract<Message, { role: 'user' }>) =>
	message.content.map((segment) => segment.content).join('');

const getAssistantMessageText = (message: Extract<Message, { role: 'assistant' }>) => {
	const content = message.content;
	if (typeof content === 'string') return content;
	if (content.type === 'text') return content.content;
	if (content.type === 'chunks') {
		return content.chunks
			.filter((chunk): chunk is Extract<BtcaChunk, { type: 'text' }> => chunk.type === 'text')
			.map((chunk) => chunk.text)
			.join('\n\n');
	}
	return '';
};

export const MessagesProvider = (props: { children: ReactNode }) => {
	const initialThread = useMemo(() => createThread(), []);

	const [messages, setMessages] = useState<Message[]>(defaultMessageHistory);
	const [threadResources, setThreadResources] = useState<string[]>([]);
	const [isStreaming, setIsStreaming] = useState(false);
	const [cancelState, setCancelState] = useState<CancelState>('none');
	const [threadId, setThreadId] = useState<string>(initialThread.id);
	const [threadCreatedAt, setThreadCreatedAt] = useState(initialThread.createdAt);

	const messagesRef = useRef(messages);
	const resourcesRef = useRef(threadResources);
	const cancelStateRef = useRef(cancelState);
	const threadIdRef = useRef(threadId);
	const threadCreatedAtRef = useRef(threadCreatedAt);
	const hasAskedQuestionRef = useRef(false);

	useEffect(() => {
		messagesRef.current = messages;
	}, [messages]);
	useEffect(() => {
		resourcesRef.current = threadResources;
	}, [threadResources]);
	useEffect(() => {
		cancelStateRef.current = cancelState;
	}, [cancelState]);
	useEffect(() => {
		threadIdRef.current = threadId;
	}, [threadId]);
	useEffect(() => {
		threadCreatedAtRef.current = threadCreatedAt;
	}, [threadCreatedAt]);

	const addMessage = useCallback(
		(message: Message) => setMessages((prev) => [...prev, message]),
		[]
	);

	const addChunkToLastAssistant = useCallback((chunk: BtcaChunk) => {
		setMessages((prev) => {
			const next = [...prev];
			for (let i = next.length - 1; i >= 0; i--) {
				const msg = next[i];
				if (
					msg?.role === 'assistant' &&
					typeof msg.content === 'object' &&
					msg.content.type === 'chunks'
				) {
					next[i] = {
						role: 'assistant',
						content: { type: 'chunks', chunks: [...msg.content.chunks, chunk] }
					};
					break;
				}
			}
			return next;
		});
	}, []);

	const updateChunkInLastAssistant = useCallback((id: string, updates: Partial<BtcaChunk>) => {
		setMessages((prev) => {
			const next = [...prev];
			for (let i = next.length - 1; i >= 0; i--) {
				const msg = next[i];
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
					next[i] = {
						role: 'assistant',
						content: { type: 'chunks', chunks: updatedChunks }
					};
					break;
				}
			}
			return next;
		});
	}, []);

	const markLastAssistantMessageCanceled = useCallback(() => {
		setMessages((prev) => {
			const next = [...prev];
			for (let i = next.length - 1; i >= 0; i--) {
				const msg = next[i];
				if (msg?.role === 'assistant') {
					next[i] = { ...msg, canceled: true };
					break;
				}
			}
			return next;
		});
	}, []);

	const buildThreadSnapshot = useCallback(
		(overrides?: Partial<LocalThread>): LocalThread => ({
			id: overrides?.id ?? threadIdRef.current,
			title: overrides?.title,
			createdAt: overrides?.createdAt ?? threadCreatedAtRef.current,
			lastActivityAt: overrides?.lastActivityAt ?? Date.now(),
			resources: overrides?.resources ?? resourcesRef.current,
			messages: overrides?.messages ?? toStoredMessages(messagesRef.current)
		}),
		[]
	);

	const persistCurrentThread = useCallback(async () => {
		if (!hasAskedQuestionRef.current) return;
		await saveThread(buildThreadSnapshot());
	}, [buildThreadSnapshot]);

	const startNewThread = useCallback(async () => {
		const next = createThread();
		setThreadId(next.id);
		setThreadCreatedAt(next.createdAt);
		setMessages(defaultMessageHistory);
		setThreadResources([]);
		hasAskedQuestionRef.current = false;
	}, []);

	const handleChunkUpdate = useCallback(
		(update: ChunkUpdate) => {
			if (update.type === 'add') {
				addChunkToLastAssistant(update.chunk);
			} else {
				updateChunkInLastAssistant(update.id, update.chunk);
			}
		},
		[addChunkToLastAssistant, updateChunkInLastAssistant]
	);

	const convertToThreadMessages = useCallback((): ThreadMessage[] => {
		return messagesRef.current
			.filter(
				(m): m is Exclude<Message, { role: 'system' }> =>
					m.role === 'user' || m.role === 'assistant'
			)
			.map((m): ThreadMessage => {
				if (m.role === 'user') {
					return { role: 'user', content: m.content.map((s) => s.content).join('') };
				}
				return { role: 'assistant', content: m.content, canceled: m.canceled };
			});
	}, []);

	const send = useCallback(
		async (input: InputState, newResources: string[]) => {
			// Keep @mentions in the question - they provide context about what the user is asking about
			const question = input
				.map((s) => s.content)
				.join('')
				.trim()
				.replace(/\s+/g, ' ');

			hasAskedQuestionRef.current = true;

			const updatedResources = [...new Set([...resourcesRef.current, ...newResources])];
			setThreadResources(updatedResources);

			const threadMessages = convertToThreadMessages();

			setMessages((prev) => [
				...prev,
				{ role: 'user', content: input } satisfies Message,
				{ role: 'assistant', content: { type: 'chunks', chunks: [] } } satisfies Message
			]);

			setIsStreaming(true);
			setCancelState('none');

			try {
				const questionWithHistory = formatConversationHistory(threadMessages, question);
				const response = await runCliEffect(
					Effect.tryPromise(() =>
						services.askQuestion(updatedResources, questionWithHistory, handleChunkUpdate)
					)
				);

				if (cancelStateRef.current !== 'pending') {
					if (response.doneEvent) {
						const stats = formatStreamStats(response.doneEvent);
						if (stats) addMessage({ role: 'system', content: stats });
					}

					addMessage({ role: 'system', content: 'run /copy to copy message to clipboard' });
				}
			} catch (error) {
				if (cancelStateRef.current !== 'pending') {
					addMessage({ role: 'system', content: `Error: ${formatError(error)}` });
				}
			}

			setIsStreaming(false);
			setCancelState('none');

			try {
				await runCliEffect(Effect.tryPromise(persistCurrentThread));
			} catch (error) {
				addMessage({ role: 'system', content: `Error: ${formatError(error)}` });
			}
		},
		[addMessage, convertToThreadMessages, handleChunkUpdate, persistCurrentThread]
	);

	const requestCancel = useCallback(() => {
		setCancelState((prev) => (prev === 'none' ? 'pending' : prev));
	}, []);

	const confirmCancel = useCallback(async () => {
		await services.cancelCurrentRequest();
		markLastAssistantMessageCanceled();
		addMessage({ role: 'system', content: 'Request canceled.' });
		setIsStreaming(false);
		setCancelState('none');

		try {
			await runCliEffect(Effect.tryPromise(persistCurrentThread));
		} catch (error) {
			addMessage({ role: 'system', content: `Error: ${formatError(error)}` });
		}
	}, [addMessage, markLastAssistantMessageCanceled, persistCurrentThread]);

	const clearMessages = useCallback(() => {
		void (async () => {
			try {
				await runCliEffect(Effect.tryPromise(persistCurrentThread));
			} catch (error) {
				addMessage({ role: 'system', content: `Error: ${formatError(error)}` });
				return;
			}
			try {
				await runCliEffect(Effect.tryPromise(startNewThread));
			} catch (error) {
				addMessage({ role: 'system', content: `Error: ${formatError(error)}` });
			}
		})();
	}, [addMessage, persistCurrentThread, startNewThread]);

	const copyLastMessage = useCallback(async () => {
		const assistantMessage = [...messagesRef.current]
			.reverse()
			.find((message) => message.role === 'assistant');
		if (!assistantMessage || assistantMessage.role !== 'assistant') {
			addMessage({ role: 'system', content: 'No assistant response found to copy.' });
			return;
		}

		const assistantIndex = messagesRef.current.lastIndexOf(assistantMessage);
		const userMessage = messagesRef.current
			.slice(0, assistantIndex)
			.reverse()
			.find((message) => message.role === 'user');
		if (!userMessage || userMessage.role !== 'user') {
			addMessage({ role: 'system', content: 'No user question found for the latest response.' });
			return;
		}

		const payload = [
			'User:',
			getUserMessageText(userMessage),
			'',
			'Assistant:',
			getAssistantMessageText(assistantMessage)
		].join('\n');
		try {
			await runCliEffect(
				Effect.tryPromise({
					try: () => copyToClipboard(payload),
					catch: (error) => (error instanceof Error ? error : new Error(String(error)))
				})
			);
		} catch (error) {
			addMessage({ role: 'system', content: `Error: ${formatError(error)}` });
			return;
		}

		addMessage({ role: 'system', content: 'Copied latest exchange to clipboard.' });
	}, [addMessage]);

	const copyAllMessages = useCallback(async () => {
		const parts = messagesRef.current.flatMap((message) => {
			if (message.role === 'user') return [`User:\n${getUserMessageText(message)}`];
			if (message.role === 'assistant') return [`Assistant:\n${getAssistantMessageText(message)}`];
			return [];
		});
		if (parts.length === 0) {
			addMessage({ role: 'system', content: 'No thread messages found to copy.' });
			return;
		}

		try {
			await runCliEffect(
				Effect.tryPromise({
					try: () => copyToClipboard(parts.join('\n\n')),
					catch: (error) => (error instanceof Error ? error : new Error(String(error)))
				})
			);
		} catch (error) {
			addMessage({ role: 'system', content: `Error: ${formatError(error)}` });
			return;
		}

		addMessage({ role: 'system', content: 'Copied full thread to clipboard.' });
	}, [addMessage]);

	const resumeThread = useCallback(
		async (nextThreadId: string) => {
			if (nextThreadId === threadIdRef.current) return;

			try {
				await runCliEffect(Effect.tryPromise(persistCurrentThread));
			} catch (error) {
				addMessage({ role: 'system', content: `Error: ${formatError(error)}` });
				return;
			}

			let thread: Awaited<ReturnType<typeof loadThread>>;
			try {
				thread = await runCliEffect(Effect.tryPromise(() => loadThread(nextThreadId)));
			} catch (error) {
				addMessage({ role: 'system', content: `Error: ${formatError(error)}` });
				return;
			}

			if (!thread) {
				addMessage({ role: 'system', content: 'Thread not found.' });
				return;
			}

			hasAskedQuestionRef.current = thread.messages.some((m) => m.role === 'user');
			setThreadId(thread.id);
			setThreadCreatedAt(thread.createdAt);
			setMessages(toUiMessages(thread.messages));
			setThreadResources(thread.resources);
		},
		[addMessage, persistCurrentThread]
	);

	useEffect(() => {
		void runCliEffect(Effect.tryPromise(persistCurrentThread)).catch(() => undefined);
	}, [persistCurrentThread]);

	const state = useMemo<MessagesState>(
		() => ({
			messages,
			addSystemMessage: (content) => addMessage({ role: 'system', content }),
			clearMessages,
			copyLastMessage,
			copyAllMessages,
			threadResources,
			isStreaming,
			cancelState,
			send,
			requestCancel,
			confirmCancel,
			resumeThread
		}),
		[
			messages,
			addMessage,
			clearMessages,
			copyLastMessage,
			copyAllMessages,
			threadResources,
			isStreaming,
			cancelState,
			send,
			requestCancel,
			confirmCancel,
			resumeThread
		]
	);

	return <MessagesContext.Provider value={state}>{props.children}</MessagesContext.Provider>;
};
