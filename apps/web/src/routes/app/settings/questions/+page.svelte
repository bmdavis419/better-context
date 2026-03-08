<script lang="ts">
	import { useQuery } from 'convex-svelte';
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
		Search,
		SortAsc,
		SortDesc,
		ChevronLeft,
		ChevronRight
	} from '@lucide/svelte';
	import { marked } from 'marked';
	import DOMPurify from 'isomorphic-dompurify';
	import { goto } from '$app/navigation';
	import { api } from '@btca/convex/api';
	import { getProjectStore } from '$lib/stores/project.svelte';
	import Dropdown from '$lib/components/Dropdown.svelte';

	const projectStore = getProjectStore();

	const selectedProject = $derived(projectStore.selectedProject);
	const projectId = $derived(selectedProject?._id);

	type SortDirection = 'desc' | 'asc';

	let currentPage = $state(1);
	let pageSize = $state(20);
	let resourceFilter = $state('');
	let sortDirection = $state<SortDirection>('desc');
	let searchInput = $state('');
	let searchQuery = $state('');

	const filtersKey = $derived(
		`${projectId ?? ''}|${resourceFilter}|${sortDirection}|${searchQuery}|${pageSize}`
	);
	let lastFiltersKey = $state('');
	let filtersInitialized = $state(false);

	$effect(() => {
		if (!filtersInitialized) {
			lastFiltersKey = filtersKey;
			filtersInitialized = true;
			return;
		}

		if (filtersKey !== lastFiltersKey) {
			lastFiltersKey = filtersKey;
			currentPage = 1;
		}
	});

	$effect(() => {
		const value = searchInput.trim();
		const handle = setTimeout(() => {
			searchQuery = value;
		}, 250);
		return () => clearTimeout(handle);
	});

	const questionsArgs = $derived(
		projectId
			? {
					projectId,
					page: currentPage,
					pageSize,
					sort: sortDirection,
					resource: resourceFilter || undefined,
					search: searchQuery || undefined
				}
			: null
	);
	const questionsQuery = $derived(
		questionsArgs ? useQuery(api.projects.listQuestions, questionsArgs) : null
	);
	const questionsResult = $derived(questionsQuery?.data ?? null);
	const questions = $derived(questionsResult?.items ?? []);
	const total = $derived(questionsResult?.total ?? 0);
	const totalAll = $derived(questionsResult?.totalAll ?? 0);
	const totalPages = $derived(questionsResult?.totalPages ?? 1);
	const resourceOptions = $derived(
		(questionsResult?.resources ?? []) as Array<{ name: string; count: number }>
	);
	const resourceSelectOptions = $derived(
		resourceFilter && !resourceOptions.some((option) => option.name === resourceFilter)
			? [{ name: resourceFilter, count: 0 }, ...resourceOptions]
			: resourceOptions
	);
	const isLoading = $derived(questionsQuery?.isLoading ?? false);
	const startIndex = $derived(total === 0 ? 0 : (currentPage - 1) * pageSize + 1);
	const endIndex = $derived(total === 0 ? 0 : Math.min(currentPage * pageSize, total));
	const hasActiveFilters = $derived(
		Boolean(resourceFilter || searchQuery || sortDirection !== 'desc' || pageSize !== 20)
	);
	const hasQueryFilters = $derived(Boolean(resourceFilter || searchQuery));

	$effect(() => {
		const serverPage = questionsResult?.page;
		if (serverPage && serverPage !== currentPage) {
			currentPage = serverPage;
		}
	});

	let expandedQuestions = $state<Set<string>>(new Set());
	let copiedId = $state<string | null>(null);

	const contentKey = $derived(`${filtersKey}|${currentPage}`);
	let lastContentKey = $state('');
	let contentInitialized = $state(false);

	$effect(() => {
		if (!contentInitialized) {
			lastContentKey = contentKey;
			contentInitialized = true;
			return;
		}

		if (contentKey !== lastContentKey) {
			lastContentKey = contentKey;
			expandedQuestions = new Set();
			copiedId = null;
		}
	});

	function toggleExpanded(id: string) {
		const newSet = new Set(expandedQuestions);
		if (newSet.has(id)) {
			newSet.delete(id);
		} else {
			newSet.add(id);
		}
		expandedQuestions = newSet;
	}

	function toggleSortDirection() {
		sortDirection = sortDirection === 'desc' ? 'asc' : 'desc';
	}

	function resetFilters() {
		resourceFilter = '';
		searchInput = '';
		searchQuery = '';
		sortDirection = 'desc';
		pageSize = 20;
		currentPage = 1;
	}

	function goToPage(nextPage: number) {
		currentPage = Math.min(Math.max(1, nextPage), totalPages);
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
			<button type="button" class="bc-btn text-sm" onclick={() => goto('/app/settings?tab=mcp')}>
				<Settings size={16} />
				Configure
			</button>
		</div>

		{#if selectedProject}
			<div class="bc-card p-4">
				<div class="flex flex-col gap-4">
					<div class="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
						<div class="min-w-0">
							<label for="mcp-search" class="text-xs font-medium uppercase tracking-wide bc-muted">
								Search
							</label>
							<div class="relative mt-2">
								<Search size={14} class="bc-muted absolute left-3 top-1/2 -translate-y-1/2" />
								<input
									id="mcp-search"
									type="text"
									bind:value={searchInput}
									placeholder="Search questions, answers, resources"
									class="bc-input w-full pl-9 text-sm"
								/>
							</div>
						</div>

						<div class="min-w-0">
							<label
								for="mcp-resource"
								class="text-xs font-medium uppercase tracking-wide bc-muted"
							>
								Resource
							</label>
							<Dropdown
								id="mcp-resource"
								class="mt-2 text-sm"
								bind:value={resourceFilter}
								placeholder="All resources"
								options={[
									{ value: '', label: 'All resources' },
									...resourceSelectOptions.map((r) => ({
										value: r.name,
										label: `@${r.name} (${r.count})`
									}))
								]}
							/>
						</div>

						<div class="min-w-0">
							<label for="mcp-sort" class="text-xs font-medium uppercase tracking-wide bc-muted">
								Sort
							</label>
							<button
								id="mcp-sort"
								type="button"
								class="bc-input mt-2 flex w-full items-center gap-2 text-sm"
								onclick={toggleSortDirection}
								aria-label="Sort questions by date"
							>
								{#if sortDirection === 'desc'}
									<SortDesc size={14} />
									<span>Newest first</span>
								{:else}
									<SortAsc size={14} />
									<span>Oldest first</span>
								{/if}
							</button>
						</div>

						<div class="min-w-0">
							<label
								for="mcp-page-size"
								class="text-xs font-medium uppercase tracking-wide bc-muted"
							>
								Per page
							</label>
							<select id="mcp-page-size" class="bc-input mt-2 w-full text-sm" bind:value={pageSize}>
								<option value={10}>10</option>
								<option value={20}>20</option>
								<option value={50}>50</option>
							</select>
						</div>

						<div class="min-w-0 self-end">
							<button
								type="button"
								class="bc-btn w-full text-xs"
								onclick={resetFilters}
								disabled={!hasActiveFilters}
							>
								Reset
							</button>
						</div>
					</div>

					<div class="flex flex-wrap items-center justify-between gap-2 text-xs">
						<p class="bc-muted">
							{#if total === 0}
								No results
							{:else}
								Showing {startIndex}-{endIndex} of {total}
								{#if totalAll !== total}
									<span class="bc-muted"> (filtered from {totalAll})</span>
								{/if}
							{/if}
						</p>
						{#if hasQueryFilters}
							<div class="flex flex-wrap gap-2">
								{#if searchQuery}
									<span class="filter-chip">Search: "{searchQuery}"</span>
								{/if}
								{#if resourceFilter}
									<span class="filter-chip">Resource: @{resourceFilter}</span>
								{/if}
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}

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
		{:else if totalAll === 0}
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
		{:else if total === 0}
			<div class="bc-card p-8 text-center">
				<div
					class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[hsl(var(--bc-surface-2))]"
				>
					<MessageSquare size={24} class="bc-muted" />
				</div>
				<p class="font-medium">No results for these filters</p>
				<p class="bc-muted mx-auto mt-2 max-w-md text-sm">
					Try removing a filter or adjusting your search to see more questions.
				</p>
				<button
					type="button"
					class="bc-btn mt-4 text-xs"
					onclick={resetFilters}
					disabled={!hasActiveFilters}
				>
					Reset filters
				</button>
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

			<div
				class="bc-card mt-6 flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
			>
				<p class="bc-muted text-xs">
					Page {currentPage} of {totalPages}
				</p>
				<div class="flex items-center gap-2">
					<button
						type="button"
						class="bc-btn text-xs"
						onclick={() => goToPage(currentPage - 1)}
						disabled={currentPage <= 1}
					>
						<ChevronLeft size={14} />
						Previous
					</button>
					<button
						type="button"
						class="bc-btn text-xs"
						onclick={() => goToPage(currentPage + 1)}
						disabled={currentPage >= totalPages}
					>
						Next
						<ChevronRight size={14} />
					</button>
				</div>
			</div>
		{/if}
	</div>
</div>

<style>
	.question-card {
		background: hsl(var(--bc-surface));
		border: 1px solid hsl(var(--bc-border));
		border-radius: 0;
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
		border-radius: 0;
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
		border-radius: 0;
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
		border-radius: 0;
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
		border-radius: 0;
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
		border-radius: 0;
		cursor: pointer;
		transition: background 0.15s;
	}

	.expand-btn:hover {
		background: hsl(var(--bc-accent) / 0.15);
	}

	.bc-code {
		background: hsl(var(--bc-surface-2));
		padding: 2px 6px;
		border-radius: 0;
		font-family: ui-monospace, monospace;
		font-size: 0.85em;
	}

	.filter-chip {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 4px 10px;
		border: 1px solid hsl(var(--bc-border));
		background: hsl(var(--bc-surface-2));
		border-radius: 999px;
		font-size: 0.6875rem;
		color: hsl(var(--bc-fg-muted));
	}
</style>
