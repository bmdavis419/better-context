<script lang="ts">
	import {
		CheckCircle2,
		GitBranch,
		Link,
		Loader2,
		Package as PackageIcon,
		X
	} from '@lucide/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api';
	import { getAuthState } from '$lib/stores/auth.svelte';
	import { getProjectStore } from '$lib/stores/project.svelte';

	interface Props {
		isOpen: boolean;
		onClose?: () => void;
	}

	let { isOpen, onClose }: Props = $props();

	type ResourceFormType = 'git' | 'npm';

	type ParsedRepo = {
		name: string;
		url: string;
		branch: string;
		displayName: string;
	};

	const auth = getAuthState();
	const client = useConvexClient();
	const projectStore = getProjectStore();

	const selectedProject = $derived(projectStore.selectedProject);
	const selectedProjectId = $derived(selectedProject?._id);

	let resourceType = $state<ResourceFormType>('git');
	let gitUrl = $state('');
	let packageName = $state('');
	let packageVersion = $state('');
	let resourceName = $state('');
	let branchName = $state('main');
	let detectedRepo = $state<string | null>(null);
	let parseError = $state<string | null>(null);
	let submitError = $state<string | null>(null);
	let isSubmitting = $state(false);
	let nameTouched = $state(false);
	let branchTouched = $state(false);

	$effect(() => {
		if (!isOpen) resetForm();
	});

	function resetForm(nextType: ResourceFormType = 'git') {
		resourceType = nextType;
		gitUrl = '';
		packageName = '';
		packageVersion = '';
		resourceName = '';
		branchName = 'main';
		detectedRepo = null;
		parseError = null;
		submitError = null;
		isSubmitting = false;
		nameTouched = false;
		branchTouched = false;
	}

	function closeModal() {
		resetForm();
		onClose?.();
	}

	function formatResourceName(repo: string) {
		return repo
			.replace(/[-_](.)/g, (_, c) => c.toUpperCase())
			.replace(/^(.)/, (_, c) => c.toLowerCase());
	}

	function formatPackageResourceName(input: string) {
		return input.trim().replace(/^@/, '').replace(/\s+/g, '');
	}

	function parseGitUrl(input: string): ParsedRepo | null {
		const trimmed = input.trim();
		if (!trimmed) return null;

		let owner = '';
		let repo = '';
		let normalizedUrl = trimmed;
		let branch = 'main';

		const sshMatch = trimmed.match(/^git@([^:]+):([^/]+)\/(.+?)(\.git)?$/);
		if (sshMatch) {
			const [, host, o, r] = sshMatch;
			owner = o;
			repo = r.replace(/\.git$/, '');
			normalizedUrl = `https://${host}/${owner}/${repo}`;
		} else {
			try {
				const urlObj = new URL(trimmed);
				const pathParts = urlObj.pathname.split('/').filter(Boolean);
				if (pathParts.length < 2) return null;

				owner = pathParts[0] ?? '';
				repo = (pathParts[1] ?? '').replace(/\.git$/, '');
				normalizedUrl = `${urlObj.protocol}//${urlObj.host}/${owner}/${repo}`;

				const queryBranch = urlObj.searchParams.get('ref') ?? urlObj.searchParams.get('branch');
				const markerIndex = pathParts.findIndex((part) => ['tree', 'src', 'blob'].includes(part));
				const pathBranch = markerIndex === -1 ? null : (pathParts[markerIndex + 1] ?? null);
				branch = queryBranch ?? pathBranch ?? branch;
			} catch {
				return null;
			}
		}

		if (!owner || !repo) return null;

		return {
			name: formatResourceName(repo),
			url: normalizedUrl,
			branch,
			displayName: `${owner}/${repo}`
		};
	}

	function detectFromUrl({ showError = false } = {}) {
		parseError = null;
		detectedRepo = null;
		if (!gitUrl.trim()) return null;
		const parsed = parseGitUrl(gitUrl);
		if (!parsed) {
			if (showError) {
				parseError = 'Could not parse that git URL. Please use a GitHub, GitLab, or Bitbucket URL.';
			}
			return null;
		}
		detectedRepo = parsed.displayName;
		if (!nameTouched) resourceName = parsed.name;
		if (!branchTouched) branchName = parsed.branch;
		return parsed;
	}

	function handleUrlInput() {
		parseError = null;
		submitError = null;
		detectedRepo = null;
		nameTouched = false;
		branchTouched = false;
	}

	function handleUrlBlur() {
		detectFromUrl();
	}

	function handleNameInput() {
		nameTouched = true;
	}

	function handleBranchInput() {
		branchTouched = true;
	}

	function handlePackageInput() {
		parseError = null;
		submitError = null;
		if (!nameTouched) {
			resourceName = formatPackageResourceName(packageName);
		}
	}

	function handleKeydown(event: KeyboardEvent) {
		if (!isOpen) return;
		if (event.key === 'Escape') {
			event.preventDefault();
			closeModal();
		}
	}

	async function handleSubmit() {
		submitError = null;
		if (!auth.instanceId) {
			submitError = 'Please sign in to add a resource.';
			return;
		}

		const parsed = resourceType === 'git' ? detectFromUrl({ showError: true }) : null;
		if (resourceType === 'git' && !parsed) return;

		const name = resourceName.trim();
		if (!name) {
			submitError = 'Resource name is required.';
			return;
		}

		if (resourceType === 'npm' && !packageName.trim()) {
			submitError = 'npm package is required.';
			return;
		}

		isSubmitting = true;
		try {
			await client.action(api.resourceActions.addCustomResource, {
				type: resourceType,
				name,
				url: resourceType === 'git' ? parsed?.url : undefined,
				branch: resourceType === 'git' ? branchName.trim() || 'main' : undefined,
				package: resourceType === 'npm' ? packageName.trim() : undefined,
				version: resourceType === 'npm' ? packageVersion.trim() || undefined : undefined,
				projectId: selectedProjectId
			});
			closeModal();
		} catch (error) {
			submitError = error instanceof Error ? error.message : 'Failed to add resource.';
		} finally {
			isSubmitting = false;
		}
	}
