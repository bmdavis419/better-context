<script lang="ts">
	import { MessageSquare, Loader2, Send, BookOpen } from '@lucide/svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import { env } from '$env/dynamic/public';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import ChatMessages from '$lib/components/ChatMessages.svelte';
	import { getAuthState } from '$lib/stores/auth.svelte';
	import { getBillingStore } from '$lib/stores/billing.svelte';
	import { getInstanceStore } from '$lib/stores/instance.svelte';
	import { getProjectStore } from '$lib/stores/project.svelte';
	import { threadPreloadStore } from '$lib/stores/threadPreload.svelte';
	import { trackEvent, ClientAnalyticsEvents } from '$lib/stores/analytics.svelte';
	import { SUPPORT_URL } from '$lib/billing/plans';
	import type { BtcaChunk, CancelState } from '$lib/types';
	import { api } from '../../../../convex/_generated/api';
	import type { Id } from '../../../../convex/_generated/dataModel';

	// Get thread ID from route params - can be 'new' for a fresh thread
	const routeId = $derived((page.params as { id: string }).id);
	const isNewThread = $derived(routeId === 'new');
	const threadId = $derived(isNewThread ? null : (routeId as Id<'threads'>));
	const auth = getAuthState();
	const billingStore = getBillingStore();
	const client = useConvexClient();
	const instanceStore = getInstanceStore();
	const projectStore = getProjectStore();

	const getConvexHttpBaseUrl = (url: string) => url.replace('.convex.cloud', '.convex.site');
	const convexHttpBaseUrl = getConvexHttpBaseUrl(env.PUBLIC_CONVEX_URL!);

	// Convex queries - only query if we have a real thread ID
	const threadQuery = $derived.by(() => {
		if (!threadId) return null;
		const initialThreadData = threadPreloadStore.get(threadId);
		return useQuery(
			api.threads.getWithMessages,
			{ threadId },
			initialThreadData ? { initialData: initialThreadData } : undefined
		);
	});

	const selectedProjectId = $derived(projectStore.selectedProject?._id);
	const resourcesQuery = $derived(
		auth.instanceId
			? useQuery(
					api.resources.listUserResources,
					selectedProjectId ? { projectId: selectedProjectId } : {}
				)
			: null
	);

	// UI state
	let isStreaming = $state(false);
	let streamStatus = $state<string | null>(null);
	let cancelState = $state<CancelState>('none');
	let inputValue = $state('');
	let chatMessagesRef = $state<{ scrollToBottom: (behavior?: ScrollBehavior) => void } | null>(
		null
	);

	// Pending message shown immediately while waiting for stream
	let pendingUserMessage = $state<{ content: string; resources: string[] } | null>(null);

	// Streaming state
	let currentChunks = $state<BtcaChunk[]>([]);
	let abortController: AbortController | null = null;

	// Track which thread we're streaming for (fixes thread-scoping bug)
	let streamingForThreadId = $state<Id<'threads'> | null>(null);

	// Derived values
	const thread = $derived(threadQuery?.data);
	const messages = $derived(thread?.messages ?? []);
	const threadResources = $derived(thread?.threadResources ?? []);
	const availableResources = $derived(resourcesQuery?.data ?? []);
	const hasUsableInstance = $derived.by(() => {
		if (instanceStore.isLoading) return false;
		if (!instanceStore.instance) return false;
		return ['running', 'starting', 'stopped', 'updating'].includes(instanceStore.state ?? '');
	});
	const canChat = $derived(
		(billingStore.isSubscribed || billingStore.isOnFreePlan) &&
			!billingStore.isOverLimit &&
			hasUsableInstance
	);

	// Only show local streaming UI if it's for THIS thread
	const isStreamingThisThread = $derived(isStreaming && streamingForThreadId === threadId);

	// Get active stream from Convex (for background streams)
	const activeStream = $derived(thread?.activeStream ?? null);
	let showLoadingSpinner = $state(false);
	const loadingSpinnerDelayMs = 200;
	const loadingSpinnerTimers = new Map<string, ReturnType<typeof setTimeout>>();

	// Show "in progress" indicator when there's a background stream
	// (stream running but we're not connected to it)
	const hasBackgroundStream = $derived(activeStream !== null && !isStreamingThisThread);

	$effect(() => {
		routeId;
		const currentThread = threadId;
		const currentThreadKey = currentThread ?? '';

		for (const key of loadingSpinnerTimers.keys()) {
			if (key !== currentThreadKey) {
				const oldTimer = loadingSpinnerTimers.get(key);
				if (oldTimer) clearTimeout(oldTimer);
				loadingSpinnerTimers.delete(key);
			}
		}

		showLoadingSpinner = false;
		if (currentThread && threadQuery) {
			const timerId = setTimeout(() => {
				if (threadQuery?.isLoading && !threadQuery?.data) {
					showLoadingSpinner = true;
				}
				loadingSpinnerTimers.delete(currentThreadKey);
			}, loadingSpinnerDelayMs);
			loadingSpinnerTimers.set(currentThreadKey, timerId);
		}

		return () => {
			const timerId = loadingSpinnerTimers.get(currentThreadKey);
			if (timerId) {
				clearTimeout(timerId);
				loadingSpinnerTimers.delete(currentThreadKey);
			}
		};
	});

	$effect(() => {
		if (!threadQuery?.isLoading || threadQuery?.data) {
			showLoadingSpinner = false;
			const timerId = loadingSpinnerTimers.get(threadId ?? '');
			if (timerId) {
				clearTimeout(timerId);
				loadingSpinnerTimers.delete(threadId ?? '');
			}
		}
	});

	onMount(() => {
		return () => {
			for (const timer of loadingSpinnerTimers.values()) clearTimeout(timer);
			loadingSpinnerTimers.clear();
		};
	});

	$effect(() => {
		if (!auth.isSignedIn && auth.isLoaded) {
			goto('/app');
		}
	});

	// Auto-focus input on page load and route changes
	$effect(() => {
		// Track routeId to re-run when navigating between threads
		routeId;
		if (inputEl && auth.isSignedIn) {
			// Use tick to ensure DOM is ready after navigation
			queueMicrotask(() => inputEl?.focus());
		}
	});

	// Focus input and insert character when user types anywhere on page
	$effect(() => {
		function handleGlobalKeydown(event: KeyboardEvent) {
			// Ignore if already focused on an input/textarea
			const activeEl = document.activeElement;
			if (
				activeEl instanceof HTMLInputElement ||
				activeEl instanceof HTMLTextAreaElement ||
				activeEl?.getAttribute('contenteditable') === 'true'
			) {
				return;
			}

			// Only handle single printable characters (letters, numbers, symbols)
			if (event.key.length !== 1) return;

			// Ignore if modifier keys are pressed (except shift for uppercase)
			if (event.ctrlKey || event.metaKey || event.altKey) return;

			// Focus the input and insert the character
			if (inputEl && !isStreaming && canChat) {
				event.preventDefault();
				inputEl.focus();
				// Insert the character at the current cursor position
				const start = inputEl.selectionStart ?? inputValue.length;
				const end = inputEl.selectionEnd ?? inputValue.length;
				inputValue = inputValue.slice(0, start) + event.key + inputValue.slice(end);
				// Move cursor after the inserted character
				queueMicrotask(() => {
					if (inputEl) {
						const newPos = start + 1;
						inputEl.selectionStart = newPos;
						inputEl.selectionEnd = newPos;
						updateMentionState(true);
					}
				});
			}
		}

		window.addEventListener('keydown', handleGlobalKeydown);
		return () => window.removeEventListener('keydown', handleGlobalKeydown);
	});

	// Reset streaming display state when navigating to a different thread
	$effect(() => {
		threadId;

		// If we're viewing a different thread than what we're streaming for,
		// clear the local display state (stream continues in background)
		if (streamingForThreadId !== null && streamingForThreadId !== threadId) {
			currentChunks = [];
			streamStatus = null;
			pendingUserMessage = null;
		}
	});

	async function clearChat() {
		if (!threadId) return;
		try {
			await client.mutation(api.threads.clearMessages, { threadId });
		} catch (error) {
			console.error('Failed to clear chat:', error);
		}
	}

	async function retryMessage(message: import('$lib/types').Message & { role: 'user' }) {
		if (!threadId || isStreaming) return;

		abortController?.abort();

		try {
			await client.mutation(api.messages.deleteMessageAndAfter, {
				threadId,
				messageId: message.id as Id<'messages'>
			});
		} catch (error) {
			console.error('Failed to delete messages for retry:', error);
			return;
		}

		inputValue = message.content;
		await sendMessage();
	}

	function parseMentions(input: string): { resources: string[]; question: string } {
		const mentionRegex = /@([A-Za-z0-9._/-]+)/g;
		const resources: string[] = [];
		let match;
		while ((match = mentionRegex.exec(input)) !== null) {
			resources.push(match[1]!);
		}
		const question = input.replace(mentionRegex, '').trim();
		return { resources: [...new Set(resources)], question };
	}

	async function sendMessage() {
		if (!auth.instanceId || isStreaming || !inputValue.trim()) return;
		if (!billingStore.isSubscribed && !billingStore.isOnFreePlan) {
			alert('Subscription required. Visit /pricing to subscribe.');
			return;
		}
		if (billingStore.isOverLimit) {
			if (billingStore.isOnFreePlan) {
				alert("You've used all 5 free messages. Upgrade to Pro for $8/month to continue.");
			} else {
				alert(`Usage limits reached. Contact ${SUPPORT_URL}.`);
			}
			return;
		}
		if (!hasUsableInstance) {
			if (instanceStore.state === 'unprovisioned' || instanceStore.state === 'provisioning') {
				alert('Your instance is still provisioning. Try again soon.');
				return;
			}
			if (instanceStore.isLoading) {
				alert('Instance status is loading. Try again in a moment.');
				return;
			}
			if (instanceStore.state === 'stopped') {
				const wakeNow = confirm(
					'Your instance is stopped. Wake it now? It will take about 30-60 seconds.'
				);
				if (wakeNow) {
					const result = await instanceStore.wake();
					if (result?.error) {
						alert(result.error);
					}
				}
				return;
			}
			alert('Instance unavailable. Try again shortly.');
			return;
		}

		// For existing threads, we need the thread to exist
		if (!isNewThread && !thread) return;

		const { resources: mentionedResources, question } = parseMentions(inputValue);

		if (mentionedResources.length === 0 && threadResources.length === 0) {
			alert('Please @mention a resource first (e.g., @svelte)');
			return;
		}
		if (!question.trim()) {
			alert('Please enter a question after the @mention');
			return;
		}

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

		const savedInput = inputValue;
		inputValue = '';
		isStreaming = true;
		chatMessagesRef?.scrollToBottom('auto');
		// Show the user message immediately
		pendingUserMessage = { content: savedInput, resources: validResources };
		// Stream status will be sent from server via SSE events
		streamStatus = null;
		cancelState = 'none';
		currentChunks = [];
		abortController = new AbortController();
		let shouldRefreshUsage = false;

		try {
			// If this is a new thread, create it first
			let actualThreadId = threadId;
			if (isNewThread) {
				const newThreadId = await client.mutation(api.threads.create, {
					projectId: projectStore.selectedProject?._id
				});
				actualThreadId = newThreadId;

				await goto(`/app/chat/${newThreadId}`, { replaceState: true });
			}

			// Track which thread this stream is for
			streamingForThreadId = actualThreadId;

			const body = JSON.stringify({
				threadId: actualThreadId,
				message: savedInput,
				resources: validResources
			});

			const token = await auth.clerk?.session?.getToken({ template: 'convex' });
			if (!token) {
				throw new Error('Missing auth token');
			}

			const response = await fetch(`${convexHttpBaseUrl}/chat/stream`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`
				},
				body,
				signal: abortController.signal
			});

			if (!response.ok) {
				const errorText = await response.text();
				if (response.status === 402) {
					if (errorText?.includes('free messages')) {
						alert(
							errorText ||
								"You've used all 5 free messages. Upgrade to Pro for $8/month to continue."
						);
					} else {
						alert(errorText || 'Usage limits reached. Contact support to continue.');
					}
					shouldRefreshUsage = true;
					return;
				}
				if (response.status === 409) {
					alert(errorText || 'Instance is busy. Try again shortly.');
					return;
				}
				throw new Error(errorText || 'Failed to send message');
			}
			if (!response.body) throw new Error('No response body');

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
								| { type: 'status'; status: string }
								| { type: 'session'; sessionId: string }
								| { type: 'done' }
								| { type: 'error'; error: string };

							// Clear pending message on first event - server has saved to Convex
							if (pendingUserMessage) {
								pendingUserMessage = null;
							}

							if (event.type === 'session') {
								// Session ID received - no longer needed for resume logic
							} else if (event.type === 'status') {
								streamStatus = event.status;
							} else if (event.type === 'add') {
								streamStatus = null;
								const exists = currentChunks.some((c) => c.id === event.chunk.id);
								if (!exists) {
									currentChunks = [...currentChunks, event.chunk];
								}
							} else if (event.type === 'update') {
								currentChunks = currentChunks.map((c) => {
									if (c.id !== event.id) return c;
									return { ...c, ...event.chunk } as BtcaChunk;
								});
							} else if (event.type === 'error') {
								throw new Error(event.error);
							} else if (event.type === 'done') {
								shouldRefreshUsage = true;
							}
						} catch (e) {
							if (!(e instanceof SyntaxError)) throw e;
						}
						eventData = '';
					}
				}
			}

			reader.releaseLock();
		} catch (error) {
			const err = error as Error;
			const isAbortOrNetwork =
				err.name === 'AbortError' ||
				err.message === 'Failed to fetch' ||
				err.message === 'network error' ||
				err.message === 'Load failed';

			if (isAbortOrNetwork) {
				shouldRefreshUsage = true;
			} else {
				console.error('Chat error:', error);
				alert(error instanceof Error ? error.message : 'Chat request failed');
			}
		} finally {
			isStreaming = false;
			streamStatus = null;
			cancelState = 'none';
			currentChunks = [];
			pendingUserMessage = null;
			streamingForThreadId = null;
			abortController = null;
			if (shouldRefreshUsage) {
				void billingStore.refetch();
			}
		}
	}

	function requestCancel() {
		if (cancelState === 'none') {
			cancelState = 'pending';
		} else {
			trackEvent(ClientAnalyticsEvents.STREAM_CANCELLED, {
				threadId,
				instanceId: auth.instanceId
			});
			abortController?.abort();
		}
	}

	// Input handling
	let inputEl = $state<HTMLTextAreaElement | null>(null);
	let mentionSelectedIndex = $state(0);
	let mentionMenuOpen = $state(false);
	let mentionRange = $state<{ start: number; end: number; query: string } | null>(null);
	let mentionMenuEl = $state<HTMLDivElement | null>(null);
	let mentionItemEls = $state<Array<HTMLDivElement | null>>([]);

	$effect(() => {
		if (!mentionMenuOpen) {
			mentionItemEls = [];
			return;
		}
		const target = mentionItemEls[mentionSelectedIndex];
		if (!target || !mentionMenuEl) return;
		const menuRect = mentionMenuEl.getBoundingClientRect();
		const itemRect = target.getBoundingClientRect();
		if (itemRect.top < menuRect.top) {
			mentionMenuEl.scrollTop -= menuRect.top - itemRect.top;
		} else if (itemRect.bottom > menuRect.bottom) {
			mentionMenuEl.scrollTop += itemRect.bottom - menuRect.bottom;
		}
	});

	function getMentionAtCursor(value: string, cursor: number) {
		const regex = /(^|(?<=\s))@\w*/g;
		let match;
		while ((match = regex.exec(value)) !== null) {
			const start = match.index;
			const end = match.index + match[0].length;
			if (cursor >= start && cursor <= end) {
				return { start, end, query: match[0].slice(1) };
			}
		}
		return null;
	}

	function getFilteredResources() {
		if (!mentionRange) return [];
		const query = mentionRange.query.trim().toLowerCase();
		if (!query) return availableResources;
		return availableResources.filter((r) => r.name.toLowerCase().includes(query));
	}

	function updateMentionState(resetIndex = true) {
		if (!inputEl) {
			mentionMenuOpen = false;
			mentionRange = null;
			return;
		}
		const cursor = inputEl.selectionStart ?? inputValue.length;
		const range = getMentionAtCursor(inputValue, cursor);
		mentionRange = range;
		const shouldOpen = !!range && !isStreaming && canChat && availableResources.length > 0;
		if (!shouldOpen) {
			mentionMenuOpen = false;
			mentionSelectedIndex = 0;
			return;
		}
		const filtered = getFilteredResources();
		mentionMenuOpen = filtered.length > 0;
		if (resetIndex) {
			mentionSelectedIndex = 0;
		}
	}

	function handleInputChange() {
		updateMentionState(true);
	}

	function applyMention(resourceName: string) {
		if (!mentionRange || !inputEl) return;
		const before = inputValue.slice(0, mentionRange.start);
		const after = inputValue.slice(mentionRange.end);
		const insert = `@${resourceName} `;
		inputValue = before + insert + after;
		queueMicrotask(() => {
			if (!inputEl) return;
			const cursor = before.length + insert.length;
			inputEl.focus();
			inputEl.selectionStart = cursor;
			inputEl.selectionEnd = cursor;
			updateMentionState();
		});
	}

	function handleKeydown(event: KeyboardEvent) {
		if (mentionMenuOpen) {
			const filtered = getFilteredResources();
			if (event.key === 'ArrowDown') {
				event.preventDefault();
				mentionSelectedIndex =
					filtered.length === 0 ? 0 : (mentionSelectedIndex + 1) % filtered.length;
				return;
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault();
				mentionSelectedIndex =
					filtered.length === 0
						? 0
						: (mentionSelectedIndex - 1 + filtered.length) % filtered.length;
				return;
			}
			if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey)) {
				event.preventDefault();
				const picked = filtered[mentionSelectedIndex];
				if (picked) applyMention(picked.name);
				return;
			}
			if (event.key === 'Escape') {
				event.preventDefault();
				mentionMenuOpen = false;
				return;
			}
		}
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			sendMessage();
			return;
		}
		if (event.key === 'Escape' && isStreaming) {
			requestCancel();
			return;
		}
		queueMicrotask(() => updateMentionState(false));
	}

	function getPlaceholder(): string {
		if (!billingStore.isSubscribed && !billingStore.isOnFreePlan) {
			return 'Subscribe to start chatting';
		}
		if (billingStore.isOverLimit) {
			if (billingStore.isOnFreePlan) {
				return 'No free messages left. Upgrade to Pro to continue.';
			}
			return 'Usage limit reached. Contact support to continue.';
		}
		if (!hasUsableInstance) {
			if (instanceStore.isLoading) {
				return 'Loading your instance...';
			}
			if (instanceStore.state === 'unprovisioned' || instanceStore.state === 'provisioning') {
				return 'Provisioning your instance...';
			}
			if (instanceStore.state === 'stopped') {
				return 'Instance is stopped. Wake it to chat.';
			}
			return 'Instance unavailable. Try again soon.';
		}
		if (isStreaming && cancelState === 'pending') return 'Press Escape again to cancel';
		if (isStreaming) return 'Press Escape to cancel';
		return '@resource question...';
	}

	let backdropEl = $state<HTMLDivElement | null>(null);

	function syncScroll() {
		if (inputEl && backdropEl) {
			backdropEl.scrollTop = inputEl.scrollTop;
		}
	}

	function highlightMentions(text: string): string {
		const resourceNames = new Set(availableResources.map((r) => r.name.toLowerCase()));
		const escaped = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
		return escaped.replace(/@(\w+)/g, (match, name) => {
			if (resourceNames.has(name.toLowerCase())) {
				return `<span class="mention-highlight">${match}</span>`;
			}
			return match;
		});
	}

	// Convert Convex messages to the format expected by ChatMessages
	type Message = import('$lib/types').Message;
	const displayMessages = $derived.by((): Message[] => {
		const msgs = messages.map((m): Message => {
			if (m.role === 'user') {
				return {
					id: m._id as string,
					role: 'user',
					content: m.content as string,
					resources: m.resources ?? []
				};
			}
			// Assistant messages - content can be string or { type: 'chunks', chunks: [] }
			return {
				id: m._id as string,
				role: 'assistant',
				content: m.content,
				canceled: m.canceled
			} as Message;
		});

		// Add pending user message if exists (shown immediately while waiting for stream)
		if (pendingUserMessage) {
			msgs.push({
				id: 'pending-user',
				role: 'user',
				content: pendingUserMessage.content,
				resources: pendingUserMessage.resources
			});
		}

		return msgs;
	});
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
	{#if !isNewThread && showLoadingSpinner}
		<div class="flex flex-1 items-center justify-center">
			<Loader2 size={32} class="animate-spin" />
		</div>
	{:else if !isNewThread && !thread}
		<div class="flex flex-1 flex-col items-center justify-center gap-6 p-8">
			<div class="bc-logoMark"><MessageSquare size={20} /></div>
			<h2 class="text-xl font-semibold">Thread not found</h2>
			<a href="/app" class="bc-btn bc-btn-primary">Back to threads</a>
		</div>
	{:else}
		<!-- Messages (scrollable area) -->
		<ChatMessages
			bind:this={chatMessagesRef}
			messages={displayMessages}
			isStreaming={isStreamingThisThread}
			{streamStatus}
			{currentChunks}
			{activeStream}
			{hasBackgroundStream}
			onRetry={retryMessage}
		/>

		<!-- Input (fixed at bottom) -->
		<div class="chat-input-container shrink-0">
			{#if billingStore.isOnFreePlan}
				<div class="mb-3 bc-card border-[hsl(var(--bc-border))] bg-[hsl(var(--bc-surface-2))] p-3">
					<div class="flex items-center justify-between">
						<div class="flex items-center gap-2">
							<span class="text-sm font-medium">
								Free messages: {billingStore.freeMessagesRemaining} / {billingStore.freeMessagesTotal}
							</span>
							{#if billingStore.freeMessagesRemaining === 0}
								<span class="bc-badge bg-[hsl(var(--bc-warning))] text-xs">Limit reached</span>
							{/if}
						</div>
						<a href="/app/settings/billing" class="bc-btn bc-btn-primary text-xs">
							Upgrade to Pro
						</a>
					</div>
					{#if billingStore.freeMessagesRemaining === 0}
						<p class="mt-2 text-xs text-[hsl(var(--bc-warning))]">
							You've used all your free messages. Upgrade to Pro for unlimited messaging at
							$8/month.
						</p>
					{/if}
				</div>
			{/if}

			{#if availableResources.length === 0 && !resourcesQuery?.isLoading}
				<div class="mb-3 bc-card border-[hsl(var(--bc-accent))] bg-[hsl(var(--bc-surface-2))] p-3">
					<div class="flex items-center gap-3">
						<div class="bc-logoMark h-8 w-8 shrink-0">
							<BookOpen size={14} />
						</div>
						<div class="flex-1">
							<p class="text-sm font-medium">No resources enabled</p>
							<p class="bc-muted text-xs">
								You need to add resources to search codebases.
								<a href="/app/settings/resources" class="text-[hsl(var(--bc-accent))] underline">
									Click here to add some
								</a>
							</p>
						</div>
					</div>
				</div>
			{/if}

			{#if threadResources.length > 0}
				<div class="mb-2 flex flex-wrap items-center gap-2">
					<span class="bc-muted text-xs">Active:</span>
					{#each threadResources as resource}
						<span class="bc-badge">@{resource}</span>
					{/each}
				</div>
			{/if}

			<div class="input-wrapper">
				{#if mentionMenuOpen}
					<div class="mention-menu" bind:this={mentionMenuEl}>
						{#each getFilteredResources() as res, i (res.name)}
							<div
								class="mention-item {i === mentionSelectedIndex ? 'mention-item-selected' : ''}"
								role="option"
								tabindex="-1"
								aria-selected={i === mentionSelectedIndex}
								bind:this={mentionItemEls[i]}
								onmousedown={(e) => {
									e.preventDefault();
									applyMention(res.name);
								}}
							>
								<span class="font-medium">@{res.name}</span>
								<span class="bc-muted text-xs">{res.type}</span>
							</div>
						{/each}
					</div>
				{/if}

				<div class="chat-input-highlight-wrapper">
					<div class="chat-input-backdrop" aria-hidden="true" bind:this={backdropEl}>
						{@html highlightMentions(inputValue)}
					</div>
					<textarea
						class="chat-input"
						bind:this={inputEl}
						bind:value={inputValue}
						oninput={handleInputChange}
						onclick={handleInputChange}
						onkeydown={handleKeydown}
						onscroll={syncScroll}
						disabled={isStreaming || !canChat}
						rows="2"
						placeholder={getPlaceholder()}
					></textarea>
				</div>

				<button
					type="button"
					class="send-btn"
					onclick={sendMessage}
					disabled={isStreaming || !inputValue.trim() || !canChat}
				>
					{#if isStreaming}
						<Loader2 size={18} class="animate-spin" />
					{:else}
						<Send size={18} />
					{/if}
				</button>
			</div>

			<div class="bc-muted mt-2 flex items-center justify-between text-xs">
				<span>
					{#if isStreaming}
						{cancelState === 'pending' ? 'Press Escape again to cancel' : 'Streaming...'}
					{:else}
						Enter to send
					{/if}
				</span>
				{#if !isStreaming && !isNewThread}
					<button type="button" class="text-xs hover:underline" onclick={clearChat}>Clear</button>
				{/if}
			</div>

			{#if !billingStore.isSubscribed && !billingStore.isOnFreePlan}
				<div
					class="bc-card mt-3 border-[hsl(var(--bc-warning))] bg-[hsl(var(--bc-surface-2))] p-3 text-xs"
				>
					Subscription required to use chat. <a href="/pricing">See pricing</a>.
				</div>
			{:else if billingStore.isOverLimit}
				<div
					class="bc-card mt-3 border-[hsl(var(--bc-error))] bg-[hsl(var(--bc-surface-2))] p-3 text-xs"
				>
					{#if billingStore.isOnFreePlan}
						You've used all 5 free messages. <a href="/pricing">Upgrade to Pro</a> for $8/month to continue.
					{:else}
						You've hit your monthly usage limits. Contact
						<a href={SUPPORT_URL} target="_blank" rel="noreferrer">{SUPPORT_URL}</a> to raise them.
					{/if}
				</div>
			{/if}

			{#if availableResources.length > 0 && !inputValue.includes('@') && !threadResources.length}
				<div class="bc-muted mt-1 text-xs">
					Available: {availableResources.map((r) => `@${r.name}`).join(', ')}
				</div>
			{/if}
		</div>
	{/if}
</div>
