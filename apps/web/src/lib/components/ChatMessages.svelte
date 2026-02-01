<script lang="ts">
	import { ArrowDown, Check, CheckCircle2, Copy, Loader2, RotateCcw } from '@lucide/svelte';
	import { nanoid } from 'nanoid';
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';
	import ToolCallSummary from '$lib/components/ToolCallSummary.svelte';
	import { getChatHighlighter } from '../shiki/chatHighlighter.ts';
	import type { Message, BtcaChunk, AssistantContent } from '$lib/types';

	// Type guards for AssistantContent (can be string | { type: 'text' } | { type: 'chunks' })
	function isTextContent(content: AssistantContent): content is { type: 'text'; content: string } {
		return typeof content === 'object' && content !== null && content.type === 'text';
	}
	function isChunksContent(
		content: AssistantContent
	): content is { type: 'chunks'; chunks: BtcaChunk[] } {
		return typeof content === 'object' && content !== null && content.type === 'chunks';
	}

	// Extract text from assistant content for copy functionality
	function getAssistantTextContent(content: AssistantContent): string {
		if (typeof content === 'string') return content;
		if (isTextContent(content)) return content.content;
		if (isChunksContent(content)) {
			return content.chunks
				.filter((c): c is BtcaChunk & { type: 'text' } => c.type === 'text')
				.map((c) => c.text)
				.join('\n\n');
		}
		return '';
	}

	// Get chunks from assistant content (returns empty array for non-chunks content)
	function getAssistantChunks(content: AssistantContent): BtcaChunk[] {
		if (isChunksContent(content)) return content.chunks;
		return [];
	}

	interface Props {
		messages: Message[];
		isStreaming: boolean;
		streamStatus: string | null;
		currentChunks: BtcaChunk[];
		activeStream: { sessionId: string; messageId: string; startedAt: number } | null;
		hasBackgroundStream: boolean;
		onRetry?: (message: Message & { role: 'user' }) => void;
	}

	let {
		messages,
		isStreaming,
		streamStatus,
		currentChunks,
		activeStream,
		hasBackgroundStream,
		onRetry
	}: Props = $props();

	function formatRelativeTime(timestamp: number): string {
		const seconds = Math.floor((Date.now() - timestamp) / 1000);
		if (seconds < 60) return 'just now';
		const minutes = Math.floor(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.floor(minutes / 60);
		return `${hours}h ago`;
	}

	const streamStatusMeta: Record<
		string,
		{ label: string; detail: string; icon: typeof Loader2; tone: string; progress: string }
	> = {
		starting: {
			label: 'Warming instance',
			detail: 'Starting your btca runtime...',
			icon: Loader2,
			tone: 'text-[hsl(var(--bc-warning))]',
			progress: '35%'
		},
		ready: {
			label: 'Instance ready',
			detail: 'Streaming response from btca',
			icon: CheckCircle2,
			tone: 'text-[hsl(var(--bc-success))]',
			progress: '85%'
		}
	};

	const streamStatusInfo = $derived.by(() => {
		if (!streamStatus) return null;
		return (
			streamStatusMeta[streamStatus] ?? {
				label: 'Connecting',
				detail: 'Contacting your instance...',
				icon: Loader2,
				tone: 'text-[hsl(var(--bc-accent))]',
				progress: '20%'
			}
		);
	});

	const StreamStatusIcon = $derived.by(() => streamStatusInfo?.icon ?? Loader2);

	// Scroll state
	let scrollContainer = $state<HTMLDivElement | null>(null);
	let isAtBottom = $state(true);

	function handleScroll() {
		if (!scrollContainer) return;
		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
		// Consider "at bottom" if within 100px of the bottom
		isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
	}

	export function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
		if (!scrollContainer) return;
		scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior });
	}

	// Copy state
	let copiedId = $state<string | null>(null);

	// Markdown rendering - strip conversation history from displayed text
	// This handles cases where the AI echoes back parts of the formatted prompt
	function stripHistory(text: string): string {
		return (
			text
				// Old format markers
				.replace(/=== CONVERSATION HISTORY ===[\s\S]*?=== END HISTORY ===/g, '')
				.replace(/^Current question:\s*/i, '')
				// New XML format - strip full history block and current_message wrapper
				.replace(/<conversation_history>[\s\S]*?<\/conversation_history>\s*/g, '')
				.replace(/<current_message>\s*/g, '')
				.replace(/\s*<\/current_message>/g, '')
				// Strip orphaned tags (when AI echoes back partial history)
				.replace(/<\/?conversation_history>\s*/g, '')
				.replace(/<\/?current_message>\s*/g, '')
				.replace(/<\/?human>\s*/g, '')
				.replace(/<\/?assistant>\s*/g, '')
				.trim()
		);
	}

	const shikiHighlighter = getChatHighlighter();

	let markdownCache = $state<Record<string, string>>({});
	const markdownPending = new Set<string>();

	function normalizeCodeLang(langRaw: string | undefined): string {
		const lang = (langRaw ?? '').trim().toLowerCase();
		if (!lang) return 'text';
		const langMap: Record<string, string> = {
			ts: 'typescript',
			tsx: 'tsx',
			js: 'javascript',
			jsx: 'jsx',
			svelte: 'svelte',
			json: 'json',
			elixir: 'elixir',
			ex: 'elixir',
			exs: 'elixir',
			typescript: 'typescript',
			javascript: 'javascript',
			html: 'html',
			css: 'css',
			bash: 'bash',
			sh: 'shell',
			shell: 'shell',
			python: 'python',
			py: 'python',
			rust: 'rust',
			rs: 'rust',
			go: 'go',
			golang: 'go'
		};
		return langMap[lang] ?? 'text';
	}

	async function renderMarkdownWithShiki(text: string): Promise<string> {
		const content = stripHistory(text);
		const highlighter = await shikiHighlighter;

		const renderer = new marked.Renderer();
		renderer.code = ({ text, lang }: { text: string; lang?: string }) => {
			const normalized = normalizeCodeLang(lang);
			const codeId = nanoid(8);
			const highlighted = highlighter.codeToHtml(text, {
				lang: normalized,
				themes: { light: 'light-plus', dark: 'dark-plus' },
				defaultColor: false
			});
			return `<div class="code-block-wrapper" data-code-id="${codeId}"><div class="code-block-header"><span class="code-lang">${lang || 'text'}</span><button class="copy-btn" data-copy-target="${codeId}" onclick="window.copyCode('${codeId}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>Copy</button></div><div class="code-content" id="code-${codeId}">${highlighted}</div><pre style="display:none" id="code-raw-${codeId}">${text.replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre></div>`;
		};

		const html = (await marked.parse(content, { async: true, renderer })) as string;
		return DOMPurify.sanitize(html, {
			ADD_TAGS: ['pre', 'code'],
			ADD_ATTR: ['data-code-id', 'data-copy-target', 'onclick', 'class', 'id', 'style']
		});
	}

	function getRenderedMarkdown(text: string): string {
		const content = stripHistory(text);
		if (markdownCache[content]) return markdownCache[content]!;

		if (!markdownPending.has(content)) {
			markdownPending.add(content);
			void renderMarkdownWithShiki(content)
				.then((html) => {
					markdownCache = { ...markdownCache, [content]: html };
				})
				.finally(() => {
					markdownPending.delete(content);
				});
		}

		const html = marked.parse(content, { async: false }) as string;
		return DOMPurify.sanitize(html, {
			ADD_TAGS: ['pre', 'code'],
			ADD_ATTR: ['class']
		});
	}

	// Global copy function
	if (typeof window !== 'undefined') {
		(window as unknown as { copyCode: (id: string) => void }).copyCode = async (id: string) => {
			const rawEl = document.getElementById(`code-raw-${id}`);
			if (rawEl) {
				const text = rawEl.textContent ?? '';
				await navigator.clipboard.writeText(text);
				copiedId = id;
				setTimeout(() => {
					copiedId = null;
				}, 2000);
			}
		};
	}

	async function copyFullAnswer(messageId: string, chunks: BtcaChunk[]) {
		const text = chunks
			.filter((c): c is BtcaChunk & { type: 'text' } => c.type === 'text')
			.map((c) => c.text)
			.join('\n\n');
		await navigator.clipboard.writeText(stripHistory(text));
		copiedId = messageId;
		setTimeout(() => {
			copiedId = null;
		}, 2000);
	}

	async function copyUserMessage(messageId: string, content: string) {
		await navigator.clipboard.writeText(stripHistory(content));
		copiedId = messageId;
		setTimeout(() => {
			copiedId = null;
		}, 2000);
	}

	async function copyFullThread() {
		const parts: string[] = [];
		for (const message of messages) {
			if (message.role === 'user') {
				parts.push(`**User:** ${stripHistory(message.content)}`);
			} else if (message.role === 'assistant') {
				const text = getAssistantTextContent(message.content);
				parts.push(`**Assistant:** ${stripHistory(text)}`);
			}
		}
		await navigator.clipboard.writeText(parts.join('\n\n'));
		copiedId = 'full-thread';
		setTimeout(() => {
			copiedId = null;
		}, 2000);
	}

	function sortChunks(chunks: BtcaChunk[]): BtcaChunk[] {
		const reasoning: BtcaChunk[] = [];
		const tools: BtcaChunk[] = [];
		const text: BtcaChunk[] = [];
		const other: BtcaChunk[] = [];
		for (const chunk of chunks) {
			if (chunk.type === 'reasoning') reasoning.push(chunk);
			else if (chunk.type === 'tool') tools.push(chunk);
			else if (chunk.type === 'text') text.push(chunk);
			else other.push(chunk);
		}
		return [...reasoning, ...tools, ...text, ...other];
	}

	function getToolChunks(chunks: BtcaChunk[]): BtcaChunk[] {
		return chunks.filter((chunk) => chunk.type === 'tool');
	}

	function getRenderableChunks(chunks: BtcaChunk[]): BtcaChunk[] {
		return sortChunks(chunks).filter((chunk) => chunk.type !== 'tool');
	}
