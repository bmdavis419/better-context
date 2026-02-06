<script lang="ts">
	import { GLOBAL_RESOURCES, type GlobalResource } from '@btca/shared';
	import { ExternalLink, Search } from '@lucide/svelte';
	import CopyButton from '$lib/CopyButton.svelte';
	import ResourceLogo from '$lib/components/ResourceLogo.svelte';

	let query = $state('');

	const getSearchText = (resource: GlobalResource) =>
		[
			resource.name,
			resource.displayName,
			resource.url,
			resource.branch,
			resource.searchPath,
			...(resource.searchPaths ?? []),
			resource.specialNotes
		]
			.filter(Boolean)
			.join(' ')
			.toLowerCase();

	const filteredResources = $derived.by(() => {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return GLOBAL_RESOURCES;
		return GLOBAL_RESOURCES.filter((resource) => getSearchText(resource).includes(normalized));
	});

	const getSearchPath = (resource: GlobalResource) =>
		resource.searchPath ?? resource.searchPaths?.join(', ');

	const getConfigSnippet = (resource: GlobalResource) =>
		JSON.stringify(
			{
				type: resource.type,
				name: resource.name,
				url: resource.url,
				branch: resource.branch,
				...(resource.searchPath ? { searchPath: resource.searchPath } : {}),
				...(resource.searchPaths ? { searchPaths: resource.searchPaths } : {}),
				...(resource.specialNotes ? { specialNotes: resource.specialNotes } : {})
			},
			null,
			2
		);

	const getCliCommand = (resource: GlobalResource) => {
		const searchPath = resource.searchPath ?? resource.searchPaths?.[0];
		const parts = [
			'btca',
			'add',
			resource.url,
			'--name',
			resource.name,
			'--branch',
			resource.branch
		];
		if (searchPath) {
			parts.push('--search-path', searchPath);
		}
		return parts.join(' ');
	};
</script>

<svelte:head>
	<title>btca | Resources</title>
	<meta name="description" content="Curated git repositories you can add to btca as resources." />
</svelte:head>

<section class="flex flex-col gap-14">
	<header class="flex flex-col gap-5">
		<div class="bc-kicker">
			<span class="bc-kickerDot"></span>
			<span>Community</span>
		</div>

		<h1 class="bc-h1 text-balance text-5xl sm:text-6xl">Global resources</h1>
		<p class="bc-prose max-w-2xl text-pretty text-base sm:text-lg">
			Some useful resources to add to btca. You can also add any other git repo!
		</p>
		<div class="flex flex-wrap gap-3">
			<a href="https://docs.btca.dev" class="bc-chip" target="_blank" rel="noreferrer noopener"
				>Docs</a
			>
		</div>
	</header>

	<div class="bc-card bc-ring flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
		<div class="flex items-center gap-2 text-sm font-semibold">
			<Search size={16} />
			Search resources
		</div>
		<input
			type="text"
			class="bc-input flex-1"
			placeholder="Search by name, URL, or notes"
			bind:value={query}
		/>
	</div>

	<div class="grid gap-4 md:grid-cols-2">
		{#if filteredResources.length === 0}
			<div class="bc-card p-6 text-sm bc-prose">No matches. Try a different search.</div>
		{:else}
			{#each filteredResources as resource (resource.name)}
				<div class="bc-card bc-ring bc-cardHover flex flex-col gap-4 p-5">
					<div class="flex items-start gap-4">
						<ResourceLogo
							size={44}
							className="text-[hsl(var(--bc-accent))]"
							logoKey={resource.logoKey}
						/>
						<div class="flex-1">
							<div class="flex flex-wrap items-center gap-2">
								<span class="text-base font-semibold">@{resource.name}</span>
								<span class="bc-badge">{resource.displayName}</span>
							</div>
							<p class="bc-muted mt-1 text-xs break-all">{resource.url}</p>
							{#if getSearchPath(resource)}
								<p class="bc-muted mt-2 text-xs">Search path: {getSearchPath(resource)}</p>
							{/if}
						</div>
					</div>

					<div class="flex flex-wrap items-center gap-3 text-xs">
						<div class="flex items-center gap-2">
							<CopyButton text={getConfigSnippet(resource)} label="Copy config snippet" />
							<span>Copy config</span>
						</div>
						<div class="flex items-center gap-2">
							<CopyButton text={getCliCommand(resource)} label="Copy CLI command" />
							<span>Copy CLI</span>
						</div>
						<a
							href={resource.url}
							target="_blank"
							rel="noreferrer noopener"
							class="bc-chip flex items-center gap-2 px-3 py-1.5 text-xs"
						>
							<ExternalLink size={14} />
							Open repo
						</a>
					</div>
				</div>
			{/each}
		{/if}
	</div>
</section>
