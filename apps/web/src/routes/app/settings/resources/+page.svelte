<script lang="ts">
	import { GLOBAL_RESOURCES, type GlobalResource } from '@btca/shared';
	import {
		Loader2,
		Plus,
		Trash2,
		Globe,
		User,
		ExternalLink,
		Link,
		Check,
		X,
		Layers
	} from '@lucide/svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { goto } from '$app/navigation';
	import ResourceLogo from '$lib/components/ResourceLogo.svelte';
	import { getAuthState } from '$lib/stores/auth.svelte';
	import { getProjectStore } from '$lib/stores/project.svelte';
	import { api } from '../../../../convex/_generated/api';

	const auth = getAuthState();
	const client = useConvexClient();
	const projectStore = getProjectStore();

	// State for showing all projects toggle
	let showAllProjects = $state(false);

	const selectedProjectId = $derived(projectStore.selectedProject?._id);
	const userResourcesQuery = $derived(
		auth.instanceId
			? useQuery(
					api.resources.listUserResources,
					showAllProjects ? {} : selectedProjectId ? { projectId: selectedProjectId } : {}
				)
			: null
	);

	// Quick add state
	let quickAddUrl = $state('');
	let isParsingUrl = $state(false);
	let parseError = $state<string | null>(null);

	// Form state
	let showAddForm = $state(false);
	let showConfirmation = $state(false);
	let formName = $state('');
	let formUrl = $state('');
	let formBranch = $state('main');
	let formSearchPath = $state('');
	let formSpecialNotes = $state('');
	let isSubmitting = $state(false);
	let formError = $state<string | null>(null);
	let addingGlobal = $state<string | null>(null);
	let globalAddError = $state<string | null>(null);

	const userResourceNames = $derived(new Set((userResourcesQuery?.data ?? []).map((r) => r.name)));

	/**
	 * Parse a git URL and extract repo info
	 * Supports: GitHub, GitLab, Bitbucket URLs
	 * Formats: https://github.com/owner/repo, git@github.com:owner/repo.git, etc.
	 */
	function parseGitUrl(url: string): { name: string; url: string; branch: string } | null {
		const trimmedUrl = url.trim();
		if (!trimmedUrl) return null;

		// Normalize the URL
		let normalizedUrl = trimmedUrl;
		let owner = '';
		let repo = '';

		// Handle SSH format: git@github.com:owner/repo.git
		const sshMatch = trimmedUrl.match(/^git@([^:]+):([^/]+)\/(.+?)(\.git)?$/);
		if (sshMatch) {
			const [, host, o, r] = sshMatch;
			owner = o;
			repo = r.replace(/\.git$/, '');
			normalizedUrl = `https://${host}/${owner}/${repo}`;
		} else {
			// Handle HTTPS format
			try {
				const urlObj = new URL(trimmedUrl);
				const pathParts = urlObj.pathname.split('/').filter(Boolean);

				// Remove .git suffix if present
				if (pathParts.length >= 2) {
					owner = pathParts[0];
					repo = pathParts[1].replace(/\.git$/, '');
					// Reconstruct clean URL
					normalizedUrl = `${urlObj.protocol}//${urlObj.host}/${owner}/${repo}`;
				} else {
					return null;
				}
			} catch {
				return null;
			}
		}

		if (!owner || !repo) return null;

		// Generate a sensible name from the repo
		// Convert kebab-case or snake_case to camelCase
		const name = repo
			.replace(/[-_](.)/g, (_, c) => c.toUpperCase())
			.replace(/^(.)/, (_, c) => c.toLowerCase());

		return {
			name,
			url: normalizedUrl,
			branch: 'main'
		};
	}

	async function handleQuickAdd() {
		parseError = null;
		isParsingUrl = true;

		try {
			const parsed = parseGitUrl(quickAddUrl);
			if (!parsed) {
				parseError =
					'Could not parse git URL. Please enter a valid GitHub, GitLab, or Bitbucket URL.';
				return;
			}

			// Prefill the form
			formName = parsed.name;
			formUrl = parsed.url;
			formBranch = parsed.branch;
			formSearchPath = '';
			formSpecialNotes = '';

			// Show confirmation
			showConfirmation = true;
			quickAddUrl = '';
		} finally {
			isParsingUrl = false;
		}
	}

	function handleCancelConfirmation() {
		showConfirmation = false;
		formName = '';
		formUrl = '';
		formBranch = 'main';
		formSearchPath = '';
		formSpecialNotes = '';
		formError = null;
	}

	async function handleConfirmAdd() {
		await handleAddResource();
		if (!formError) {
			showConfirmation = false;
		}
	}

	$effect(() => {
		if (!auth.isSignedIn && auth.isLoaded) {
			goto('/app');
		}
	});

	async function handleAddResource() {
		if (!auth.instanceId) return;
		if (!formName.trim() || !formUrl.trim()) {
			formError = 'Name and URL are required';
			return;
		}

		// Basic URL validation
		try {
			new URL(formUrl);
		} catch {
			formError = 'Invalid URL format';
			return;
		}

		isSubmitting = true;
		formError = null;

		try {
			await client.mutation(api.resources.addCustomResource, {
				name: formName.trim(),
				url: formUrl.trim(),
				branch: formBranch.trim() || 'main',
				searchPath: formSearchPath.trim() || undefined,
				specialNotes: formSpecialNotes.trim() || undefined,
				projectId: selectedProjectId
			});

			// Reset form
			formName = '';
			formUrl = '';
			formBranch = 'main';
			formSearchPath = '';
			formSpecialNotes = '';
			showAddForm = false;
		} catch (error) {
			formError = error instanceof Error ? error.message : 'Failed to add resource';
		} finally {
			isSubmitting = false;
		}
	}

	async function handleRemoveResource(resourceId: string) {
		if (!auth.instanceId) return;
		if (!confirm('Are you sure you want to remove this resource?')) return;

		try {
			await client.mutation(api.resources.removeCustomResource, {
				resourceId: resourceId as any
			});
		} catch (error) {
			console.error('Failed to remove resource:', error);
		}
	}

	async function handleAddGlobalResource(resource: GlobalResource) {
		if (!auth.instanceId) return;
		if (userResourceNames.has(resource.name)) return;
		globalAddError = null;
		addingGlobal = resource.name;
		try {
			await client.mutation(api.resources.addCustomResource, {
				name: resource.name,
				url: resource.url,
				branch: resource.branch,
				searchPath: resource.searchPath ?? resource.searchPaths?.[0],
				specialNotes: resource.specialNotes,
				projectId: selectedProjectId
			});
		} catch (error) {
			globalAddError = error instanceof Error ? error.message : 'Failed to add resource';
		} finally {
			addingGlobal = null;
		}
	}
