<script lang="ts">
	import { useQuery, useConvexClient } from 'convex-svelte';
	import {
		MessageSquare,
		Loader2,
		BookOpen,
		Clock,
		ChevronDown,
		ChevronUp,
		Copy,
		Check,
		Settings,
		Key,
		Plus,
		Trash2,
		ExternalLink
	} from '@lucide/svelte';
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';
	import { page } from '$app/state';
	import { api } from '../../../../convex/_generated/api';
	import { getAuthState } from '$lib/stores/auth.svelte';
	import { getProjectStore } from '$lib/stores/project.svelte';
	import { getShikiStore } from '$lib/stores/ShikiStore.svelte';
	import { getThemeStore } from '$lib/stores/theme.svelte';
	import CopyButton from '$lib/CopyButton.svelte';
	import { getClerk } from '$lib/clerk';

	const auth = getAuthState();
	const projectStore = getProjectStore();
	const client = useConvexClient();
	const shikiStore = getShikiStore();
	const themeStore = getThemeStore();

	const selectedProject = $derived(projectStore.selectedProject);
	const projectId = $derived(selectedProject?._id);
	const instanceId = $derived(auth.instanceId);

	const questionsQuery = $derived(
		projectId ? useQuery(api.projects.listQuestions, { projectId }) : null
	);
	const questions = $derived(questionsQuery?.data ?? []);
	const isLoading = $derived(questionsQuery?.isLoading ?? false);

	// API Keys state (using Clerk)
	let clerkApiKeys = $state<
		Array<{
			id: string;
			name: string | null;
			createdAt: number;
		}>
	>([]);
	let isLoadingKeys = $state(true);

	// Load API keys from Clerk
	async function loadApiKeys() {
		const clerk = getClerk();
		if (!clerk) return;

		isLoadingKeys = true;
		try {
			const result = await clerk.apiKeys.getAll();
			clerkApiKeys = result.data.map((key) => ({
				id: key.id,
				name: key.name,
				createdAt: key.createdAt.getTime()
			}));
		} catch (error) {
			console.error('Failed to load API keys:', error);
		} finally {
			isLoadingKeys = false;
		}
	}

	// Load keys when auth is ready
	$effect(() => {
		if (auth.isSignedIn) {
			loadApiKeys();
		}
	});

	let expandedQuestions = $state<Set<string>>(new Set());
	let copiedId = $state<string | null>(null);
	let showConfigureModal = $state(false);
	let newKeyName = $state('');
	let newlyCreatedKey = $state<string | null>(null);
	let isCreatingKey = $state(false);

	type McpTool = 'opencode' | 'claude-code';
	let selectedTool = $state<McpTool>('opencode');

	const mcpUrl = $derived(
		page.url.hostname === 'localhost' ? `${page.url.origin}/api/mcp` : 'https://btca.dev/api/mcp'
	);

	const toolConfigs = $derived({
		opencode: {
			name: 'OpenCode',
			docsUrl: 'https://opencode.ai/docs/mcp-servers/#remote',
			filename: 'opencode.json',
			config: JSON.stringify(
				{
					$schema: 'https://opencode.ai/config.json',
					mcp: {
						'better-context': {
							type: 'remote',
							url: mcpUrl,
							enabled: true,
							headers: {
								Authorization: 'Bearer YOUR_API_KEY'
							}
						}
					}
				},
				null,
				2
			)
		},
		'claude-code': {
			name: 'Claude Code',
			docsUrl: 'https://code.claude.com/docs/en/mcp#option-1:-add-a-remote-http-server',
			filename: 'Terminal command',
			config: `claude mcp add --transport http better-context ${mcpUrl} \\
  --header "Authorization: Bearer YOUR_API_KEY"`
		}
	});

	const currentConfig = $derived(toolConfigs[selectedTool]);
	const shikiTheme = $derived(themeStore.theme === 'dark' ? 'dark-plus' : 'light-plus');

	function toggleExpanded(id: string) {
		const newSet = new Set(expandedQuestions);
		if (newSet.has(id)) {
			newSet.delete(id);
		} else {
			newSet.add(id);
		}
		expandedQuestions = newSet;
	}

	function formatDate(timestamp: number): string {
		const date = new Date(timestamp);
		const now = new Date();
		const diffMs = now.getTime() - date.getTime();
		const diffMins = Math.floor(diffMs / 60000);
		const diffHours = Math.floor(diffMs / 3600000);
		const diffDays = Math.floor(diffMs / 86400000);

		if (diffMins < 1) return 'Just now';
		if (diffMins < 60) return `${diffMins}m ago`;
		if (diffHours < 24) return `${diffHours}h ago`;
		if (diffDays < 7) return `${diffDays}d ago`;

		return date.toLocaleDateString('en-US', {
			month: 'short',
			day: 'numeric',
			year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
		});
	}

	function formatFullDate(timestamp: number): string {
		return new Date(timestamp).toLocaleDateString('en-US', {
			weekday: 'long',
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}

	function formatKeyDate(timestamp: number) {
		return new Date(timestamp).toLocaleDateString('en-US', {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		});
	}

	function extractAnswer(text: string): string {
		if (text.startsWith('{"answer":') || text.startsWith('{"text":')) {
			try {
				const parsed = JSON.parse(text) as { answer?: string; text?: string };
				return parsed.answer ?? parsed.text ?? text;
			} catch {
				return text;
			}
		}
		return text;
	}

	function renderMarkdown(text: string): string {
		const cleanText = extractAnswer(text);
		const html = marked.parse(cleanText, { async: false }) as string;
		return DOMPurify.sanitize(html, {
			ADD_TAGS: ['pre', 'code'],
			ADD_ATTR: ['class']
		});
	}

	function getPreviewText(text: string, maxLength: number = 200): string {
		const cleanText = extractAnswer(text);
		const firstLine = cleanText.split('\n')[0];
		if (firstLine.length <= maxLength) return firstLine;
		return firstLine.slice(0, maxLength) + '...';
	}

	function shouldShowExpand(text: string): boolean {
		const cleanText = extractAnswer(text);
		return cleanText.length > 200 || cleanText.includes('\n');
	}

	async function copyAnswer(questionId: string, answer: string) {
		await navigator.clipboard.writeText(extractAnswer(answer));
		copiedId = questionId;
		setTimeout(() => {
			copiedId = null;
		}, 2000);
	}

	// Create a new API key via Clerk
	async function handleCreateKey() {
		const clerk = getClerk();
		if (!clerk || !newKeyName.trim()) return;

		isCreatingKey = true;
		try {
			const result = await clerk.apiKeys.create({
				name: newKeyName.trim()
			});
			// IMPORTANT: result.secret is only available immediately after creation!
			newlyCreatedKey = result.secret ?? null;
			newKeyName = '';
			await loadApiKeys();
		} catch (error) {
			console.error('Failed to create API key:', error);
		} finally {
			isCreatingKey = false;
		}
	}

	// Revoke an API key via Clerk
	async function handleRevokeKey(keyId: string) {
		const clerk = getClerk();
		if (!clerk) return;
		if (!confirm('Are you sure you want to revoke this API key? This cannot be undone.')) return;

		try {
			await clerk.apiKeys.revoke({ apiKeyID: keyId });
			await loadApiKeys();
		} catch (error) {
			console.error('Failed to revoke API key:', error);
		}
	}

	function closeConfigureModal() {
		showConfigureModal = false;
		newlyCreatedKey = null;
		newKeyName = '';
	}
</script>

<div class="flex flex-1 overflow-y-auto">
	<div class="mx-auto flex w-full max-w-4xl flex-col gap-6 p-8">
		<div class="flex items-start justify-between">
			<div>
				<h1 class="text-2xl font-semibold">MCP Questions</h1>
				<p class="bc-muted mt-1 text-sm">
					Questions asked via MCP tools for the
					{#if selectedProject}
						<span class="font-medium text-[hsl(var(--bc-text))]">{selectedProject.name}</span>
					{:else}
						selected
					{/if}
					project.
				</p>
			</div>
			<button type="button" class="bc-btn text-sm" onclick={() => (showConfigureModal = true)}>
				<Settings size={16} />
				Configure
			</button>
		</div>

		{#if !selectedProject}
			<div class="bc-card p-8 text-center">
				<div
					class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--bc-surface-2))]"
				>
					<MessageSquare size={24} class="bc-muted" />
				</div>
				<p class="font-medium">No project selected</p>
				<p class="bc-muted mt-1 text-sm">
					Select a project from the sidebar to view its questions.
				</p>
			</div>
		{:else if isLoading}
			<div class="bc-card flex items-center justify-center p-12">
				<Loader2 size={24} class="animate-spin" />
			</div>
		{:else if questions.length === 0}
			<div class="bc-card p-8 text-center">
				<div
					class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--bc-surface-2))]"
				>
					<MessageSquare size={24} class="bc-muted" />
				</div>
				<p class="font-medium">No questions yet</p>
				<p class="bc-muted mx-auto mt-2 max-w-md text-sm">
					Questions asked via MCP will appear here. Use the <code class="bc-code">ask</code> tool from
					your MCP client to get started.
				</p>
			</div>
		{:else}
			<div class="space-y-4">
				{#each questions as question (question._id)}
					{@const isExpanded = expandedQuestions.has(question._id)}
					{@const needsExpand = shouldShowExpand(question.answer)}
					<div class="question-card">
						<div class="question-header">
							<div class="question-icon">
								<MessageSquare size={16} />
							</div>
							<div class="flex-1 min-w-0">
								<p class="question-text">{question.question}</p>
								<div class="question-meta">
									<span class="meta-item" title={formatFullDate(question.createdAt)}>
										<Clock size={12} />
										{formatDate(question.createdAt)}
									</span>
									{#if question.resources.length > 0}
										<span class="meta-divider">·</span>
										<span class="meta-item">
											<BookOpen size={12} />
											{#each question.resources as resource, i}
												<span class="resource-tag">@{resource}</span>
												{#if i < question.resources.length - 1}
													<span class="text-[hsl(var(--bc-fg-muted))]">,</span>
												{/if}
											{/each}
										</span>
									{/if}
								</div>
							</div>
						</div>

						<div class="answer-section">
							<div class="answer-header">
								<span class="answer-label">Answer</span>
								<button
									type="button"
									class="copy-btn"
									onclick={() => copyAnswer(question._id, question.answer)}
									title="Copy answer"
								>
									{#if copiedId === question._id}
										<Check size={14} />
										<span>Copied</span>
									{:else}
										<Copy size={14} />
										<span>Copy</span>
									{/if}
								</button>
							</div>

							{#if isExpanded || !needsExpand}
								<div class="answer-content prose prose-neutral dark:prose-invert">
									{@html renderMarkdown(question.answer)}
								</div>
							{:else}
								<div class="answer-preview">
									{getPreviewText(question.answer)}
								</div>
							{/if}

							{#if needsExpand}
								<button
									type="button"
									class="expand-btn"
									onclick={() => toggleExpanded(question._id)}
								>
									{#if isExpanded}
										<ChevronUp size={14} />
										<span>Show less</span>
									{:else}
										<ChevronDown size={14} />
										<span>Show full answer</span>
									{/if}
								</button>
							{/if}
						</div>
					</div>
				{/each}
			</div>

			<div class="bc-muted pb-4 text-center text-xs">
				{questions.length} question{questions.length === 1 ? '' : 's'}
			</div>
		{/if}
	</div>
</div>

{#if showConfigureModal}
	<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
		<div
			class="absolute inset-0"
			role="button"
			tabindex="-1"
			onclick={closeConfigureModal}
			onkeydown={(e) => e.key === 'Escape' && closeConfigureModal()}
		></div>
		<div class="bc-card relative z-10 max-h-[90vh] w-full max-w-2xl overflow-y-auto p-6">
			<div class="mb-6 flex items-center justify-between">
				<h2 class="text-xl font-semibold">MCP Configuration</h2>
				<button
					type="button"
					class="bc-muted hover:text-[hsl(var(--bc-text))]"
					onclick={closeConfigureModal}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="20"
						height="20"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg
					>
				</button>
			</div>

			<div class="space-y-6">
				<div>
					<h3 class="mb-2 font-medium">MCP Server URL</h3>
					<div class="flex items-center gap-2">
						<code class="flex-1 rounded bg-[hsl(var(--bc-bg-secondary))] px-3 py-2 text-sm">
							{mcpUrl}
						</code>
						<CopyButton text={mcpUrl} label="Copy URL" />
					</div>
				</div>

				<div>
					<div class="mb-3 flex items-center justify-between">
						<h3 class="font-medium">API Keys</h3>
					</div>

					{#if newlyCreatedKey}
						<div class="bc-card border-green-500/30 bg-green-500/5 p-4">
							<p class="mb-2 text-sm font-medium text-green-500">API Key Created</p>
							<p class="bc-muted mb-3 text-xs">
								Copy your API key now. You won't be able to see it again.
							</p>
							<div class="flex items-center gap-2">
								<code
									class="flex-1 break-all rounded bg-[hsl(var(--bc-bg))] px-3 py-2 text-sm text-green-500"
								>
									{newlyCreatedKey}
								</code>
								<CopyButton text={newlyCreatedKey} label="Copy API key" />
							</div>
							<button
								type="button"
								class="bc-btn mt-3 w-full text-xs"
								onclick={() => (newlyCreatedKey = null)}
							>
								Done
							</button>
						</div>
					{:else}
						<div class="mb-3 flex gap-2">
							<input
								type="text"
								bind:value={newKeyName}
								placeholder="Key name (e.g., OpenCode, Claude)"
								class="bc-input flex-1 text-sm"
								onkeydown={(e) => e.key === 'Enter' && handleCreateKey()}
							/>
							<button
								type="button"
								class="bc-btn bc-btn-primary text-xs"
								onclick={handleCreateKey}
								disabled={isCreatingKey || !newKeyName.trim()}
							>
								{#if isCreatingKey}
									<Loader2 size={14} class="animate-spin" />
								{:else}
									Create
								{/if}
							</button>
						</div>

						{#if isLoadingKeys}
							<div class="flex items-center justify-center py-4">
								<Loader2 size={20} class="animate-spin" />
							</div>
						{:else if clerkApiKeys.length === 0}
							<div class="bc-card p-4 text-center">
								<Key size={20} class="bc-muted mx-auto mb-2" />
								<p class="bc-muted text-sm">No API keys yet</p>
							</div>
						{:else}
							<div class="space-y-2">
								{#each clerkApiKeys as key}
									<div
										class="flex items-center justify-between rounded border border-[hsl(var(--bc-border))] px-3 py-2 text-sm"
									>
										<div class="flex items-center gap-3">
											<span class="font-medium">{key.name ?? 'Unnamed key'}</span>
											<span class="bc-muted font-mono text-xs">{key.id}</span>
											<span class="rounded-full bg-green-500/10 px-2 py-0.5 text-xs text-green-500">
												Active
											</span>
										</div>
										<button
											type="button"
											class="bc-muted hover:text-red-500"
											onclick={() => handleRevokeKey(key.id)}
											title="Revoke key"
										>
											<Trash2 size={14} />
										</button>
									</div>
								{/each}
							</div>
						{/if}
					{/if}
				</div>

				<div>
					<h3 class="mb-3 font-medium">Setup Instructions</h3>

					<div class="mb-3 flex gap-1 rounded-lg bg-[hsl(var(--bc-bg-secondary))] p-1">
						{#each Object.entries(toolConfigs) as [key, tool]}
							<button
								type="button"
								class="flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors {selectedTool ===
								key
									? 'bg-[hsl(var(--bc-bg))] shadow-sm'
									: 'bc-muted hover:text-[hsl(var(--bc-text))]'}"
								onclick={() => (selectedTool = key as McpTool)}
							>
								{tool.name}
							</button>
						{/each}
					</div>

					<div class="mb-2 flex items-center justify-between">
						<p class="bc-muted text-xs">
							{#if selectedTool === 'claude-code'}
								Run in terminal:
							{:else}
								Add to <code class="rounded bg-[hsl(var(--bc-bg-secondary))] px-1"
									>{currentConfig.filename}</code
								>:
							{/if}
						</p>
						<a
							href={currentConfig.docsUrl}
							target="_blank"
							rel="noopener noreferrer"
							class="bc-muted flex items-center gap-1 text-xs hover:text-[hsl(var(--bc-text))]"
						>
							Docs
							<ExternalLink size={10} />
						</a>
					</div>

					<div class="bc-codeFrame">
						<div class="flex items-center justify-between gap-3 p-3">
							<div class="min-w-0 flex-1 overflow-x-auto">
								{#if shikiStore.highlighter}
									{@html shikiStore.highlighter.codeToHtml(currentConfig.config, {
										theme: shikiTheme,
										lang: selectedTool === 'claude-code' ? 'bash' : 'json',
										rootStyle:
											'background-color: transparent; padding: 0; margin: 0; font-size: 0.75rem;'
									})}
								{:else}
									<pre class="m-0 whitespace-pre text-xs leading-relaxed"><code
											>{currentConfig.config}</code
										></pre>
								{/if}
							</div>
							<CopyButton text={currentConfig.config} label="Copy configuration" />
						</div>
					</div>
					<p class="bc-muted mt-2 text-xs">
						Replace <code class="rounded bg-[hsl(var(--bc-bg-secondary))] px-1">YOUR_API_KEY</code> with
						an API key from above.
					</p>
				</div>
			</div>
		</div>
	</div>
{/if}

<style>
	.question-card {
		background: hsl(var(--bc-surface));
		border: 1px solid hsl(var(--bc-border));
		border-radius: 8px;
		overflow: hidden;
		transition: border-color 0.15s;
	}

	.question-card:hover {
		border-color: hsl(var(--bc-border-hover, var(--bc-border)));
	}

	.question-header {
		display: flex;
		gap: 12px;
		padding: 16px;
		background: hsl(var(--bc-surface));
	}

	.question-icon {
		flex-shrink: 0;
		width: 32px;
		height: 32px;
		display: flex;
		align-items: center;
		justify-content: center;
		background: hsl(var(--bc-accent) / 0.1);
		color: hsl(var(--bc-accent));
		border-radius: 8px;
	}

	.question-text {
		font-weight: 500;
		font-size: 0.9375rem;
		line-height: 1.5;
		color: hsl(var(--bc-text));
	}

	.question-meta {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
		margin-top: 8px;
		font-size: 0.75rem;
		color: hsl(var(--bc-fg-muted));
	}

	.meta-item {
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.meta-divider {
		color: hsl(var(--bc-fg-muted) / 0.5);
	}

	.resource-tag {
		background: hsl(var(--bc-surface-2));
		padding: 2px 6px;
		border-radius: 4px;
		font-family: ui-monospace, monospace;
		font-size: 0.6875rem;
	}

	.answer-section {
		background: hsl(var(--bc-surface-2) / 0.5);
		border-top: 1px solid hsl(var(--bc-border));
		padding: 16px;
	}

	.answer-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-bottom: 12px;
	}

	.answer-label {
		font-size: 0.6875rem;
		font-weight: 600;
		text-transform: uppercase;
		letter-spacing: 0.05em;
		color: hsl(var(--bc-fg-muted));
	}

	.copy-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 4px 8px;
		font-size: 0.75rem;
		color: hsl(var(--bc-fg-muted));
		background: transparent;
		border: 1px solid transparent;
		border-radius: 4px;
		cursor: pointer;
		transition: all 0.15s;
	}

	.copy-btn:hover {
		color: hsl(var(--bc-text));
		background: hsl(var(--bc-surface));
		border-color: hsl(var(--bc-border));
	}

	.answer-content {
		font-size: 0.875rem;
		line-height: 1.6;
	}

	.answer-content :global(pre) {
		background: hsl(var(--bc-bg)) !important;
		border: 1px solid hsl(var(--bc-border));
		border-radius: 6px;
		padding: 12px;
		overflow-x: auto;
		font-size: 0.8125rem;
	}

	.answer-content :global(code) {
		font-family: ui-monospace, monospace;
		font-size: 0.85em;
	}

	.answer-content :global(p:not(:last-child)) {
		margin-bottom: 0.75em;
	}

	.answer-content :global(ul),
	.answer-content :global(ol) {
		padding-left: 1.5em;
		margin-bottom: 0.75em;
	}

	.answer-content :global(h1),
	.answer-content :global(h2),
	.answer-content :global(h3) {
		margin-top: 1em;
		margin-bottom: 0.5em;
		font-weight: 600;
	}

	.answer-preview {
		font-size: 0.875rem;
		line-height: 1.6;
		color: hsl(var(--bc-fg-muted));
	}

	.expand-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		margin-top: 12px;
		padding: 6px 10px;
		font-size: 0.75rem;
		font-weight: 500;
		color: hsl(var(--bc-accent));
		background: hsl(var(--bc-accent) / 0.1);
		border: none;
		border-radius: 4px;
		cursor: pointer;
		transition: background 0.15s;
	}

	.expand-btn:hover {
		background: hsl(var(--bc-accent) / 0.15);
	}

	.bc-code {
		background: hsl(var(--bc-surface-2));
		padding: 2px 6px;
		border-radius: 4px;
		font-family: ui-monospace, monospace;
		font-size: 0.85em;
	}
</style>
