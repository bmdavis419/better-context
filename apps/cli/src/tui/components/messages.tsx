import { useEffect, useMemo, useState } from 'react';

import { MarkdownText } from './markdown-text.tsx';
import { useMessagesContext } from '../context/messages-context.tsx';
import { useToast } from '../context/toast-context.tsx';
import { openBrowser } from '../lib/open-browser.ts';
import { colors, getColor } from '../theme.ts';
import type { AssistantContent, BtcaChunk } from '../types.ts';

const spinnerFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

const LoadingSpinner = () => {
	const [frameIndex, setFrameIndex] = useState(0);

	useEffect(() => {
		const interval = setInterval(() => {
			setFrameIndex((prev) => (prev + 1) % spinnerFrames.length);
		}, 80);
		return () => clearInterval(interval);
	}, []);

	return <text fg={colors.success}>{spinnerFrames[frameIndex]} </text>;
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

const ToolSummary = (props: { chunks: Extract<BtcaChunk, { type: 'tool' }>[] }) => {
	const items = summarizeTools(props.chunks);
	if (items.length === 0) return null;

	const summaryText = items.map((item) => `${item.name} ×${item.count}`).join(' | ');
	return (
		<box style={{ flexDirection: 'row', gap: 1 }}>
			<text fg={colors.textMuted}>Tools</text>
			<text fg={colors.textMuted}>{summaryText}</text>
		</box>
	);
};

const FileChunk = (props: { chunk: Extract<BtcaChunk, { type: 'file' }> }) => (
	<box style={{ flexDirection: 'row', gap: 1 }}>
		<text fg={colors.info}>📄</text>
		<text fg={colors.textMuted}>{props.chunk.filePath}</text>
	</box>
);

const ReasoningChunk = (props: {
	chunk: Extract<BtcaChunk, { type: 'reasoning' }>;
	isStreaming: boolean;
}) => (
	<box style={{ flexDirection: 'column', gap: 0 }}>
		<box style={{ flexDirection: 'row', gap: 1 }}>
			<text fg={colors.textSubtle}>💭 thinking</text>
			{props.isStreaming ? <LoadingSpinner /> : null}
		</box>
		<text fg={colors.textSubtle}>{props.chunk.text}</text>
	</box>
);

const TextChunk = (props: {
	chunk: Extract<BtcaChunk, { type: 'text' }>;
	isStreaming: boolean;
}) => {
	return <AssistantText content={props.chunk.text} streaming={props.isStreaming} />;
};

type ParsedSource = { label: string; url: string };

const parseSources = (content: string): { body: string; sources: ParsedSource[] } => {
	const lines = content.split('\n');
	const headingIndex = lines.findIndex((line) => line.trim().toLowerCase() === 'sources');
	if (headingIndex < 0) return { body: content, sources: [] };

	const body = lines.slice(0, headingIndex).join('\n').trimEnd();
	const sourceLines = lines.slice(headingIndex + 1);
	const sources: ParsedSource[] = [];

	for (const line of sourceLines) {
		const trimmed = line.trim();
		if (!trimmed.startsWith('-')) continue;
		const markdownMatch = trimmed.match(/^-\s*\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)\s*$/i);
		if (markdownMatch) {
			sources.push({ label: markdownMatch[1] ?? '', url: markdownMatch[2] ?? '' });
			continue;
		}

		const labelUrlMatch = trimmed.match(/^-\s*(.+?)\s+\((https?:\/\/[^\s)]+)\)\s*$/i);
		if (labelUrlMatch) {
			sources.push({ label: labelUrlMatch[1] ?? '', url: labelUrlMatch[2] ?? '' });
			continue;
		}

		const rawUrlMatch = trimmed.match(/^-\s*(https?:\/\/[^\s)]+)\s*$/i);
		if (rawUrlMatch) {
			const url = rawUrlMatch[1] ?? '';
			sources.push({ label: url, url });
		}
	}

	return { body, sources };
};

const SourceLinks = (props: { sources: ParsedSource[] }) => {
	const toast = useToast();
	if (props.sources.length === 0) return null;

	return (
		<box style={{ flexDirection: 'column', gap: 0 }}>
			<text fg={colors.info}>Sources</text>
			{props.sources.map((source, index) => (
				<box
					key={`${source.url}:${index}`}
					style={{ flexDirection: 'column' }}
					onMouseUp={() => {
						void openBrowser(source.url)
							.then(() => toast.show(`Opened: ${source.url}`))
							.catch(() => toast.show('Failed to open URL'));
					}}
				>
					<text fg={colors.info}>{`- ${source.label} (${source.url})`}</text>
				</box>
			))}
		</box>
	);
};

const AssistantText = (props: { content: string; streaming: boolean }) => {
	const parsed = useMemo(() => parseSources(props.content), [props.content]);
	if (parsed.sources.length === 0) {
		return <MarkdownText content={props.content} streaming={props.streaming} />;
	}

	return (
		<box style={{ flexDirection: 'column', gap: 1 }}>
			{parsed.body ? <MarkdownText content={parsed.body} streaming={props.streaming} /> : null}
			<SourceLinks sources={parsed.sources} />
		</box>
	);
};

