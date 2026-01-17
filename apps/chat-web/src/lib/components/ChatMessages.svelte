<script lang="ts">
	import { Loader2, Server, GitBranch, Zap, Copy, Check, ArrowDown } from '@lucide/svelte';
	import type { Message, BtcaChunk, AssistantContent } from '$lib/types';
	import { nanoid } from 'nanoid';
	import { marked } from 'marked';
	import { createHighlighter } from 'shiki';
	import DOMPurify from 'isomorphic-dompurify';

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
		sandboxStatus: string | null;
		currentChunks: BtcaChunk[];
	}

	let { messages, isStreaming, sandboxStatus, currentChunks }: Props = $props();

	// Scroll state
	let scrollContainer = $state<HTMLDivElement | null>(null);
	let isAtBottom = $state(true);

	function handleScroll() {
		if (!scrollContainer) return;
		const { scrollTop, scrollHeight, clientHeight } = scrollContainer;
		// Consider "at bottom" if within 100px of the bottom
		isAtBottom = scrollHeight - scrollTop - clientHeight < 100;
	}

	function scrollToBottom() {
		if (!scrollContainer) return;
		scrollContainer.scrollTo({ top: scrollContainer.scrollHeight, behavior: 'smooth' });
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

	const shikiHighlighter = createHighlighter({
		themes: ['dark-plus', 'light-plus'],
		langs: [
			'elixir',
			'typescript',
			'svelte',
			'json',
			'text',
			'javascript',
			'html',
			'css',
			'bash',
			'shell'
		]
	});

	let markdownCache = $state<Record<string, string>>({});
	const markdownPending = new Set<string>();

	function normalizeCodeLang(langRaw: string | undefined): string {
		const lang = (langRaw ?? '').trim().toLowerCase();
		if (!lang) return 'text';
		const langMap: Record<string, string> = {
			ts: 'typescript',
			js: 'javascript',
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
			shell: 'shell'
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
</script>

<div class="relative min-h-0 flex-1">
	<div bind:this={scrollContainer} onscroll={handleScroll} class="absolute inset-0 overflow-y-auto">
		<div class="mx-auto flex w-full max-w-5xl flex-col gap-4 p-5">
			{#each messages as message (message.id)}
				{#if message.role === 'user'}
					<div class="chat-message chat-message-user">
						<div class="mb-1 flex items-center gap-2">
							<span class="bc-muted text-xs font-medium">You</span>
							{#each message.resources as resource}
								<span class="bc-badge">@{resource}</span>
							{/each}
						</div>
						<div class="text-sm">{stripHistory(message.content)}</div>
					</div>
				{:else if message.role === 'assistant'}
					<div class="chat-message chat-message-assistant">
						<div class="mb-2">
							<span class="text-xs font-medium text-[hsl(var(--bc-success))]">AI</span>
						</div>
						{#if typeof message.content === 'string'}
							<div class="prose prose-neutral prose-invert max-w-none">
								{@html getRenderedMarkdown(message.content)}
							</div>
						{:else if isTextContent(message.content)}
							<div class="prose prose-neutral prose-invert max-w-none">
								{@html getRenderedMarkdown(message.content.content)}
							</div>
						{:else if isChunksContent(message.content)}
							<div class="space-y-3">
								{#each sortChunks(message.content.chunks) as chunk (chunk.id)}
									{#if chunk.type === 'reasoning'}
										<div class="reasoning-block">
											<span class="font-medium">Thinking:</span>
											{chunk.text}
										</div>
									{:else if chunk.type === 'tool'}
										<div class="tool-indicator">
											{#if chunk.state === 'running'}
												<Loader2 size={12} class="animate-spin" />
											{:else}
												<span
													class="tool-dot {chunk.state === 'completed'
														? 'tool-dot-completed'
														: 'tool-dot-pending'}"
												></span>
											{/if}
											<span>{chunk.toolName}</span>
										</div>
									{:else if chunk.type === 'text'}
										<div class="prose prose-neutral prose-invert max-w-none">
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
									<Copy size={12} /> Copy
								{/if}
							</button>
						</div>
					</div>
				{:else if message.role === 'system'}
					<div class="chat-message chat-message-system">
						<div class="text-sm">{message.content}</div>
					</div>
				{/if}
			{/each}

			<!-- Sandbox status -->
			{#if isStreaming && sandboxStatus}
				<div class="chat-message chat-message-system">
					<div class="flex items-center gap-3">
						<div class="sandbox-status-indicator">
							{#if sandboxStatus === 'pending' || sandboxStatus === 'creating'}
								<Server size={16} class="text-[hsl(var(--bc-warning))]" />
							{:else if sandboxStatus === 'cloning'}
								<GitBranch size={16} class="text-[hsl(var(--bc-accent))]" />
							{:else if sandboxStatus === 'starting'}
								<Zap size={16} class="text-[hsl(var(--bc-success))]" />
							{:else}
								<Loader2 size={16} class="animate-spin" />
							{/if}
						</div>
						<div>
							<div class="text-sm font-medium">
								{#if sandboxStatus === 'pending' || sandboxStatus === 'creating'}
									Creating sandbox...
								{:else if sandboxStatus === 'cloning'}
									Cloning repositories...
								{:else if sandboxStatus === 'starting'}
									Starting server...
								{:else}
									Initializing...
								{/if}
							</div>
							<div class="sandbox-progress-bar">
								<div
									class="sandbox-progress-fill"
									style="width: {sandboxStatus === 'pending'
										? '10%'
										: sandboxStatus === 'creating'
											? '30%'
											: sandboxStatus === 'cloning'
												? '60%'
												: sandboxStatus === 'starting'
													? '85%'
													: '95%'}"
								></div>
							</div>
						</div>
					</div>
				</div>
			{/if}

			<!-- Streaming -->
			{#if isStreaming && currentChunks.length > 0}
				<div class="chat-message chat-message-assistant">
					<div class="mb-2 flex items-center gap-2">
						<span class="text-xs font-medium text-[hsl(var(--bc-success))]">AI</span>
						<Loader2 size={12} class="animate-spin" />
					</div>
					<div class="space-y-3">
						{#each sortChunks(currentChunks) as chunk (chunk.id)}
							{#if chunk.type === 'reasoning'}
								<div class="reasoning-block">
									<span class="font-medium">Thinking:</span>
									{chunk.text}
								</div>
							{:else if chunk.type === 'tool'}
								<div class="tool-indicator">
									{#if chunk.state === 'running'}
										<Loader2 size={12} class="animate-spin" />
									{:else}
										<span
											class="tool-dot {chunk.state === 'completed'
												? 'tool-dot-completed'
												: 'tool-dot-pending'}"
										></span>
									{/if}
									<span>{chunk.toolName}</span>
								</div>
							{:else if chunk.type === 'text'}
								<div class="prose prose-neutral prose-invert max-w-none">
									{@html getRenderedMarkdown(chunk.text)}
								</div>
							{/if}
						{/each}
					</div>
				</div>
			{/if}
		</div>
		<div class="h-24"></div>
	</div>

	<!-- Jump to bottom button -->
	{#if !isAtBottom}
		<button
			type="button"
			onclick={scrollToBottom}
			class="absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-1.5 border border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface))] px-3 py-1.5 text-xs font-medium shadow-md transition-colors hover:border-[hsl(var(--bc-fg))] hover:bg-[hsl(var(--bc-surface-2))]"
		>
			<ArrowDown size={14} />
			Jump to bottom
		</button>
	{/if}
</div>