</script>

{#if isOpen}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-[hsl(var(--bc-bg))]/85 px-6 py-10 backdrop-blur-sm"
		role="button"
		tabindex="0"
		onclick={closeModal}
		onkeydown={(event) => {
			if (event.key === 'Enter' || event.key === ' ') {
				event.preventDefault();
				closeModal();
			}
		}}
	>
		<div
			class="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(255,116,51,0.16),_transparent_60%)]"
			aria-hidden="true"
		></div>
		<div
			class="bc-card bc-reveal relative w-full max-w-xl p-6 md:p-8"
			style="--delay: 30ms"
			role="dialog"
			aria-modal="true"
			aria-label="Add a resource"
			tabindex="-1"
			onclick={(event) => event.stopPropagation()}
			onkeydown={handleKeydown}
		>
			<div class="flex items-start justify-between gap-4">
				<div class="flex min-w-0 flex-1 items-start gap-3">
					<div class="bc-logoMark">
						{#if resourceType === 'git'}
							<Link size={18} />
						{:else}
							<PackageIcon size={18} />
						{/if}
					</div>
					<div class="min-w-0">
						<h2 class="text-lg font-semibold">Add a resource</h2>
						<p class="bc-muted text-sm">
							{resourceType === 'git'
								? 'Connect a git repository so btca can index it.'
								: 'Attach an npm package so btca can use its published docs and metadata.'}
						</p>
					</div>
				</div>
				<button type="button" class="bc-chip shrink-0 p-2" onclick={closeModal} aria-label="Close">
					<X size={14} />
				</button>
			</div>

			<div class="mt-6 grid gap-4">
				<div class="grid gap-2 sm:grid-cols-2">
					<button
						type="button"
						class="rounded-2xl border px-4 py-3 text-left transition-colors {resourceType === 'git'
							? 'border-[hsl(var(--bc-accent))] bg-[hsl(var(--bc-surface-2))]'
							: 'border-[hsl(var(--bc-border))] hover:bg-[hsl(var(--bc-surface-2))]'}"
						onclick={() => resetForm('git')}
					>
						<div class="flex items-center gap-2">
							<Link size={16} />
							<span class="font-medium">Git Repository</span>
						</div>
						<p class="bc-muted mt-1 text-xs">Repo URL and branch.</p>
					</button>
					<button
						type="button"
						class="rounded-2xl border px-4 py-3 text-left transition-colors {resourceType === 'npm'
							? 'border-[hsl(var(--bc-accent))] bg-[hsl(var(--bc-surface-2))]'
							: 'border-[hsl(var(--bc-border))] hover:bg-[hsl(var(--bc-surface-2))]'}"
						onclick={() => resetForm('npm')}
					>
						<div class="flex items-center gap-2">
							<PackageIcon size={16} />
							<span class="font-medium">npm Package</span>
						</div>
						<p class="bc-muted mt-1 text-xs">Package name and optional version.</p>
					</button>
				</div>

				{#if resourceType === 'git'}
					<div>
						<label
							for="git-url"
							class="mb-2 block text-xs font-semibold uppercase tracking-[0.2em]"
						>
							Git URL
						</label>
						<input
							id="git-url"
							type="url"
							class="bc-input"
							placeholder="https://github.com/owner/repo"
							bind:value={gitUrl}
							oninput={handleUrlInput}
							onblur={handleUrlBlur}
						/>
						{#if parseError}
							<p class="mt-2 text-xs text-red-500">{parseError}</p>
						{/if}
						{#if detectedRepo}
							<div class="mt-2 flex items-center gap-2 text-xs">
								<CheckCircle2 size={14} class="text-[hsl(var(--bc-success))]" />
								<span class="bc-muted">
									Detected {detectedRepo} · default branch {branchName}
								</span>
							</div>
						{/if}
					</div>
				{:else}
					<div>
						<label
							for="package-name"
							class="mb-2 block text-xs font-semibold uppercase tracking-[0.2em]"
						>
							npm package
						</label>
						<input
							id="package-name"
							type="text"
							class="bc-input"
							placeholder="react or @types/node"
							bind:value={packageName}
							oninput={handlePackageInput}
						/>
					</div>
				{/if}

				<div class="grid gap-4 md:grid-cols-2">
					<div>
						<label
							for="resource-name"
							class="mb-2 block text-xs font-semibold uppercase tracking-[0.2em]"
						>
							Resource name
						</label>
						<input
							id="resource-name"
							type="text"
							class="bc-input"
							placeholder={resourceType === 'git' ? 'e.g. svelteKit' : 'e.g. types/node'}
							bind:value={resourceName}
							oninput={handleNameInput}
						/>
						<p class="bc-muted mt-2 text-xs">Use @mention: @{resourceName || 'resource'}</p>
					</div>
					{#if resourceType === 'git'}
						<div>
							<label
								for="resource-branch"
								class="mb-2 block text-xs font-semibold uppercase tracking-[0.2em]"
							>
								Branch
							</label>
							<div class="relative">
								<GitBranch
									size={14}
									class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--bc-fg-muted))]"
								/>
								<input
									id="resource-branch"
									type="text"
									class="bc-input pl-9"
									placeholder="main"
									bind:value={branchName}
									oninput={handleBranchInput}
								/>
							</div>
						</div>
					{:else}
						<div>
							<label
								for="package-version"
								class="mb-2 block text-xs font-semibold uppercase tracking-[0.2em]"
							>
								Version or tag
							</label>
							<input
								id="package-version"
								type="text"
								class="bc-input"
								placeholder="latest, 19.0.0, beta"
								bind:value={packageVersion}
							/>
						</div>
					{/if}
				</div>

				{#if submitError}
					<div
						class="bc-card border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-500"
					>
						{submitError}
					</div>
				{/if}
			</div>

			<div class="mt-6 flex flex-wrap items-center justify-between gap-3">
				<p class="bc-muted text-xs">
					{#if selectedProject}
						This resource will be added to <span class="font-medium text-[hsl(var(--bc-fg))]"
							>{selectedProject.name}</span
						>
						and synced onto your instance after the next chat mention.
					{:else}
						We'll sync this resource onto your instance after the next chat mention.
					{/if}
				</p>
				<div class="flex items-center gap-2">
					<button type="button" class="bc-btn text-sm" onclick={closeModal} disabled={isSubmitting}>
						Cancel
					</button>
					<button
						type="button"
						class="bc-btn bc-btn-primary text-sm"
						onclick={handleSubmit}
						disabled={isSubmitting ||
							(resourceType === 'git' ? !gitUrl.trim() : !packageName.trim())}
					>
						{#if isSubmitting}
							<Loader2 size={16} class="animate-spin" />
							Adding...
						{:else}
							Add {resourceType === 'git' ? 'repository' : 'package'}
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
