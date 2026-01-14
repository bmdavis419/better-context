import { For, Show, Switch, Match, createSignal, onCleanup, type Component } from 'solid-js';
import { useMessagesContext } from '../context/messages-context.tsx';
import { colors, getColor } from '../theme.ts';
import { MarkdownText } from './markdown-text.tsx';
import type { BtcaChunk } from '../types.ts';
import type { AssistantContent } from '../types.ts';

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

const ToolChunk: Component<{ chunk: Extract<BtcaChunk, { type: 'tool' }> }> = (props) => {
	const stateIcon = () => {
		switch (props.chunk.state) {
			case 'pending':
				return '○';
			case 'running':
				return '◐';
			case 'completed':
				return '●';
		}
	};

	const stateColor = () => {
		switch (props.chunk.state) {
			case 'pending':
				return colors.textMuted;
			case 'running':
				return colors.accent;
			case 'completed':
				return colors.success;
		}
	};

	return (
		<box style={{ flexDirection: 'row', gap: 1 }}>
			<text fg={stateColor()}>{stateIcon()}</text>
			<text fg={colors.textMuted}>{props.chunk.toolName}</text>
		</box>
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

	return (
		<Show when={!props.isStreaming} fallback={<text>{displayText()}</text>}>
			<MarkdownText content={displayText()} />
		</Show>
	);
};

const ChunkRenderer: Component<{ chunk: BtcaChunk; isStreaming: boolean }> = (props) => {
	return (
		<Switch>
			<Match when={props.chunk.type === 'tool'}>
				<ToolChunk chunk={props.chunk as Extract<BtcaChunk, { type: 'tool' }>} />
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
	// Sort chunks into display order: reasoning first, then tools, then text
	const sortedChunks = () => {
		const reasoning: BtcaChunk[] = [];
		const tools: BtcaChunk[] = [];
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

		return [...reasoning, ...tools, ...text, ...other];
	};

	const isLastChunk = (idx: number) => idx === sortedChunks().length - 1;

	return (
		<box style={{ flexDirection: 'column', gap: 1 }}>
			<For each={sortedChunks()}>
				{(chunk, idx) => (
					<Show
						when={props.isCanceled && chunk.type === 'text'}
						fallback={
							<ChunkRenderer chunk={chunk} isStreaming={props.isStreaming && isLastChunk(idx())} />
						}
					>
						<text fg={props.textColor}>{stripHistoryTags((chunk as { text: string }).text)}</text>
					</Show>
				)}
			</For>
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
					when={!props.isStreaming}
					fallback={<text fg={textColor()}>{props.content as string}</text>}
				>
					<Show
						when={props.isCanceled}
						fallback={<MarkdownText content={props.content as string} />}
					>
						<text fg={textColor()}>{props.content as string}</text>
					</Show>
				</Show>
			</Match>
			<Match when={isTextContent()}>
				<Show when={!props.isStreaming} fallback={<text fg={textColor()}>{getTextContent()}</text>}>
					<Show when={props.isCanceled} fallback={<MarkdownText content={getTextContent()} />}>
						<text fg={textColor()}>{getTextContent()}</text>
					</Show>
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
				<For each={messagesState.messages()}>
					{(m, index) => {
						if (m.role === 'user') {
							return (
								<box style={{ flexDirection: 'column', gap: 1 }}>
									<text fg={colors.accent}>You </text>
									<text>
										<For each={m.content}>
											{(part) => <span style={{ fg: getColor(part.type) }}>{part.content}</span>}
										</For>
									</text>
								</box>
							);
						}
						if (m.role === 'system') {
							return (
								<box style={{ flexDirection: 'column', gap: 1 }}>
									<text fg={colors.info}>SYS </text>
									<text fg={colors.text} content={`${m.content}`} />
								</box>
							);
						}
						if (m.role === 'assistant') {
							const isLastAssistant = () => {
								const history = messagesState.messages();
								for (let i = history.length - 1; i >= 0; i--) {
									if (history[i]?.role === 'assistant') {
										return i === index();
									}
								}
								return false;
							};
							const isStreaming = () => messagesState.isStreaming() && isLastAssistant();
							const isCanceled = () => m.canceled === true;

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
										content={m.content}
										isStreaming={isStreaming()}
										isCanceled={isCanceled()}
									/>
								</box>
							);
						}
					}}
				</For>
			</scrollbox>
		</box>
	);
};
