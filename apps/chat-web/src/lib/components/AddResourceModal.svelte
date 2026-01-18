<script lang="ts">
	import { CheckCircle2, GitBranch, Link, Loader2, X } from '@lucide/svelte';
	import { useConvexClient } from 'convex-svelte';
	import { api } from '../../convex/_generated/api';
	import { getAuthState } from '$lib/stores/auth.svelte';

	interface Props {
		isOpen: boolean;
		onClose?: () => void;
	}

	let { isOpen, onClose }: Props = $props();

	type ParsedRepo = {
		name: string;
		url: string;
		branch: string;
		displayName: string;
	};

	const auth = getAuthState();
	const client = useConvexClient();

	let gitUrl = $state('');
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

	function resetForm() {
		gitUrl = '';
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

		const parsed = detectFromUrl({ showError: true });
		if (!parsed) return;

		const name = resourceName.trim();
		if (!name) {
			submitError = 'Resource name is required.';
			return;
		}

		isSubmitting = true;
		try {
			await client.mutation(api.resources.addCustomResource, {
				instanceId: auth.instanceId,
				name,
				url: parsed.url,
				branch: branchName.trim() || 'main'
			});
			closeModal();
		} catch (error) {
			submitError = error instanceof Error ? error.message : 'Failed to add resource.';
		} finally {
			isSubmitting = false;
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

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
			onkeydown={(event) => {
				event.stopPropagation();
			}}
		>
			<div class="flex flex-wrap items-center justify-between gap-4">
				<div class="flex items-center gap-3">
					<div class="bc-logoMark">
						<Link size={18} />
					</div>
					<div>
						<h2 class="text-lg font-semibold">Add a resource</h2>
						<p class="bc-muted text-sm">Connect a git repository so btca can index it.</p>
					</div>
				</div>
				<button type="button" class="bc-chip p-2" onclick={closeModal} aria-label="Close">
					<X size={14} />
				</button>
			</div>

			<div class="mt-6 grid gap-4">
				<div>
					<label for="git-url" class="mb-2 block text-xs font-semibold uppercase tracking-[0.2em]">
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
							placeholder="e.g. svelteKit"
							bind:value={resourceName}
							oninput={handleNameInput}
						/>
						<p class="bc-muted mt-2 text-xs">Use @mention: @{resourceName || 'resource'}</p>
					</div>
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
					We'll cache the repo on your instance after the next chat mention.
				</p>
				<div class="flex items-center gap-2">
					<button type="button" class="bc-btn text-sm" onclick={closeModal} disabled={isSubmitting}>
						Cancel
					</button>
					<button
						type="button"
						class="bc-btn bc-btn-primary text-sm"
						onclick={handleSubmit}
						disabled={isSubmitting || !gitUrl.trim()}
					>
						{#if isSubmitting}
							<Loader2 size={16} class="animate-spin" />
							Adding...
						{:else}
							Add resource
						{/if}
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