</script>

<div class="flex flex-1 overflow-y-auto">
	<div class="mx-auto flex w-full max-w-5xl flex-col gap-8 p-8">
		<!-- Header -->
		<div>
			<h1 class="text-2xl font-semibold">Resources</h1>
			<p class="bc-muted mt-1 text-sm">
				Manage your available documentation resources. Use @mentions in chat to query them.
			</p>
		</div>

		<!-- User Resources -->
		<section>
			<div class="mb-4 flex items-center justify-between">
				<div class="flex items-center gap-2">
					<User size={18} />
					<h2 class="text-lg font-medium">Your Custom Resources</h2>
				</div>
				<div class="flex items-center gap-3">
					<label class="flex items-center gap-2 text-sm cursor-pointer">
						<input type="checkbox" class="bc-checkbox" bind:checked={showAllProjects} />
						<Layers size={14} class="bc-muted" />
						<span class="bc-muted">All Projects</span>
					</label>
					<button
						type="button"
						class="bc-btn bc-btn-primary text-sm"
						onclick={() => (showAddForm = !showAddForm)}
					>
						<Plus size={16} />
						Add Manually
					</button>
				</div>
			</div>
			<p class="bc-muted mb-4 text-sm">Add your own git repositories as documentation resources.</p>

			<!-- Quick Add Section -->
			<div class="bc-card mb-4 p-4">
				<div class="flex items-center gap-2 mb-3">
					<Link size={16} />
					<h3 class="font-medium">Quick Add from URL</h3>
				</div>
				<div class="flex gap-2">
					<input
						type="text"
						class="bc-input flex-1"
						placeholder="Paste a git repo URL (e.g., https://github.com/owner/repo)"
						bind:value={quickAddUrl}
						onkeydown={(e) => e.key === 'Enter' && quickAddUrl.trim() && handleQuickAdd()}
					/>
					<button
						type="button"
						class="bc-btn bc-btn-primary text-sm"
						onclick={handleQuickAdd}
						disabled={!quickAddUrl.trim() || isParsingUrl}
					>
						{#if isParsingUrl}
							<Loader2 size={16} class="animate-spin" />
						{:else}
							Add
						{/if}
					</button>
				</div>
				{#if parseError}
					<div class="mt-2 text-sm text-red-500">{parseError}</div>
				{/if}
			</div>

			<!-- Confirmation Dialog -->
			{#if showConfirmation}
				<div class="bc-card mb-4 border-2 border-blue-500/50 p-4">
					<div class="flex items-center gap-2 mb-4">
						<Check size={16} class="text-blue-500" />
						<h3 class="font-medium">Confirm Resource Details</h3>
					</div>

					{#if formError}
						<div
							class="mb-4 rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-500"
						>
							{formError}
						</div>
					{/if}

					<div class="grid gap-4">
						<div>
							<label for="confirm-name" class="mb-1 block text-sm font-medium">Name *</label>
							<input
								id="confirm-name"
								type="text"
								class="bc-input w-full"
								placeholder="e.g., myFramework"
								bind:value={formName}
							/>
							<p class="bc-muted mt-1 text-xs">Used as @mention (e.g., @{formName || 'name'})</p>
						</div>

						<div>
							<label for="confirm-url" class="mb-1 block text-sm font-medium">Git URL *</label>
							<input id="confirm-url" type="url" class="bc-input w-full" bind:value={formUrl} />
						</div>

						<div class="grid grid-cols-2 gap-4">
							<div>
								<label for="confirm-branch" class="mb-1 block text-sm font-medium">Branch</label>
								<input
									id="confirm-branch"
									type="text"
									class="bc-input w-full"
									placeholder="main"
									bind:value={formBranch}
								/>
							</div>
							<div>
								<label for="confirm-searchPath" class="mb-1 block text-sm font-medium"
									>Search Path</label
								>
								<input
									id="confirm-searchPath"
									type="text"
									class="bc-input w-full"
									placeholder="docs/"
									bind:value={formSearchPath}
								/>
							</div>
						</div>

						<div>
							<label for="confirm-notes" class="mb-1 block text-sm font-medium">Notes</label>
							<textarea
								id="confirm-notes"
								class="bc-input w-full"
								rows="2"
								placeholder="Additional context for the AI..."
								bind:value={formSpecialNotes}
							></textarea>
						</div>

						<div class="flex justify-end gap-2">
							<button
								type="button"
								class="bc-btn text-sm"
								onclick={handleCancelConfirmation}
								disabled={isSubmitting}
							>
								<X size={16} />
								Cancel
							</button>
							<button
								type="button"
								class="bc-btn bc-btn-primary text-sm"
								onclick={handleConfirmAdd}
								disabled={isSubmitting}
							>
								{#if isSubmitting}
									<Loader2 size={16} class="animate-spin" />
									Adding...
								{:else}
									<Check size={16} />
									Confirm & Add
								{/if}
							</button>
						</div>
					</div>
				</div>
			{/if}

			<!-- Add Form (Manual) -->
			{#if showAddForm}
				<div class="bc-card mb-4 p-4">
					<h3 class="mb-4 font-medium">Add Custom Resource</h3>

					{#if formError}
						<div
							class="mb-4 rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-500"
						>
							{formError}
						</div>
					{/if}

					<div class="grid gap-4">
						<div>
							<label for="name" class="mb-1 block text-sm font-medium">Name *</label>
							<input
								id="name"
								type="text"
								class="bc-input w-full"
								placeholder="e.g., myFramework"
								bind:value={formName}
							/>
							<p class="bc-muted mt-1 text-xs">Used as @mention (e.g., @myFramework)</p>
						</div>

						<div>
							<label for="url" class="mb-1 block text-sm font-medium">Git URL *</label>
							<input
								id="url"
								type="url"
								class="bc-input w-full"
								placeholder="https://github.com/owner/repo"
								bind:value={formUrl}
							/>
						</div>

						<div class="grid grid-cols-2 gap-4">
							<div>
								<label for="branch" class="mb-1 block text-sm font-medium">Branch</label>
								<input
									id="branch"
									type="text"
									class="bc-input w-full"
									placeholder="main"
									bind:value={formBranch}
								/>
							</div>
							<div>
								<label for="searchPath" class="mb-1 block text-sm font-medium">Search Path</label>
								<input
									id="searchPath"
									type="text"
									class="bc-input w-full"
									placeholder="docs/"
									bind:value={formSearchPath}
								/>
							</div>
						</div>

						<div>
							<label for="notes" class="mb-1 block text-sm font-medium">Notes</label>
							<textarea
								id="notes"
								class="bc-input w-full"
								rows="2"
								placeholder="Additional context for the AI..."
								bind:value={formSpecialNotes}
							></textarea>
						</div>

						<div class="flex justify-end gap-2">
							<button
								type="button"
								class="bc-btn text-sm"
								onclick={() => (showAddForm = false)}
								disabled={isSubmitting}
							>
								Cancel
							</button>
							<button
								type="button"
								class="bc-btn bc-btn-primary text-sm"
								onclick={handleAddResource}
								disabled={isSubmitting}
							>
								{#if isSubmitting}
									<Loader2 size={16} class="animate-spin" />
									Adding...
								{:else}
									Add Resource
								{/if}
							</button>
						</div>
					</div>
				</div>
			{/if}

			<!-- User Resource List -->
			{#if userResourcesQuery?.isLoading}
				<div class="flex items-center justify-center py-8">
					<Loader2 size={24} class="animate-spin" />
				</div>
			{:else if userResourcesQuery?.data && userResourcesQuery.data.length > 0}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
					{#each userResourcesQuery.data as resource (resource._id)}
						<div class="bc-card flex flex-col p-4">
							<div class="mb-3 flex items-start justify-between gap-2">
								<span class="font-medium">@{resource.name}</span>
								<div class="flex shrink-0 gap-1">
									<a
										href={resource.url}
										target="_blank"
										rel="noreferrer"
										class="bc-chip p-1.5"
										title="Open repository"
									>
										<ExternalLink size={12} />
									</a>
									<button
										type="button"
										class="bc-chip p-1.5 text-red-500"
										title="Remove resource"
										onclick={() => handleRemoveResource(resource._id)}
									>
										<Trash2 size={12} />
									</button>
								</div>
							</div>
							<div class="bc-muted line-clamp-1 text-xs">
								{resource.url.replace(/^https?:\/\//, '')}
							</div>
							<div class="bc-muted mt-1 text-xs">
								{resource.branch}
								{#if resource.searchPath}
									<span class="mx-1">·</span>
									{resource.searchPath}
								{/if}
							</div>
							{#if resource.specialNotes}
								<div class="bc-muted mt-2 line-clamp-2 text-xs italic">{resource.specialNotes}</div>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<div class="bc-card py-8 text-center">
					<p class="bc-muted text-sm">No custom resources added yet</p>
					<button
						type="button"
						class="bc-btn bc-btn-primary mt-4 text-sm"
						onclick={() => (showAddForm = true)}
					>
						<Plus size={16} />
						Add Your First Resource
					</button>
				</div>
			{/if}
		</section>

		<section>
			<div class="mb-4 flex items-center gap-2">
				<Globe size={18} />
				<h2 class="text-lg font-medium">Global Catalog</h2>
			</div>
			<p class="bc-muted mb-4 text-sm">Click a resource to add it to your instance.</p>

			{#if globalAddError}
				<div
					class="mb-4 rounded border border-red-500/50 bg-red-500/10 px-3 py-2 text-sm text-red-500"
				>
					{globalAddError}
				</div>
			{/if}

			{#if GLOBAL_RESOURCES.length > 0}
				<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
					{#each GLOBAL_RESOURCES as resource (resource.name)}
						<button
							type="button"
							class="bc-card bc-ring bc-cardHover flex flex-col items-center gap-3 p-4 text-left"
							title={userResourceNames.has(resource.name) ? 'Already added' : 'Add resource'}
							onclick={() => handleAddGlobalResource(resource)}
							disabled={userResourceNames.has(resource.name) || addingGlobal === resource.name}
						>
							<ResourceLogo
								size={44}
								className="text-[hsl(var(--bc-accent))]"
								logoKey={resource.logoKey}
							/>
							<div class="flex items-center gap-2">
								<span class="font-medium">@{resource.name}</span>
								{#if addingGlobal === resource.name}
									<Loader2 size={14} class="animate-spin" />
								{:else if userResourceNames.has(resource.name)}
									<Check size={14} />
								{:else}
									<Plus size={14} />
								{/if}
							</div>
						</button>
					{/each}
				</div>
			{:else}
				<div class="bc-card py-8 text-center">
					<p class="bc-muted text-sm">No global resources available</p>
				</div>
			{/if}
		</section>
	</div>
</div>

<style>
	.bc-input {
		background: hsl(var(--bc-surface));
		border: 1px solid hsl(var(--bc-border));
		padding: 0.5rem 0.75rem;
		font-size: 0.875rem;
		transition: border-color 0.15s;
	}

	.bc-input:focus {
		outline: none;
		border-color: hsl(var(--bc-fg));
	}

	.bc-input::placeholder {
		color: hsl(var(--bc-fg-muted) / 0.35);
	}

	.bc-checkbox {
		appearance: none;
		width: 1rem;
		height: 1rem;
		background: hsl(var(--bc-surface));
		border: 1px solid hsl(var(--bc-border));
		border-radius: 0;
		cursor: pointer;
		transition: all 0.15s;
	}

	.bc-checkbox:checked {
		background: hsl(var(--bc-accent));
		border-color: hsl(var(--bc-accent));
		background-image: url("data:image/svg+xml,%3csvg viewBox='0 0 16 16' fill='white' xmlns='http://www.w3.org/2000/svg'%3e%3cpath d='M12.207 4.793a1 1 0 010 1.414l-5 5a1 1 0 01-1.414 0l-2-2a1 1 0 011.414-1.414L6.5 9.086l4.293-4.293a1 1 0 011.414 0z'/%3e%3c/svg%3e");
		background-size: 100% 100%;
		background-position: center;
		background-repeat: no-repeat;
	}

	.bc-checkbox:focus {
		outline: none;
		box-shadow: 0 0 0 2px hsl(var(--bc-accent) / 0.3);
	}
</style>
