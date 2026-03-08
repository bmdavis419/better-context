<script lang="ts">
	import { GLOBAL_RESOURCES, getResourceNameError, type GlobalResource } from '@btca/shared';
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
		Layers,
		Github,
		RefreshCw,
		Lock,
		Package as PackageIcon
	} from '@lucide/svelte';
	import { useQuery, useConvexClient } from 'convex-svelte';
	import { goto } from '$app/navigation';
	import { PUBLIC_CONVEX_URL } from '$env/static/public';
	import ResourceLogo from '$lib/components/ResourceLogo.svelte';
	import { getAuthState } from '$lib/stores/auth.svelte';
	import { getProjectStore } from '$lib/stores/project.svelte';
	import { api } from '@btca/convex/api';

	const auth = getAuthState();
	const client = useConvexClient();
	const projectStore = getProjectStore();
	const getConvexHttpBaseUrl = (url: string) => url.replace('.convex.cloud', '.convex.site');
	const convexHttpBaseUrl = getConvexHttpBaseUrl(PUBLIC_CONVEX_URL);

	type ResourceFormType = 'git' | 'npm';

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
	const githubConnectionQuery = $derived(
		auth.instanceId ? useQuery(api.githubConnections.getMyConnection, {}) : null
	);

	// Quick add state
	let quickAddUrl = $state('');
	let isParsingUrl = $state(false);
	let parseError = $state<string | null>(null);

	// Form state
	let showAddForm = $state(false);
	let showConfirmation = $state(false);
	let formType = $state<ResourceFormType>('git');
	let formName = $state('');
	let formUrl = $state('');
	let formBranch = $state('main');
	let formPackage = $state('');
	let formVersion = $state('');
	let formSearchPath = $state('');
	let formSpecialNotes = $state('');
	let isSubmitting = $state(false);
	let formError = $state<string | null>(null);
	let addingGlobal = $state<string | null>(null);
	let globalAddError = $state<string | null>(null);
	let isSyncingGitHub = $state(false);
	let isConnectingGitHub = $state(false);
	let githubSyncError = $state<string | null>(null);
	let githubSyncTriggered = $state(false);

	const userResourceNames = $derived(
		new Set(
			((userResourcesQuery?.data ?? []) as Array<{ name: string }>).map((resource) => resource.name)
		)
	);
	const githubConnection = $derived(
		githubConnectionQuery?.data ?? { status: 'disconnected', installations: [] }
	);
	const githubInstallations = $derived(githubConnection.installations ?? []);
	const getNpmResourceUrl = (packageName?: string, version?: string) =>
		packageName
			? `https://www.npmjs.com/package/${packageName.split('/').map(encodeURIComponent).join('/')}${version ? `/v/${encodeURIComponent(version)}` : ''}`
			: undefined;
	const getResourceSummary = (resource: {
		type: 'git' | 'npm';
		branch?: string;
		searchPath?: string;
		package?: string;
		version?: string;
		visibility?: 'public' | 'private';
	}) =>
		resource.type === 'npm'
			? `${resource.package ?? resource.type}${resource.version ? `@${resource.version}` : ''}`
			: [
					resource.visibility === 'private' ? 'private' : 'public',
					resource.branch ?? 'main',
					resource.searchPath
				]
					.filter(Boolean)
					.join(' · ');

	const getResourceLabel = (resource: {
		type: 'git' | 'npm';
		url?: string;
		package?: string;
		version?: string;
	}) =>
		resource.type === 'npm'
			? `${resource.package ?? 'npm package'}${resource.version ? `@${resource.version}` : ''}`
			: (resource.url?.replace(/^https?:\/\//, '') ?? 'git resource');

	const resetForm = (nextType: ResourceFormType = formType) => {
		formType = nextType;
		formName = '';
		formUrl = '';
		formBranch = 'main';
		formPackage = '';
		formVersion = '';
		formSearchPath = '';
		formSpecialNotes = '';
		formError = null;
	};

	const openAddForm = (nextType: ResourceFormType = formType) => {
		resetForm(nextType);
		showAddForm = true;
	};

	const closeAddForm = () => {
		showAddForm = false;
		resetForm('git');
	};

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
			formType = 'git';
			formName = parsed.name;
			formUrl = parsed.url;
			formBranch = parsed.branch;
			formPackage = '';
			formVersion = '';
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
		resetForm('git');
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

	$effect(() => {
		const params = new URLSearchParams(globalThis.location?.search ?? '');
		const githubError = params.get('github_error');
		if (!githubError) return;

		githubSyncError =
			{
				invalid_state: 'The GitHub connect link expired. Try connecting GitHub again.',
				missing_installation: 'GitHub setup did not finish. Try the connect flow again.',
				missing_instance: 'Your web sandbox instance could not be found. Refresh and try again.'
			}[githubError] ?? 'GitHub setup did not finish. Try connecting again.';
	});

	$effect(() => {
		if (!auth.isSignedIn) {
			githubSyncTriggered = false;
			return;
		}
		if (!githubSyncTriggered) {
			githubSyncTriggered = true;
			void syncGitHubConnection();
		}
	});

	async function syncGitHubConnection() {
		if (!auth.isSignedIn) return;
		isSyncingGitHub = true;
		githubSyncError = null;

		try {
			await client.action(api.githubAuth.syncMyConnection, {});
		} catch (error) {
			githubSyncError = error instanceof Error ? error.message : 'Failed to refresh GitHub status';
		} finally {
			isSyncingGitHub = false;
		}
	}

	async function handleConnectGitHub() {
		githubSyncError = null;
		isConnectingGitHub = true;

		try {
			const token = await auth.getToken({ template: 'convex' });
			if (!token) {
				githubSyncError =
					'Your session has expired. Refresh the page and try connecting GitHub again.';
				return;
			}

			const response = await fetch(
				`${convexHttpBaseUrl}/github/connect/start?returnTo=${encodeURIComponent('/app/settings/resources')}`,
				{
					headers: {
						Authorization: `Bearer ${token}`
					}
				}
			);

			if (!response.ok) {
				throw new Error(await response.text());
			}

			const payload = (await response.json()) as { url?: string };
			if (!payload.url) {
				throw new Error('GitHub connect URL was missing from the server response');
			}

			globalThis.location.href = payload.url;
		} catch (error) {
			githubSyncError =
				error instanceof Error ? error.message : 'Failed to start GitHub connect flow';
		} finally {
			isConnectingGitHub = false;
		}
	}

	async function handleRefreshGitHubAccess() {
		await syncGitHubConnection();
	}

	async function handleAddResource() {
		if (!auth.instanceId) return;
		if (!formName.trim()) {
			formError = 'Name is required';
			return;
		}

		const nameError = getResourceNameError(formName);
		if (nameError) {
			formError = nameError;
			return;
		}

		if (formType === 'git') {
			if (!formUrl.trim()) {
				formError = 'Git URL is required';
				return;
			}

			try {
				new URL(formUrl);
			} catch {
				formError = 'Invalid URL format';
				return;
			}
		}

		if (formType === 'npm' && !formPackage.trim()) {
			formError = 'npm package is required';
			return;
		}

		isSubmitting = true;
		formError = null;

		try {
			await client.action(api.resourceActions.addCustomResource, {
				type: formType,
				name: formName.trim(),
				url: formType === 'git' ? formUrl.trim() : undefined,
				branch: formType === 'git' ? formBranch.trim() || 'main' : undefined,
				package: formType === 'npm' ? formPackage.trim() : undefined,
				version: formType === 'npm' ? formVersion.trim() || undefined : undefined,
				searchPath: formType === 'git' ? formSearchPath.trim() || undefined : undefined,
				specialNotes: formSpecialNotes.trim() || undefined,
				projectId: selectedProjectId
			});

			closeAddForm();
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
			await client.action(api.resourceActions.addCustomResource, {
				type: 'git',
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

		<section class="bc-card p-5">
			<div class="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
				<div class="space-y-2">
					<div class="flex items-center gap-2">
						<Github size={18} />
						<h2 class="text-lg font-medium">GitHub Private Repos</h2>
					</div>
					<p class="bc-muted text-sm">
						Private GitHub repositories now use the btca GitHub App with read-only repository
						access. Your local CLI still uses git auth on your own machine.
					</p>
					<div class="flex flex-wrap items-center gap-2 text-sm">
						<span class="bc-chip px-2 py-1">
							{#if githubConnection.status === 'connected'}
								{githubInstallations.length === 1
									? `Connected to ${githubInstallations[0]?.accountLogin}`
									: `Connected to ${githubInstallations.length} GitHub installations`}
							{:else}
								GitHub not connected
							{/if}
						</span>
						{#if githubConnection.status === 'connected'}
							<span class="bc-muted">Permissions: contents read-only, metadata read-only</span>
						{/if}
					</div>
					<p class="bc-muted text-xs">
						Install the btca GitHub App on your personal account or org, then grant the private
						repositories you want the web sandbox to clone. You can change repo access later from
						GitHub and refresh status here.
					</p>
					{#if githubSyncError}
						<div class="text-sm text-red-500">{githubSyncError}</div>
					{/if}
					{#if githubInstallations.length > 0}
						<div class="flex flex-col gap-2 pt-1 text-sm">
							{#each githubInstallations as installation}
								<div class="flex flex-wrap items-center gap-2">
									<span class="bc-chip px-2 py-1">
										{installation.accountLogin} · {installation.repositorySelection === 'all'
											? 'all repos'
											: `${installation.repositoryNames.length} selected repos`}
									</span>
									{#if installation.status === 'suspended'}
										<span class="text-xs text-yellow-400">Suspended</span>
									{/if}
									{#if installation.htmlUrl}
										<a
											class="bc-muted inline-flex items-center gap-1 text-xs hover:text-white"
											href={installation.htmlUrl}
											target="_blank"
											rel="noreferrer"
										>
											Manage on GitHub
											<ExternalLink size={12} />
										</a>
									{/if}
								</div>
							{/each}
						</div>
					{/if}
				</div>
				<div class="flex flex-wrap gap-2">
					<button type="button" class="bc-btn text-sm" onclick={handleRefreshGitHubAccess}>
						{#if isSyncingGitHub}
							<Loader2 size={16} class="animate-spin" />
						{:else}
							<RefreshCw size={16} />
						{/if}
						Refresh Status
					</button>
					<button type="button" class="bc-btn bc-btn-primary text-sm" onclick={handleConnectGitHub}>
						{#if isConnectingGitHub}
							<Loader2 size={16} class="animate-spin" />
						{:else}
							<Github size={16} />
						{/if}
						{githubConnection.status === 'connected' ? 'Grant Repo Access' : 'Connect GitHub'}
					</button>
				</div>
			</div>
		</section>

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
						onclick={() => (showAddForm ? closeAddForm() : openAddForm('git'))}
					>
						<Plus size={16} />
						Add Resource
					</button>
				</div>
			</div>
			<p class="bc-muted mb-4 text-sm">
				Add your own git repositories or npm packages as documentation resources.
			</p>
			<p class="bc-muted mb-4 text-xs">
				Public repos can be added directly. Private GitHub repos require the btca GitHub App with
				access to the repo owner and repository. npm packages can be added with an optional pinned
				version.
			</p>

			<!-- Quick Add Section -->
			<div class="bc-card mb-4 p-4">
				<div class="flex items-center gap-2 mb-3">
					<Link size={16} />
					<h3 class="font-medium">Quick Add Git Repo</h3>
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
						<div class="grid gap-2 sm:grid-cols-2">
							<button
								type="button"
								class="bc-resourceType {formType === 'git' ? 'bc-resourceType-active' : ''}"
								onclick={() => resetForm('git')}
							>
								<div class="flex items-center gap-2">
									<Link size={16} />
									<span class="font-medium">Git Repository</span>
								</div>
								<span class="bc-muted text-xs">Repo URL, branch, and optional docs path.</span>
							</button>
							<button
								type="button"
								class="bc-resourceType {formType === 'npm' ? 'bc-resourceType-active' : ''}"
								onclick={() => resetForm('npm')}
							>
								<div class="flex items-center gap-2">
									<PackageIcon size={16} />
									<span class="font-medium">npm Package</span>
								</div>
								<span class="bc-muted text-xs">Package name and an optional pinned version.</span>
							</button>
						</div>

						<div>
							<label for="name" class="mb-1 block text-sm font-medium">Name *</label>
							<input
								id="name"
								type="text"
								class="bc-input w-full"
								placeholder="e.g., myFramework"
								bind:value={formName}
							/>
							<p class="bc-muted mt-1 text-xs">
								Used as @mention (e.g., @myFramework). Allowed: letters, numbers, ., _, -, / (no
								spaces)
							</p>
						</div>

						{#if formType === 'git'}
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
						{:else}
							<div>
								<label for="package" class="mb-1 block text-sm font-medium">npm Package *</label>
								<input
									id="package"
									type="text"
									class="bc-input w-full"
									placeholder="react or @types/node"
									bind:value={formPackage}
								/>
							</div>

							<div>
								<label for="version" class="mb-1 block text-sm font-medium">Version or Tag</label>
								<input
									id="version"
									type="text"
									class="bc-input w-full"
									placeholder="latest, 19.0.0, beta"
									bind:value={formVersion}
								/>
								<p class="bc-muted mt-1 text-xs">
									Leave blank to use the latest published version.
								</p>
							</div>
						{/if}

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
								onclick={closeAddForm}
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
									Add {formType === 'git' ? 'Repository' : 'Package'}
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
								<div class="flex flex-wrap items-center gap-2">
									<span class="font-medium">@{resource.name}</span>
									{#if resource.type === 'npm'}
										<span class="bc-chip px-1.5 py-0.5 text-[11px]">
											<PackageIcon size={10} />
											npm
										</span>
									{/if}
									{#if resource.visibility === 'private'}
										<span class="bc-chip px-1.5 py-0.5 text-[11px]">
											<Lock size={10} />
											Private
										</span>
									{/if}
								</div>
								<div class="flex shrink-0 gap-1">
									{#if resource.url || resource.package}
										<a
											href={resource.url ?? getNpmResourceUrl(resource.package, resource.version)}
											target="_blank"
											rel="noreferrer"
											class="bc-chip p-1.5"
											title={resource.type === 'npm' ? 'Open npm package' : 'Open repository'}
										>
											<ExternalLink size={12} />
										</a>
									{/if}
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
								{getResourceLabel(resource)}
							</div>
							<div class="bc-muted mt-1 text-xs">
								{getResourceSummary(resource)}
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
						onclick={() => openAddForm('git')}
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

	.bc-resourceType {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.9rem 1rem;
		border: 1px solid hsl(var(--bc-border));
		background: hsl(var(--bc-surface));
		text-align: left;
		transition:
			border-color 0.15s,
			background-color 0.15s,
			transform 0.15s;
	}

	.bc-resourceType:hover {
		border-color: hsl(var(--bc-fg) / 0.35);
		transform: translateY(-1px);
	}

	.bc-resourceType-active {
		border-color: hsl(var(--bc-accent));
		background: hsl(var(--bc-accent) / 0.08);
	}
</style>
