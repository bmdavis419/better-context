import {
	For,
	Index,
	Show,
	Switch,
	Match,
	createMemo,
	createSignal,
	onCleanup,
	type Accessor,
	type Component
} from 'solid-js';
import { useMessagesContext } from '../context/messages-context.tsx';
import { colors, getColor } from '../theme.ts';
import { MarkdownText } from './markdown-text.tsx';
import type { BtcaChunk, AssistantContent, Message } from '../types.ts';

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Strip conversation history markers from displayed text.
 * This is a fallback safety net - the server should strip these before sending.
 * Handles cases where the AI echoes back parts of the formatted prompt.
 */
const stripHistoryTags = (text: string): string => {
	return (
		text
			// Full history blocks
			.replace(/<conversation_history>[\s\S]*?<\/conversation_history>\s*/g, '')
			// Current message wrapper
			.replace(/<current_message>[\s\S]*?<\/current_message>\s*/g, '')
			// Orphaned/partial tags
			.replace(/<\/?conversation_history>\s*/g, '')
			.replace(/<\/?current_message>\s*/g, '')
			.replace(/<\/?human>\s*/g, '')
			.replace(/<\/?assistant>\s*/g, '')
			// Old format markers (legacy)
			.replace(/=== CONVERSATION HISTORY ===[\s\S]*?=== END HISTORY ===/g, '')
			.replace(/^Current question:\s*/i, '')
			.trim()
	);
};

const LoadingSpinner: Component = () => {
	const [frameIndex, setFrameIndex] = createSignal(0);

	const interval = setInterval(() => {
		setFrameIndex((prev) => (prev + 1) % spinnerFrames.length);
	}, 80);

	onCleanup(() => clearInterval(interval));

	return <text fg={colors.success}>{spinnerFrames[frameIndex()]} </text>;
};

const summarizeTools = (chunks: BtcaChunk[]) => {
	const counts = new Map<string, number>();
	const order: string[] = [];

	for (const chunk of chunks) {
		if (chunk.type !== 'tool') continue;
		const name = chunk.toolName;
		if (!counts.has(name)) {
			counts.set(name, 0);
			order.push(name);
		}
		counts.set(name, (counts.get(name) ?? 0) + 1);
	}

	return order.map((name) => ({ name, count: counts.get(name) ?? 0 }));
};

const ToolSummary: Component<{ chunks: Extract<BtcaChunk, { type: 'tool' }>[] }> = (props) => {
	const items = () => summarizeTools(props.chunks);
	const summaryText = () =>
		items()
			.map((item) => `${item.name} ×${item.count}`)
			.join(' | ');

	return (
		<Show when={items().length > 0}>
			<box style={{ flexDirection: 'row', gap: 1 }}>
				<text fg={colors.textMuted}>Tools</text>
				<text fg={colors.textMuted}>{summaryText()}</text>
			</box>
		</Show>
	);
};

const FileChunk: Component<{ chunk: Extract<BtcaChunk, { type: 'file' }> }> = (props) => {
	return (
		<box style={{ flexDirection: 'row', gap: 1 }}>
			<text fg={colors.info}>📄</text>
			<text fg={colors.textMuted}>{props.chunk.filePath}</text>
		</box>
	);
};

const ReasoningChunk: Component<{
	chunk: Extract<BtcaChunk, { type: 'reasoning' }>;
	isStreaming: boolean;
}> = (props) => {
	return (
		<box style={{ flexDirection: 'column', gap: 0 }}>
			<box style={{ flexDirection: 'row', gap: 1 }}>
				<text fg={colors.textSubtle}>💭 thinking</text>
				<Show when={props.isStreaming}>
					<LoadingSpinner />
				</Show>
			</box>
			<text fg={colors.textSubtle}>{props.chunk.text}</text>
		</box>
	);
};

const TextChunk: Component<{
	chunk: Extract<BtcaChunk, { type: 'text' }>;
	isStreaming: boolean;
}> = (props) => {
	const displayText = () => stripHistoryTags(props.chunk.text);

	return <MarkdownText content={displayText()} streaming={props.isStreaming} />;
};

const ChunkRenderer: Component<{ chunk: BtcaChunk; isStreaming: boolean }> = (props) => {
	return (
		<Switch>
			<Match when={props.chunk.type === 'tool'}>
				<ToolSummary chunks={[props.chunk as Extract<BtcaChunk, { type: 'tool' }>]} />
			</Match>
			<Match when={props.chunk.type === 'file'}>
				<FileChunk chunk={props.chunk as Extract<BtcaChunk, { type: 'file' }>} />
			</Match>
			<Match when={props.chunk.type === 'reasoning'}>
				<ReasoningChunk
					chunk={props.chunk as Extract<BtcaChunk, { type: 'reasoning' }>}
					isStreaming={props.isStreaming}
				/>
			</Match>
			<Match when={props.chunk.type === 'text'}>
				<TextChunk
					chunk={props.chunk as Extract<BtcaChunk, { type: 'text' }>}
					isStreaming={props.isStreaming}
				/>
			</Match>
		</Switch>
	);
};

/**
 * Renders chunks in display order: reasoning, tools, text
 * This ensures consistent UX regardless of stream arrival order
 */
