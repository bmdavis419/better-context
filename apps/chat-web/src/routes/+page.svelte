<script lang="ts">
	import {
		MessageSquare,
		Plus,
		Trash2,
		Loader2,
		Send,
		XCircle,
		ChevronRight
	} from '@lucide/svelte';
	import type { Message, BtcaChunk, CancelState } from '$lib/types';
	import { nanoid } from 'nanoid';
	import { marked } from 'marked';

	// Session state
	let sessions = $state<
		{
			id: string;
			status: string;
			createdAt: string;
			messageCount: number;
			threadResources: string[];
		}[]
	>([]);
	let currentSessionId = $state<string | null>(null);
	let currentSession = $state<{
		id: string;
		status: string;
		serverUrl: string;
		messages: Message[];
		threadResources: string[];
	} | null>(null);

	// UI state
	let isCreatingSession = $state(false);
	let isLoadingSession = $state(false);
	let isStreaming = $state(false);
	let cancelState = $state<CancelState>('none');
	let inputValue = $state('');
	let availableResources = $state<{ name: string; type: string }[]>([]);
	let showSessionList = $state(true);

	// Streaming state
	let currentChunks = $state<BtcaChunk[]>([]);
	let abortController: AbortController | null = null;

	// Load sessions on mount
	$effect(() => {
		loadSessions();
	});

	async function loadSessions() {
		try {
			const response = await fetch('/api/sessions');
			const data = (await response.json()) as {
				sessions: typeof sessions;
			};
			sessions = data.sessions;
		} catch (error) {
			console.error('Failed to load sessions:', error);
		}
	}

	async function createNewSession() {
		isCreatingSession = true;
		try {
			const response = await fetch('/api/sessions', { method: 'POST' });
			const data = (await response.json()) as {
				id: string;
				error?: string;
			};

			if (!response.ok) {
				throw new Error(data.error ?? 'Failed to create session');
			}

			await loadSessions();
			await loadSession(data.id);
		} catch (error) {
			console.error('Failed to create session:', error);
			alert(error instanceof Error ? error.message : 'Failed to create session');
		} finally {
			isCreatingSession = false;
		}
	}

	async function loadSession(sessionId: string) {
		isLoadingSession = true;
		try {
			const response = await fetch(`/api/sessions/${sessionId}`);
			const data = (await response.json()) as typeof currentSession & { error?: string };

			if (!response.ok) {
				throw new Error(data?.error ?? 'Failed to load session');
			}

			currentSession = data;
			currentSessionId = sessionId;
			showSessionList = false;

			// Load available resources
			await loadResources();
		} catch (error) {
			console.error('Failed to load session:', error);
			alert(error instanceof Error ? error.message : 'Failed to load session');
		} finally {
			isLoadingSession = false;
		}
	}

	async function loadResources() {
		if (!currentSessionId) return;
		try {
			const response = await fetch(`/api/sessions/${currentSessionId}/resources`);
			const data = (await response.json()) as {
				resources: typeof availableResources;
			};
			availableResources = data.resources;
		} catch (error) {
			console.error('Failed to load resources:', error);
		}
	}

	async function destroySession(sessionId: string) {
		if (!confirm('Are you sure you want to destroy this session?')) return;

		try {
			await fetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
			await loadSessions();

			if (currentSessionId === sessionId) {
				currentSession = null;
				currentSessionId = null;
				showSessionList = true;
			}
		} catch (error) {
			console.error('Failed to destroy session:', error);
		}
	}

	async function clearChat() {
		if (!currentSessionId) return;
		try {
			await fetch(`/api/sessions/${currentSessionId}`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ action: 'clear' })
			});
			await loadSession(currentSessionId);
		} catch (error) {
			console.error('Failed to clear chat:', error);
		}
	}

	// Parse @mentions from input
	function parseMentions(input: string): { resources: string[]; question: string } {
		const mentionRegex = /@(\w+)/g;
		const resources: string[] = [];
		let match;
		while ((match = mentionRegex.exec(input)) !== null) {
			resources.push(match[1]!);
		}
		const question = input.replace(mentionRegex, '').trim();
		return { resources: [...new Set(resources)], question };
	}

	async function sendMessage() {
		if (!currentSessionId || !currentSession || isStreaming || !inputValue.trim()) return;

		const { resources: mentionedResources, question } = parseMentions(inputValue);
		const threadResources = currentSession.threadResources || [];

		// Validate resources
		if (mentionedResources.length === 0 && threadResources.length === 0) {
			alert('Please @mention a resource first (e.g., @svelte)');
			return;
		}

		if (!question.trim()) {
			alert('Please enter a question after the @mention');
			return;
		}

		// Validate mentioned resources exist
		const validResources: string[] = [];
		const invalidResources: string[] = [];
		for (const res of mentionedResources) {
			const found = availableResources.find((r) => r.name.toLowerCase() === res.toLowerCase());
			if (found) validResources.push(found.name);
			else invalidResources.push(res);
		}

		if (invalidResources.length > 0) {
			alert(`Unknown resources: ${invalidResources.join(', ')}`);
			return;
		}

		// Add user message to UI
		const userMessage: Message = {
			id: nanoid(),
			role: 'user',
			content: inputValue,
			resources: validResources
		};

		currentSession.messages = [...currentSession.messages, userMessage];
		const savedInput = inputValue;
		inputValue = '';
		isStreaming = true;
		cancelState = 'none';
		currentChunks = [];

		// Create abort controller
		abortController = new AbortController();

		try {
			const response = await fetch(`/api/sessions/${currentSessionId}/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					message: savedInput,
					resources: validResources
				}),
				signal: abortController.signal
			});

			if (!response.ok) {
				throw new Error('Failed to send message');
			}

			if (!response.body) {
				throw new Error('No response body');
			}

			// Process SSE stream
			const reader = response.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';

			while (true) {
				const { done, value } = await reader.read();
				if (done) break;

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				let eventData = '';
				for (const line of lines) {
					if (line.startsWith('data: ')) {
						eventData = line.slice(6);
					} else if (line === '' && eventData) {
						try {
							const event = JSON.parse(eventData) as
								| { type: 'add'; chunk: BtcaChunk }
								| { type: 'update'; id: string; chunk: Partial<BtcaChunk> }
								| { type: 'done' }
								| { type: 'error'; error: string };

							if (event.type === 'add') {
								currentChunks = [...currentChunks, event.chunk];
							} else if (event.type === 'update') {
								currentChunks = currentChunks.map((c) => {
									if (c.id !== event.id) return c;
									// Cast to preserve discriminated union type
									return { ...c, ...event.chunk } as BtcaChunk;
								});
							} else if (event.type === 'error') {
								throw new Error(event.error);
							}
						} catch (e) {
							if (e instanceof SyntaxError) {
								console.error('Failed to parse event:', eventData);
							} else {
								throw e;
							}
						}
						eventData = '';
					}
				}
			}

			reader.releaseLock();

			// Add assistant message with final chunks
			const assistantMessage: Message = {
				id: nanoid(),
				role: 'assistant',
				content: {
					type: 'chunks',
					chunks: currentChunks
				}
			};
			currentSession.messages = [...currentSession.messages, assistantMessage];

			// Update thread resources
			currentSession.threadResources = [...new Set([...threadResources, ...validResources])];
		} catch (error) {
			if ((error as Error).name === 'AbortError') {
				// Add canceled message
				const canceledMessage: Message = {
					id: nanoid(),
					role: 'system',
					content: 'Request canceled.'
				};
				currentSession.messages = [...currentSession.messages, canceledMessage];
			} else {
				console.error('Failed to send message:', error);
				const errorMessage: Message = {
					id: nanoid(),
					role: 'system',
					content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
				};
				currentSession.messages = [...currentSession.messages, errorMessage];
			}
		} finally {
			isStreaming = false;
			cancelState = 'none';
			currentChunks = [];
			abortController = null;
		}
	}

	function requestCancel() {
		if (cancelState === 'none') {
			cancelState = 'pending';
		} else {
			abortController?.abort();
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
		}
		if (event.key === 'Escape' && isStreaming) {
			requestCancel();
		}
	}

	// Strip conversation history markers from displayed text
	function stripHistory(text: string): string {
		const historyRegex = /=== CONVERSATION HISTORY ===[\s\S]*?=== END HISTORY ===/g;
		return text
			.replace(historyRegex, '')
			.replace(/^Current question:\s*/i, '')
			.trim();
	}

	// Render markdown
	function renderMarkdown(text: string): string {
		return marked.parse(stripHistory(text), { async: false }) as string;
	}

	// Sort chunks for display: reasoning, tools, text
	function sortChunks(chunks: BtcaChunk[]): BtcaChunk[] {
		const reasoning: BtcaChunk[] = [];
		const tools: BtcaChunk[] = [];
		const text: BtcaChunk[] = [];
		const other: BtcaChunk[] = [];

		for (const chunk of chunks) {
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
	}
</script>

<div class="flex flex-1 overflow-hidden">
	<!-- Session sidebar -->
	<aside
		class="bc-card flex w-64 flex-col border-r {showSessionList
			? 'translate-x-0'
			: '-translate-x-full md:translate-x-0'} absolute top-0 left-0 z-10 h-full transition-transform md:relative"
	>
		<div class="flex items-center justify-between border-b border-[hsl(var(--bc-border))] p-4">
			<h2 class="text-sm font-semibold">Sessions</h2>
			<button
				type="button"
				class="bc-btn bc-btn-primary p-2"
				onclick={createNewSession}
				disabled={isCreatingSession}
				title="New Session"
			>
				{#if isCreatingSession}
					<Loader2 size={16} class="animate-spin" />
				{:else}
					<Plus size={16} />
				{/if}
			</button>
		</div>

		<div class="flex-1 overflow-y-auto p-2">
			{#each sessions as session (session.id)}
				<div
					class="mb-2 flex w-full cursor-pointer items-center gap-2 p-3 text-left {currentSessionId ===
					session.id
						? 'bc-card border-[hsl(var(--bc-accent))]'
						: 'bc-card hover:border-[hsl(var(--bc-fg))]'}"
					role="button"
					tabindex="0"
					onclick={() => loadSession(session.id)}
					onkeydown={(e) => e.key === 'Enter' && loadSession(session.id)}
				>
					<MessageSquare size={16} class="shrink-0" />
					<div class="min-w-0 flex-1">
						<div class="truncate text-xs font-medium">
							{session.id.slice(0, 8)}...
						</div>
						<div class="bc-muted text-xs">
							{session.messageCount} messages
						</div>
						<div class="bc-muted text-xs">
							{#if session.status === 'active'}
								<span class="text-[hsl(var(--bc-success))]">Active</span>
							{:else if session.status === 'creating'}
								<span class="text-[hsl(var(--bc-warning))]">Creating...</span>
							{:else if session.status === 'error'}
								<span class="text-[hsl(var(--bc-error))]">Error</span>
							{:else}
								<span>{session.status}</span>
							{/if}
						</div>
					</div>
					<button
						type="button"
						class="bc-chip shrink-0 p-1"
						onclick={(e) => {
							e.stopPropagation();
							destroySession(session.id);
						}}
						title="Destroy session"
					>
						<Trash2 size={14} />
					</button>
				</div>
			{/each}

			{#if sessions.length === 0}
				<div class="bc-muted py-8 text-center text-sm">
					No sessions yet.
					<br />
					Click + to create one.
				</div>
			{/if}
		</div>
	</aside>

	<!-- Main chat area -->
	<div class="flex flex-1 flex-col overflow-hidden">
		{#if !currentSession}
			<div class="flex flex-1 flex-col items-center justify-center gap-4 p-8">
				<MessageSquare size={48} class="bc-muted" />
				<h2 class="text-xl font-semibold">Welcome to btca Chat</h2>
				<p class="bc-muted max-w-md text-center">
					Select a session from the sidebar or create a new one to start chatting with btca. Each
					session runs in its own Daytona sandbox.
				</p>
				<button
					type="button"
					class="bc-btn bc-btn-primary"
					onclick={createNewSession}
					disabled={isCreatingSession}
				>
					{#if isCreatingSession}
						<Loader2 size={16} class="animate-spin" />
						Creating sandbox...
					{:else}
						<Plus size={16} />
						New Session
					{/if}
				</button>
			</div>
		{:else if isLoadingSession}
			<div class="flex flex-1 items-center justify-center">
				<Loader2 size={32} class="animate-spin" />
			</div>
		{:else}
			<!-- Chat messages -->
			<div class="chat-messages">
				{#each currentSession.messages as message (message.id)}
					{#if message.role === 'user'}
						<div class="chat-message chat-message-user">
							<div class="mb-1 flex items-center gap-2">
								<span class="text-xs font-semibold text-[hsl(var(--bc-accent))]">You</span>
								{#if message.resources.length > 0}
									<div class="flex gap-1">
										{#each message.resources as resource}
											<span class="bc-badge">@{resource}</span>
										{/each}
									</div>
								{/if}
							</div>
							<div class="text-sm">{stripHistory(message.content)}</div>
						</div>
					{:else if message.role === 'assistant'}
						<div class="chat-message chat-message-assistant">
							<div class="mb-1 flex items-center gap-2">
								<span class="text-xs font-semibold text-[hsl(var(--bc-success))]">AI</span>
								{#if message.canceled}
									<span class="bc-badge bc-badge-warning">canceled</span>
								{/if}
							</div>
							{#if message.content.type === 'text'}
								<div class="prose prose-sm">
									{@html renderMarkdown(message.content.content)}
								</div>
							{:else if message.content.type === 'chunks'}
								<div class="space-y-2">
									{#each sortChunks(message.content.chunks) as chunk (chunk.id)}
										{#if chunk.type === 'reasoning'}
											<div class="bc-muted border-l-2 border-[hsl(var(--bc-border))] pl-2 text-xs">
												<span class="font-medium">Thinking:</span>
												{chunk.text}
											</div>
										{:else if chunk.type === 'tool'}
											<div class="flex items-center gap-2 text-xs">
												{#if chunk.state === 'pending'}
													<span class="text-[hsl(var(--bc-fg-muted))]">○</span>
												{:else if chunk.state === 'running'}
													<Loader2 size={12} class="animate-spin" />
												{:else}
													<span class="text-[hsl(var(--bc-success))]">●</span>
												{/if}
												<span class="bc-muted">{chunk.toolName}</span>
											</div>
										{:else if chunk.type === 'text'}
											<div class="prose prose-sm">
												{@html renderMarkdown(chunk.text)}
											</div>
										{/if}
									{/each}
								</div>
							{/if}
						</div>
					{:else if message.role === 'system'}
						<div class="chat-message chat-message-system">
							<span class="text-xs font-semibold">System</span>
							<div class="text-sm">{message.content}</div>
						</div>
					{/if}
				{/each}

				<!-- Streaming message -->
				{#if isStreaming && currentChunks.length > 0}
					<div class="chat-message chat-message-assistant">
						<div class="mb-1 flex items-center gap-2">
							<span class="text-xs font-semibold text-[hsl(var(--bc-success))]">AI</span>
							<Loader2 size={12} class="animate-spin" />
						</div>
						<div class="space-y-2">
							{#each sortChunks(currentChunks) as chunk (chunk.id)}
								{#if chunk.type === 'reasoning'}
									<div class="bc-muted border-l-2 border-[hsl(var(--bc-border))] pl-2 text-xs">
										<span class="font-medium">Thinking:</span>
										{chunk.text}
									</div>
								{:else if chunk.type === 'tool'}
									<div class="flex items-center gap-2 text-xs">
										{#if chunk.state === 'pending'}
											<span class="text-[hsl(var(--bc-fg-muted))]">○</span>
										{:else if chunk.state === 'running'}
											<Loader2 size={12} class="animate-spin" />
										{:else}
											<span class="text-[hsl(var(--bc-success))]">●</span>
										{/if}
										<span class="bc-muted">{chunk.toolName}</span>
									</div>
								{:else if chunk.type === 'text'}
									<div class="prose prose-sm">
										{@html renderMarkdown(chunk.text)}
									</div>
								{/if}
							{/each}
						</div>
					</div>
				{/if}
			</div>

			<!-- Input area -->
			<div class="chat-input-container">
				<!-- Thread resources -->
				{#if currentSession.threadResources.length > 0}
					<div class="mb-2 flex flex-wrap gap-1">
						<span class="bc-muted text-xs">Active resources:</span>
						{#each currentSession.threadResources as resource}
							<span class="bc-badge">@{resource}</span>
						{/each}
					</div>
				{/if}

				<div class="flex gap-2">
					<div class="relative flex-1">
						<textarea
							class="bc-input min-h-[48px] resize-none pr-12"
							placeholder="Type @ to mention a resource, then ask your question..."
							bind:value={inputValue}
							onkeydown={handleKeydown}
							disabled={isStreaming}
							rows="1"
						></textarea>
						<button
							type="button"
							class="bc-btn bc-btn-primary absolute right-2 bottom-2 p-2"
							onclick={sendMessage}
							disabled={isStreaming || !inputValue.trim()}
						>
							{#if isStreaming}
								<Loader2 size={16} class="animate-spin" />
							{:else}
								<Send size={16} />
							{/if}
						</button>
					</div>
				</div>

				<!-- Status bar -->
				<div class="mt-2 flex items-center justify-between text-xs">
					<div class="bc-muted">
						{#if isStreaming}
							{#if cancelState === 'pending'}
								Press Escape again to cancel
							{:else}
								Streaming... (Escape to cancel)
							{/if}
						{:else}
							Enter to send, Shift+Enter for new line
						{/if}
					</div>
					<div class="flex gap-2">
						{#if isStreaming}
							<button type="button" class="bc-chip p-1" onclick={requestCancel} title="Cancel">
								<XCircle size={14} />
							</button>
						{/if}
						<button type="button" class="bc-chip p-1" onclick={clearChat} title="Clear chat">
							Clear
						</button>
					</div>
				</div>

				<!-- Available resources hint -->
				{#if availableResources.length > 0 && !inputValue.includes('@')}
					<div class="bc-muted mt-2 text-xs">
						Available: {availableResources.map((r) => `@${r.name}`).join(', ')}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	<!-- Mobile toggle for sidebar -->
	<button
		type="button"
		class="bc-btn fixed bottom-4 left-4 z-20 p-2 md:hidden"
		onclick={() => (showSessionList = !showSessionList)}
	>
		<ChevronRight size={16} class={showSessionList ? 'rotate-180' : ''} />
	</button>
</div>