</script>

<div class="relative min-h-0 flex-1">
	<div
		bind:this={scrollContainer}
		onscroll={handleScroll}
		class="absolute inset-0 overflow-y-auto bc-chatPattern"
	>
		<div class="mx-auto flex w-full max-w-5xl flex-col gap-4 p-5">
			{#each messages as message, index (message.id)}
				{#if message.role === 'user'}
					<div>
						<div class="chat-message chat-message-user">
							<div class="mb-1 flex items-center gap-2">
								<span class="bc-muted text-xs font-medium">You</span>
								{#each message.resources as resource}
									<span class="bc-badge">@{resource}</span>
								{/each}
							</div>
							<div class="text-sm">{stripHistory(message.content)}</div>
						</div>
						{#if message.id !== 'pending-user'}
							<div class="mt-2 flex justify-end gap-2">
								<button
									type="button"
									class="copy-answer-btn"
									onclick={() => copyUserMessage(message.id, message.content)}
								>
									{#if copiedId === message.id}
										<Check size={12} /> Copied
									{:else}
										<Copy size={12} /> Copy
									{/if}
								</button>
								{#if onRetry && !isStreaming}
									<button type="button" class="copy-answer-btn" onclick={() => onRetry(message)}>
										<RotateCcw size={12} /> Retry
									</button>
								{/if}
							</div>
						{/if}
					</div>
				{:else if message.role === 'assistant'}
					<div class="chat-message chat-message-assistant">
						<div class="mb-2">
							<span class="text-xs font-medium text-[hsl(var(--bc-success))]">AI</span>
						</div>
						{#if typeof message.content === 'string'}
							<div class="prose prose-neutral dark:prose-invert max-w-none">
								{@html getRenderedMarkdown(message.content)}
							</div>
						{:else if isTextContent(message.content)}
							<div class="prose prose-neutral dark:prose-invert max-w-none">
								{@html getRenderedMarkdown(message.content.content)}
							</div>
						{:else if isChunksContent(message.content)}
							{@const toolChunks = getToolChunks(message.content.chunks)}
							{@const renderableChunks = getRenderableChunks(message.content.chunks)}
							{#if toolChunks.length > 0}
								<ToolCallSummary chunks={toolChunks} />
							{/if}
							<div class="space-y-3">
								{#each renderableChunks as chunk (chunk.id)}
									{#if chunk.type === 'reasoning'}
										<div class="reasoning-block">
											<span class="font-medium">Thinking:</span>
											{chunk.text}
										</div>
									{:else if chunk.type === 'text'}
										<div class="prose prose-neutral dark:prose-invert max-w-none">
											{@html getRenderedMarkdown(chunk.text)}
										</div>
									{/if}
								{/each}
							</div>
						{/if}
						<div class="mt-3">
							<button
								type="button"
								class="copy-answer-btn"
								onclick={() => copyFullAnswer(message.id, getAssistantChunks(message.content))}
							>
								{#if copiedId === message.id}
									<Check size={12} /> Copied
								{:else}
									<Copy size={12} /> Copy message
								{/if}
							</button>
						</div>
					</div>
					{#if messages[index + 1]?.role === 'user'}
						<div class="bc-message-divider"></div>
					{/if}
				{:else if message.role === 'system'}
					<div class="chat-message chat-message-system">
						<div class="text-sm">{message.content}</div>
					</div>
				{/if}
			{/each}

			<!-- Background stream in progress indicator -->
			{#if hasBackgroundStream && activeStream}
				<div class="chat-message chat-message-system">
					<div class="flex items-center gap-3">
						<div class="sandbox-status-indicator">
							<Loader2 size={16} class="animate-spin text-[hsl(var(--bc-accent))]" />
						</div>
						<div>
							<div class="text-sm font-medium">Response in progress</div>
							<div class="bc-muted text-xs">
								Started {formatRelativeTime(activeStream.startedAt)}. The response will appear
								automatically when complete.
							</div>
						</div>
					</div>
				</div>
			{/if}

			<!-- Streaming status -->
			{#if isStreaming && streamStatusInfo}
				<div class="chat-message chat-message-system">
					<div class="flex items-center gap-3">
						<div class="sandbox-status-indicator">
							<StreamStatusIcon
								size={16}
								class={`${streamStatusInfo.tone} ${streamStatusInfo.icon === Loader2 ? 'animate-spin' : ''}`}
							/>
						</div>
						<div>
							<div class="text-sm font-medium">{streamStatusInfo.label}</div>
							<div class="bc-muted text-xs">{streamStatusInfo.detail}</div>
							<div class="sandbox-progress-bar">
								<div
									class="sandbox-progress-fill"
									style={`width: ${streamStatusInfo.progress}`}
								></div>
							</div>
						</div>
					</div>
				</div>
			{/if}

			<!-- Streaming -->
			{#if isStreaming && currentChunks.length > 0}
				{@const streamingToolChunks = getToolChunks(currentChunks)}
				{@const streamingRenderableChunks = getRenderableChunks(currentChunks)}
				<div class="chat-message chat-message-assistant">
					<div class="mb-2 flex items-center gap-2">
						<span class="text-xs font-medium text-[hsl(var(--bc-success))]">AI</span>
						<Loader2 size={12} class="animate-spin" />
					</div>
					{#if streamingToolChunks.length > 0}
						<ToolCallSummary chunks={streamingToolChunks} />
					{/if}
					<div class="space-y-3">
						{#each streamingRenderableChunks as chunk (chunk.id)}
							{#if chunk.type === 'reasoning'}
								<div class="reasoning-block">
									<span class="font-medium">Thinking:</span>
									{chunk.text}
								</div>
							{:else if chunk.type === 'text'}
								<div class="prose prose-neutral dark:prose-invert max-w-none">
									{@html getRenderedMarkdown(chunk.text)}
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/if}

			<!-- Copy full thread button -->
			{#if messages.length > 0}
				<div class="flex justify-center pt-4">
					<button type="button" class="copy-answer-btn" onclick={copyFullThread}>
						{#if copiedId === 'full-thread'}
							<Check size={12} /> Copied
						{:else}
							<Copy size={12} /> Copy full thread
						{/if}
					</button>
				</div>
			{/if}
		</div>
		<div class="h-24"></div>
	</div>

	<!-- Jump to bottom button -->
	{#if !isAtBottom}
		<button
			type="button"
			onclick={() => scrollToBottom()}
			class="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 border border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface))] px-3 py-1.5 text-xs font-medium shadow-md transition-colors hover:border-[hsl(var(--bc-fg))] hover:bg-[hsl(var(--bc-surface-2))]"
		>
			<ArrowDown size={14} />
			Jump to bottom
		</button>
	{/if}
</div>