const ChunksRenderer: Component<{
	chunks: BtcaChunk[];
	isStreaming: boolean;
	isCanceled?: boolean;
	textColor?: string;
}> = (props) => {
	const groups = createMemo(() => {
		const reasoning: BtcaChunk[] = [];
		const tools: Extract<BtcaChunk, { type: 'tool' }>[] = [];
		const text: BtcaChunk[] = [];
		const other: BtcaChunk[] = [];

		for (const chunk of props.chunks) {
			switch (chunk.type) {
				case 'reasoning':
					reasoning.push(chunk);
					break;
				case 'tool':
					tools.push(chunk);
					break;
				case 'text':
					text.push(chunk);
					break;
				default:
					other.push(chunk);
			}
		}

		return { reasoning, tools, text, other };
	});

	const lastChunkId = createMemo(() => {
		const g = groups();
		const last = g.other.at(-1) ?? g.text.at(-1) ?? g.reasoning.at(-1);
		return last?.id ?? null;
	});

	const isStreamingChunk = (chunk: BtcaChunk) => props.isStreaming && chunk.id === lastChunkId();

	const renderChunk = (chunk: Accessor<BtcaChunk>) => (
		<Show
			when={props.isCanceled && chunk().type === 'text'}
			fallback={<ChunkRenderer chunk={chunk()} isStreaming={isStreamingChunk(chunk())} />}
		>
			<text fg={props.textColor}>
				{stripHistoryTags(
					chunk().type === 'text' ? (chunk() as Extract<BtcaChunk, { type: 'text' }>).text : ''
				)}
			</text>
		</Show>
	);

	return (
		<box style={{ flexDirection: 'column', gap: 1 }}>
			<Index each={groups().reasoning}>{(chunk) => renderChunk(chunk)}</Index>
			<Show when={groups().tools.length > 0}>
				<ToolSummary chunks={groups().tools} />
			</Show>
			<Index each={groups().text}>{(chunk) => renderChunk(chunk)}</Index>
			<Index each={groups().other}>{(chunk) => renderChunk(chunk)}</Index>
		</box>
	);
};

const AssistantMessage: Component<{
	content: AssistantContent;
	isStreaming: boolean;
	isCanceled?: boolean;
}> = (props) => {
	const textColor = () => (props.isCanceled ? colors.textMuted : undefined);
	const getTextContent = () =>
		stripHistoryTags((props.content as { type: 'text'; content: string }).content);

	// Type guards for AssistantContent which can be string | { type: 'text' } | { type: 'chunks' }
	const isTextContent = () => typeof props.content === 'object' && props.content.type === 'text';
	const isChunksContent = () =>
		typeof props.content === 'object' && props.content.type === 'chunks';
	const isStringContent = () => typeof props.content === 'string';

	return (
		<Switch>
			<Match when={isStringContent()}>
				<Show
					when={props.isCanceled}
					fallback={
						<MarkdownText content={props.content as string} streaming={props.isStreaming} />
					}
				>
					<text fg={textColor()}>{props.content as string}</text>
				</Show>
			</Match>
			<Match when={isTextContent()}>
				<Show
					when={props.isCanceled}
					fallback={<MarkdownText content={getTextContent()} streaming={props.isStreaming} />}
				>
					<text fg={textColor()}>{getTextContent()}</text>
				</Show>
			</Match>
			<Match when={isChunksContent()}>
				<ChunksRenderer
					chunks={(props.content as { type: 'chunks'; chunks: BtcaChunk[] }).chunks}
					isStreaming={props.isStreaming}
					isCanceled={props.isCanceled}
					textColor={textColor()}
				/>
			</Match>
		</Switch>
	);
};

export const Messages: Component = () => {
	const messagesState = useMessagesContext();

	return (
		<box style={{ flexGrow: 1, position: 'relative' }}>
			<scrollbox
				style={{
					flexGrow: 1,
					rootOptions: {
						border: true,
						borderColor: colors.border
					},
					contentOptions: {
						flexDirection: 'column',
						padding: 1,
						gap: 2
					},
					stickyScroll: true,
					stickyStart: 'bottom'
				}}
			>
				<Index each={messagesState.messages()}>
					{(m, index) => {
						const role = m().role;

						if (role === 'user') {
							const user = () => m() as Extract<Message, { role: 'user' }>;
							return (
								<box style={{ flexDirection: 'column', gap: 1 }}>
									<text fg={colors.accent}>You </text>
									<text>
										<For each={user().content}>
											{(part) => <span style={{ fg: getColor(part.type) }}>{part.content}</span>}
										</For>
									</text>
								</box>
							);
						}
						if (role === 'system') {
							const sys = () => m() as Extract<Message, { role: 'system' }>;
							return (
								<box style={{ flexDirection: 'column', gap: 1 }}>
									<text fg={colors.info}>SYS </text>
									<text fg={colors.text} content={`${sys().content}`} />
								</box>
							);
						}
						if (role === 'assistant') {
							const assistant = () => m() as Extract<Message, { role: 'assistant' }>;
							const isLastAssistant = () => {
								const history = messagesState.messages();
								for (let i = history.length - 1; i >= 0; i--) {
									if (history[i]?.role === 'assistant') {
										return i === index;
									}
								}
								return false;
							};
							const isStreaming = () => messagesState.isStreaming() && isLastAssistant();
							const isCanceled = () => assistant().canceled === true;

							return (
								<box style={{ flexDirection: 'column', gap: 1 }}>
									<box style={{ flexDirection: 'row' }}>
										<text fg={isCanceled() ? colors.textMuted : colors.success}>
											{isCanceled() ? 'AI [canceled] ' : 'AI '}
										</text>
										<Show when={isStreaming()}>
											<LoadingSpinner />
										</Show>
									</box>
									<AssistantMessage
										content={assistant().content}
										isStreaming={isStreaming()}
										isCanceled={isCanceled()}
									/>
								</box>
							);
						}
					}}
				</Index>
			</scrollbox>
		</box>
	);
};