const ChunkRenderer = (props: { chunk: BtcaChunk; isStreaming: boolean }) => {
	switch (props.chunk.type) {
		case 'tool':
			return <ToolSummary chunks={[props.chunk]} />;
		case 'file':
			return <FileChunk chunk={props.chunk} />;
		case 'reasoning':
			return <ReasoningChunk chunk={props.chunk} isStreaming={props.isStreaming} />;
		case 'text':
			return <TextChunk chunk={props.chunk} isStreaming={props.isStreaming} />;
		default:
			return null;
	}
};

type RenderItem =
	| { kind: 'chunk'; chunk: BtcaChunk }
	| { kind: 'tool-summary'; chunks: Extract<BtcaChunk, { type: 'tool' }>[] };

const ChunksRenderer = (props: {
	chunks: BtcaChunk[];
	isStreaming: boolean;
	isCanceled?: boolean;
	textColor?: string;
}) => {
	const items = useMemo(() => {
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

		const next: RenderItem[] = [];
		for (const chunk of reasoning) next.push({ kind: 'chunk', chunk });
		if (tools.length > 0) next.push({ kind: 'tool-summary', chunks: tools });
		for (const chunk of text) next.push({ kind: 'chunk', chunk });
		for (const chunk of other) next.push({ kind: 'chunk', chunk });
		return next;
	}, [props.chunks]);

	const lastChunkIndex = useMemo(() => {
		for (let i = items.length - 1; i >= 0; i -= 1) {
			if (items[i]?.kind === 'chunk') return i;
		}
		return -1;
	}, [items]);

	return (
		<box style={{ flexDirection: 'column', gap: 1 }}>
			{items.map((item, idx) => {
				if (item.kind === 'tool-summary') {
					const firstId = item.chunks[0]?.id ?? 'none';
					const lastId = item.chunks.at(-1)?.id ?? 'none';
					return (
						<ToolSummary
							key={`tool-summary:${firstId}:${lastId}:${item.chunks.length}`}
							chunks={item.chunks}
						/>
					);
				}

				const chunk = item.chunk;
				const isLastChunk = idx === lastChunkIndex;

				if (props.isCanceled && chunk.type === 'text') {
					return (
						<text key={`chunk:${chunk.id}`} fg={props.textColor}>
							{chunk.text}
						</text>
					);
				}

				return (
					<ChunkRenderer
						key={`chunk:${chunk.id}`}
						chunk={chunk}
						isStreaming={props.isStreaming && isLastChunk}
					/>
				);
			})}
		</box>
	);
};

const AssistantMessage = (props: {
	content: AssistantContent;
	isStreaming: boolean;
	isCanceled?: boolean;
}) => {
	const textColor = props.isCanceled ? colors.textMuted : undefined;

	if (typeof props.content === 'string') {
		if (props.isCanceled) {
			return <text fg={textColor}>{props.content}</text>;
		}
		return <AssistantText content={props.content} streaming={props.isStreaming} />;
	}

	if (props.content.type === 'text') {
		if (props.isCanceled) {
			return <text fg={textColor}>{props.content.content}</text>;
		}
		return <AssistantText content={props.content.content} streaming={props.isStreaming} />;
	}

	if (props.content.type === 'chunks') {
		return (
			<ChunksRenderer
				chunks={props.content.chunks}
				isStreaming={props.isStreaming}
				isCanceled={props.isCanceled}
				textColor={textColor}
			/>
		);
	}

	return null;
};

export const Messages = () => {
	const messagesState = useMessagesContext();

	const lastAssistantIndex = useMemo(() => {
		for (let i = messagesState.messages.length - 1; i >= 0; i--) {
			if (messagesState.messages[i]?.role === 'assistant') return i;
		}
		return -1;
	}, [messagesState.messages]);

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
				{messagesState.messages.map((m, index) => {
					if (m.role === 'user') {
						return (
							<box key={`user:${index}`} style={{ flexDirection: 'column', gap: 1 }}>
								<text fg={colors.accent}>You </text>
								<text>
									{m.content.map((part, i) => (
										<span key={i} style={{ fg: getColor(part.type) }}>
											{part.content}
										</span>
									))}
								</text>
							</box>
						);
					}

					if (m.role === 'system') {
						return (
							<box key={`sys:${index}`} style={{ flexDirection: 'column', gap: 1 }}>
								<text fg={colors.info}>SYS </text>
								<text fg={colors.text} content={`${m.content}`} />
							</box>
						);
					}

					const isCanceled = m.canceled === true;
					const isStreaming = messagesState.isStreaming && index === lastAssistantIndex;

					return (
						<box key={`ai:${index}`} style={{ flexDirection: 'column', gap: 1 }}>
							<box style={{ flexDirection: 'row' }}>
								<text fg={isCanceled ? colors.textMuted : colors.success}>
									{isCanceled ? 'AI [canceled] ' : 'AI '}
								</text>
								{isStreaming ? <LoadingSpinner /> : null}
							</box>
							<AssistantMessage
								content={m.content}
								isStreaming={isStreaming}
								isCanceled={isCanceled}
							/>
						</box>
					);
				})}
			</scrollbox>
		</box>
	);
};
